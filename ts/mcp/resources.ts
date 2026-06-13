import type { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import { config } from "../config.ts"
import { getDefinitions, getsearchControls, buildShape } from "../fhir/definitions.ts"
import { getResourceMeta } from "../fhir/metadata.ts"
import { filterAndValidateDefinitions } from "./validation.ts"
import { makeHandler } from "./handler.ts"

const augmentSchema = (
   def: ResourceDefinition, meta: ResourceMeta, controlParams: Record<string, string>,
): { schema: z.ZodObject<z.ZodRawShape>; injected: string[] } => {
   const merged = { ...def.searchParams }, injected: string[] = []
   for (const [param, desc] of Object.entries(controlParams)) {
      if (merged[param]) continue
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
   const controlParams = getsearchControls()
   for (const def of filterAndValidateDefinitions(getDefinitions())) {
      const
         meta = getResourceMeta(def.resourceType),
         { schema, injected } = meta ? augmentSchema(def, meta, controlParams) : { schema: def.searchSchema, injected: [] as string[] }
      config.debug && injected.length && console.log(`📋 ${def.resourceType}: injected ${injected.join(", ")}`)
      server.registerTool(
         def.toolName,
         { description: def.description, inputSchema: schema },
         makeHandler(def.toolName),
      )
   }
}
