import type { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { log } from "../log.ts"
import { getDefinitions, getSearchControls, buildShape } from "../fhir/model/definitions.ts"
import { getResourceMeta, setSkippedTools } from "../fhir/model/metadata.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes } from "../fhir/auth/scopes.ts"
import { filterByMetadata, filterByScopes } from "./filter-definitions.ts"
import { getEnabledActions } from "./validation.ts"
import { makeHandler } from "./handler.ts"
import { readOnlyAnnotations, writeAnnotations } from "./annotations.ts"

let registeredCount = 0

const
   LOCAL_CONTROLS = new Set(["fhirpath", "maxResults", "prefetch", ...(config.responseMode !== "compact-locked" ? ["responseMode"] : [])]),
   WRITE_WITH_BODY = new Set<ToolAction>(["create", "update", "patch"])

const augmentSchema = (
   def: ResourceDefinition, meta: ResourceMeta | undefined,
   controlParams: Record<string, string>, scopeMap: Map<string, Set<ScopePermission>>,
): { schema: z.ZodObject<z.ZodRawShape>; injected: string[]; description: string; actions: ToolAction[] } => {
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
      hasVread = actions.includes("vread"),
      hasHistory = actions.includes("history"),
      shape: Record<string, z.ZodTypeAny> = { ...buildShape(merged, def.resource, def.supportsDirectRead) }

   if (hasVread) {
      shape["_vid"] = z.string().optional().describe("Version id for vread — use with action=vread and _id")
      injected.push("_vid")
   }
   if (hasHistory) {
      shape["_since"] = z.string().optional().describe("Only include versions created at or after this date/dateTime (history)")
      shape["_at"] = z.string().optional().describe("Only include versions current at this instant (history)")
      injected.push("_since", "_at")
   }

   if (actions.length > 1 || hasWrites) {
      shape["action"] = z.enum(actions as [string, ...string[]])
         .optional()
         .describe(`Operation to perform: ${actions.join(", ")}. Omit for search/read. vread requires _id+_vid. history optionally takes _id for instance history.`)
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

   return { schema: z.object(shape), injected, description, actions }
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
   scopeMap.size > 0 && log.info(`🔑 Scope gate active — ${scopeResult.definitions.length}/${metaResult.definitions.length} resource(s) allowed`)

   for (const def of scopeResult.definitions) {
      const
         meta = getResourceMeta(def.resource),
         { schema, injected, description, actions } = augmentSchema(def, meta, controlParams, scopeMap),
         hasWrites = actions.some((a) => WRITE_WITH_BODY.has(a) || a === "delete"),
         annotations = hasWrites
            ? writeAnnotations(
               actions.includes("delete"),
               !actions.some((a) => a === "create" || a === "patch"),
            )
            : readOnlyAnnotations
      injected.length && log.debug(`📋 ${def.resource}: injected ${injected.join(", ")}`)
      server.registerTool(
         def.toolName,
         { description, inputSchema: schema, annotations },
         makeHandler(def.toolName),
      )
   }
   registeredCount = scopeResult.definitions.length
   log.info(`📋 Registered ${registeredCount} resource tool(s)`)
}
