import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getDefinitions } from "../fhir/model/definitions.ts"
import { isMetadataAvailable, getSystemInteractions, getResourceMeta } from "../fhir/model/metadata.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes, scopeActions } from "../fhir/auth/scopes.ts"

/** Validates a raw Bundle body string against all preflight gates. */
export const validateBundleRequest = (body: string): BundleGuardResult => {
   let parsed: unknown
   try { parsed = JSON.parse(body) } catch (e) {
      return err(messages.bundleInvalidBody.replace("{error}", e instanceof Error ? e.message : String(e)))
   }

   const b = parsed as Record<string, unknown>
   if (b.resourceType !== "Bundle")
      return err(messages.bundleInvalidBody.replace("{error}", "resourceType is not Bundle"))

   const type = String(b.type ?? "").toLowerCase() as BundleType
   if (type !== "batch" && type !== "transaction")
      return err(messages.bundleInvalidType.replace("{type}", String(b.type ?? "")))

   if (!config.bundleCapabilities.has(type))
      return err(messages.bundleNotEnabled.replace("{type}", type))

   let warning: string | undefined
   if (isMetadataAvailable() && config.metadataMode !== "off") {
      const sys = getSystemInteractions()
      if (!sys.has(type)) {
         const msg = messages.bundleTypeNotAdvertised.replace("{type}", type)
         if (config.metadataMode === "strict") return err(msg)
         warning = msg
      }
   }

   const entries = Array.isArray(b.entry) ? b.entry as Array<Record<string, unknown>> : []
   if (entries.length === 0)
      return { ok: true, bundle: b, type, summary: { readCount: 0, writeCount: 0, resourceTypes: [] }, warning }

   const
      defs = new Map(getDefinitions().map((d) => [d.resource, d])),
      scopeMap = parseGrantedScopes(getTokenResponse().scope),
      resourceTypes = new Set<string>()
   let readCount = 0, writeCount = 0

   for (let i = 0; i < entries.length; i++) {
      const
         entry = entries[i],
         req = entry?.request as Record<string, unknown> | undefined

      if (!req || typeof req.method !== "string" || typeof req.url !== "string")
         return unsupported(i)
      if (req.ifMatch || req.ifNoneMatch || req.ifNoneExist || req.ifModifiedSince)
         return unsupported(i)

      const method = req.method.toUpperCase(), url = req.url as string
      if (url.includes("://") || url.startsWith("/") || url.includes("$")) return unsupported(i)

      const [path] = url.split("?"), segments = path.split("/"),
         resourceType = segments[0], hasId = segments.length > 1 && segments[1].length > 0,
         hIdx = segments.indexOf("_history")
      if (hIdx === 0) return unsupported(i) // bare system _history

      if (!resourceType || !defs.has(resourceType))
         return blocked(i, `resource type "${resourceType}" is not configured`)

      // Resolve action — detect vread/history from URL segments
      let action: ToolAction | undefined, historyOp: string | undefined
      if (hIdx >= 0 && method === "GET") {
         if (segments.length === 4 && hIdx === 2 && segments[3]?.length > 0) { action = "vread"; historyOp = "vread" }
         else if (segments.length === 3 && hIdx === 2 && hasId) { action = "history"; historyOp = "history-instance" }
         else if (segments.length === 2 && hIdx === 1) { action = "history"; historyOp = "history-type" }
         else return unsupported(i)
      } else if (hIdx >= 0) return unsupported(i)
      else action = resolveAction(method, hasId)
      if (!action) return unsupported(i)

      const allowed = scopeActions(resourceType, scopeMap)
      if (!allowed.has(action)) return blocked(i, `"${action}" not permitted by granted scopes for ${resourceType}`)

      // Metadata interaction check helper
      const metaWarn = (...interactions: string[]) => {
         if (!isMetadataAvailable() || config.metadataMode === "off") return undefined
         const meta = getResourceMeta(resourceType)
         if (!meta) return `${resourceType} is not advertised in /metadata`
         return interactions.some((i) => meta.interactions.has(i)) ? undefined : `${resourceType} does not advertise "${interactions[0]}" in /metadata`
      }
      const applyWarn = (reason: string | undefined) => {
         if (!reason) return
         if (config.metadataMode === "strict") return blocked(i, reason)
         warning = warning ? `${warning}; ${reason}` : reason
      }

      if (historyOp) { const r = applyWarn(metaWarn(historyOp)); if (r) return r }

      if (WRITE_ACTIONS.has(action)) {
         if (!config.bundleWritesEnabled) return err(messages.bundleWritesDisabled.replace("{index}", String(i)).replace("{action}", action))
         if (!config.writeCapabilities.has(action as WriteAction)) return err(messages.bundleWriteNotAllowed.replace("{index}", String(i)).replace("{action}", action))
         const r = applyWarn(metaWarn(WRITE_INTERACTION[action as WriteAction])); if (r) return r
         writeCount++
      } else {
         if (!historyOp) {
            const r = applyWarn(metaWarn(...(action === "read" ? ["read"] : ["search-type", "search"]))); if (r) return r
         }
         readCount++
      }
      resourceTypes.add(resourceType)
   }

   return { ok: true, bundle: b, type, summary: { readCount, writeCount, resourceTypes: [...resourceTypes] }, warning }
}

const
   WRITE_ACTIONS = new Set<ToolAction>(["create", "update", "patch", "delete"]),

   WRITE_INTERACTION: Record<WriteAction, string> = {
      create: "create", update: "update", patch: "patch", delete: "delete",
   },

   err = (text: string): BundleGuardResult =>
      ({ ok: false, response: { content: [{ type: "text" as const, text }], isError: true } }),

   unsupported = (i: number) => err(messages.bundleEntryUnsupported.replace("{index}", String(i))),

   blocked = (i: number, reason: string) =>
      err(messages.bundleEntryBlocked.replace("{index}", String(i)).replace("{reason}", reason)),

   resolveAction = (method: string, hasId: boolean): ToolAction | undefined => {
      if (method === "GET") return hasId ? "read" : "search"
      if (method === "POST" && !hasId) return "create"
      if (method === "PUT" && hasId) return "update"
      if (method === "PATCH" && hasId) return "patch"
      if (method === "DELETE" && hasId) return "delete"
      return undefined
   }
