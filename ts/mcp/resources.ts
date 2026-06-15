import type { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import { config } from "../config.ts"
import { getDefinitions, getSearchControls, buildShape } from "../fhir/definitions.ts"
import { getResourceMeta } from "../fhir/metadata.ts"
import { filterAndValidateDefinitions } from "./validation.ts"
import { makeHandler } from "./handler.ts"

const LOCAL_CONTROLS = new Set(["fhirpath", ...(config.responseMode !== "compact-locked" ? ["responseMode"] : [])])

const augmentSchema = (
   def: ResourceDefinition, meta: ResourceMeta | undefined, controlParams: Record<string, string>,
): { schema: z.ZodObject<z.ZodRawShape>; injected: string[] } => {
   const merged = { ...def.searchParams }, injected: string[] = []
   for (const [param, desc] of Object.entries(controlParams)) {
      if (merged[param]) continue
      if (LOCAL_CONTROLS.has(param)) { merged[param] = desc; injected.push(param); continue }
      else if (!meta) continue
      if (param === "_include" || param === "_revinclude") {
         const values = param === "_include" ? meta.includes : meta.revincludes
         if (values.length === 0) continue
         const hint = values.length > 10 ? values.slice(0, 10).join(", ") + ", …" : values.join(", ")
         merged[param] = `${desc} (${hint})`
      } else {
         if (!meta.searchParams.has(param)) continue
         merged[param] = desc
      }
      injected.push(param)
   }
   return injected.length > 0
      ? { schema: z.object(buildShape(merged, def.resourceType, def.supportsDirectRead)), injected }
      : { schema: def.searchSchema, injected }
}

/** Registers an MCP tool for every ResourceDefinition in the current snapshot. */
export const registerAll = (server: McpServer): void => {
   const controlParams = getSearchControls()
   for (const def of filterAndValidateDefinitions(getDefinitions())) {
      const
         meta = getResourceMeta(def.resourceType),
         { schema, injected } = augmentSchema(def, meta, controlParams)
      config.debug && injected.length && console.log(`📋 ${def.resourceType}: injected ${injected.join(", ")}`)
      server.registerTool(
         def.toolName,
         { description: def.description, inputSchema: schema },
         makeHandler(def.toolName),
      )
   }
}
