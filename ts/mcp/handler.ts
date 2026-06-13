import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getDefinitions } from "../fhir/definitions.ts"
import { createFhirClient } from "../fhir/client.ts"
import { withRetry, enforceByteLimit } from "../utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { canShapeCount, buildSearchUrl } from "./shaping.ts"
import { responseNote, bundleStats } from "./response-notes.ts"
import { checkRuntimeCapability } from "./validation.ts"

export const isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
   if (!supportsDirectRead) return undefined
   const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
   if (!id) return undefined
   return Object.entries(args).some(([k, v]) => k !== "_id" && v !== undefined && v !== "") ? undefined : id
}

export const makeHandler =
   (toolName: string) => async (args: Record<string, unknown>) => {
      const def = getDefinitions().find((d) => d.toolName === toolName)
      if (!def)
         return {
            content: [{ type: "text" as const, text: messages.toolNotFound.replace("{toolName}", toolName) }],
            isError: true,
         }
      const
         directId = isDirectRead(args, def.supportsDirectRead),
         op: AuditEvent["operation"] = directId ? "read" : "search",
         cap = checkRuntimeCapability(def, args, directId),
         t0 = Date.now()
      if (cap.error) {
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), metadataBlocked: true })
         return { content: [{ type: "text" as const, text: cap.error }], isError: true }
      }
      if (!directId && def.requireOneOf) {
         const ok = def.requireOneOf.some((k) => { const v = args[k]; return typeof v === "string" && v !== "" })
         if (!ok) {
            emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), validationBlocked: true })
            return { content: [{ type: "text" as const, text: messages.requireOneOfFailed.replace("{keys}", def.requireOneOf.join(", ")) }], isError: true }
         }
      }
      if (!directId && def.requireCombination) {
         const has = (k: string) => { const v = args[k]; return typeof v === "string" && v !== "" }
         const matched = def.requireCombination.some((combo) => combo.every(has))
         if (!matched) {
            emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), validationBlocked: true })
            return { content: [{
               type: "text" as const,
               text: messages.requireCombinationFailed
                  .replace("{resourceType}", def.resourceType)
                  .replace("{sets}", def.requireCombination.map((combo) => combo.join(" + ")).join(", or ")),
            }], isError: true }
         }
      }
      try {
         const
            shape = directId ? { allowed: false } : canShapeCount(def.resourceType),
            client = createFhirClient(),
            search = directId ? undefined : buildSearchUrl(def.resourceType, args, shape.allowed),
            url = directId ? `${def.resourceType}/${directId}` : search!.url

         config.debug
            ? console.log(`🔥 ${def.resourceType} ${op} → ${url}`)
            : console.log(`🔥 ${def.resourceType} ${op}`)

         const
            result = await withRetry(`${def.resourceType} ${op}`, () => client.request(url)),
            json = JSON.stringify(result, null, 2),
            stats = bundleStats(result, json),
            notes = [
               cap.warning,
               shape.warn ? messages.countNotAdvertised.replace("{resourceType}", def.resourceType) : undefined,
               responseNote(result, json),
            ].filter(Boolean),
            prefix = notes.length ? notes.join("\n") + "\n\n" : "",
            shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)
         console.log(`🔥 ${def.resourceType} OK`)
         emitAudit({
            ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op,
            status: shaped.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
            jsonBytes: Buffer.byteLength(json, "utf8"),
            ...(stats && { bundleEntries: stats.entries, bundleTotal: stats.total, hasNext: !!stats.nextUrl }),
            ...(search && { countInjected: search.countInjected, countCapped: search.countCapped, countSkipped: search.countSkipped }),
            ...(cap.warning && { capWarning: true }),
         })
         return {
            content: [{ type: "text" as const, text: shaped.text }],
            ...(shaped.isError && { isError: true }),
         }
      } catch (err) {
         const message = err instanceof Error ? err.message : String(err)
         console.error(`🔥 ${def.resourceType} ERR ${message}`)
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
         return { content: [{ type: "text" as const, text: message }], isError: true }
      }
   }
