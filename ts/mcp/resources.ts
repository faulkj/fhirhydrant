import type { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getDefinitions, getSearchControls, buildShape } from "../fhir/model/definitions.ts"
import { getResourceMeta, setSkippedTools } from "../fhir/model/metadata.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes } from "../fhir/auth/scopes.ts"
import { filterByMetadata, filterByScopes } from "./filter-definitions.ts"
import { getEnabledActions } from "./validation.ts"
import { makeHandler } from "./handler.ts"

let registeredCount = 0

const
   LOCAL_CONTROLS = new Set(["fhirpath", ...(config.responseMode !== "compact-locked" ? ["responseMode"] : [])]),
   WRITE_WITH_BODY = new Set<ToolAction>(["create", "update", "patch"])

const augmentSchema = (
   def: ResourceDefinition, meta: ResourceMeta | undefined,
   controlParams: Record<string, string>, scopeMap: Map<string, Set<ScopePermission>>,
): { schema: z.ZodObject<z.ZodRawShape>; injected: string[]; description: string } => {
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

   const
      actions = getEnabledActions(def, scopeMap),
      hasWrites = actions.some((a) => WRITE_WITH_BODY.has(a)),
      shape: Record<string, z.ZodTypeAny> = { ...buildShape(merged, def.resource, def.supportsDirectRead) }

   if (actions.length > 1 || hasWrites) {
      shape["action"] = z.enum(actions as [string, ...string[]])
         .optional()
         .describe(`Operation to perform: ${actions.join(", ")}. Omit for search/read (default behavior).`)
      injected.push("action")
   }
   if (hasWrites) {
      shape["body"] = z.string()
         .optional()
         .describe("Full FHIR resource JSON for create/update, or JSON Patch array (RFC 6902) for patch")
      injected.push("body")
   }

   const
      writeActions = actions.filter((a): a is WriteAction => WRITE_WITH_BODY.has(a) || a === "delete"),
      writeHints = writeActions
         .map((a) => (messages[`writeAction${a[0].toUpperCase()}${a.slice(1)}` as keyof typeof messages] as string)
            .replace("{resourceType}", def.resource))
         .join(" "),
      description = writeHints
         ? `${def.description} ${writeHints}`
         : def.description

   return { schema: z.object(shape), injected, description }
}

/** Returns the number of resource tools registered after metadata + scope gating. */
export const getRegisteredToolCount = (): number => registeredCount

/** Registers an MCP tool for every ResourceDefinition in the current snapshot. */
export const registerAll = (server: McpServer): void => {
   const
      controlParams = getSearchControls(),
      scopeMap = parseGrantedScopes(getTokenResponse().scope),
      metaResult = filterByMetadata(getDefinitions()),
      scopeResult = filterByScopes(metaResult.definitions, scopeMap)

   setSkippedTools([...metaResult.skipped, ...scopeResult.skipped])
   scopeMap.size > 0 && console.info(`🔑 Scope gate active — ${scopeResult.definitions.length}/${metaResult.definitions.length} resource(s) allowed`)

   for (const def of scopeResult.definitions) {
      const
         meta = getResourceMeta(def.resource),
         { schema, injected, description } = augmentSchema(def, meta, controlParams, scopeMap)
      config.debug && injected.length && console.log(`📋 ${def.resource}: injected ${injected.join(", ")}`)
      server.registerTool(
         def.toolName,
         { description, inputSchema: schema },
         makeHandler(def.toolName),
      )
   }
   registeredCount = scopeResult.definitions.length
}
