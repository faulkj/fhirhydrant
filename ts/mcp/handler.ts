import messages from "../../config/messages.json" with { type: "json" }
import { log } from "../log.ts"
import { getDefinitions } from "../fhir/model/definitions.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes, scopeActions } from "../fhir/auth/scopes.ts"
import { emitAudit, auditTime } from "../audit.ts"
import { canShapeCount, buildSearchUrl, buildHistoryUrl } from "../fhir/transform/shaping.ts"
import { checkRuntimeCapability } from "./validation.ts"
import { validateResourceRequest } from "./request-guards.ts"
import { isWriteOp, executeWrite } from "./handler-write.ts"
import { executeRead } from "./read-response.ts"

/** Returns an async MCP tool handler bound to the given resource tool name. */
export const makeHandler =
   (toolName: string) => async (args: Record<string, unknown>) => {
      const def = getDefinitions().find((d) => d.toolName === toolName)
      if (!def)
         return { content: [{ type: "text" as const, text: messages.toolNotFound.replace("{toolName}", toolName) }], isError: true }

      const
         t0 = Date.now(),
         guard = validateResourceRequest(def, args, toolName, t0)
      if (!guard.ok) return guard.response
      const { directId, op } = guard

      // Scope check — history-instance/history-type check as ToolAction "history"
      const
         scopeAction = (op === "history-instance" || op === "history-type") ? "history" : op,
         scopeAllowed = scopeActions(def.resource, parseGrantedScopes(getTokenResponse().scope))
      if (!scopeAllowed.has(scopeAction as ToolAction)) {
         log.debug(`🔑 ${def.resource}.${op} scope blocked — not permitted by granted scopes`)
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resource: def.resource, operation: op, status: "blocked", durationMs: auditTime(t0), scopeBlocked: true })
         return { content: [{ type: "text" as const, text: `🔑 ${op} not permitted by granted scopes for ${def.resource}` }], isError: true }
      }

      if (isWriteOp(op)) return executeWrite(toolName, def, op, args, t0, guard.parsedBody)

      // Runtime metadata check
      const cap = checkRuntimeCapability(def, args, directId, op)
      if (cap.error) {
         log.debug(`🏥 ${def.resource}.${op} metadata blocked — ${cap.error}`)
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resource: def.resource, operation: op, status: "blocked", durationMs: auditTime(t0), metadataBlocked: true })
         return { content: [{ type: "text" as const, text: cap.error }], isError: true }
      }

      // URL selection
      const
         isSingle = op === "read" || op === "vread",
         since = typeof args["_since"] === "string" && args["_since"] ? args["_since"] : undefined,
         at = typeof args["_at"] === "string" && args["_at"] ? args["_at"] : undefined,
         count = args["_count"] != null ? Number(args["_count"]) : undefined

      let url: string, search: ReturnType<typeof buildSearchUrl> | undefined
      const extraNotes: string[] = cap.warning ? [cap.warning] : []

      if (op === "vread")
         url = `${def.resource}/${directId}/_history/${guard.versionId}`
      else if (op === "history-instance")
         url = buildHistoryUrl(`${def.resource}/${directId}/_history`, since, at, count)
      else if (op === "history-type")
         url = buildHistoryUrl(`${def.resource}/_history`, since, at, count)
      else if (directId)
         url = `${def.resource}/${directId}`
      else {
         const shape = canShapeCount(def.resource)
         search = buildSearchUrl(def.resource, args, shape.allowed)
         url = search.url
         if (shape.warn) extraNotes.push(messages.countNotAdvertised.replace("{resourceType}", def.resource))
      }

      return executeRead({
         url, tool: toolName, resource: def.resource, op, args, t0,
         isBundle: !isSingle, allowCoalesce: !isSingle, search, notes: extraNotes,
      })
   }
