import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getDefinitions, getsearchControls } from "../fhir/definitions.ts"
import { createFhirClient } from "../fhir/client.ts"
import { withRetry, enforceByteLimit, formatFhirError } from "../utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { canShapeCount, buildSearchUrl, rebuildWithCount } from "./shaping.ts"
import { responseNote, bundleStats } from "./response-notes.ts"
import { checkRuntimeCapability } from "./validation.ts"

export const isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
   if (!supportsDirectRead) return undefined
   const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
   if (!id) return undefined
   const ignore = new Set(["_id", ...Object.keys(getsearchControls())])
   return Object.entries(args).some(([k, v]) => !ignore.has(k) && v !== undefined && v !== "") ? undefined : id
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
            search = directId ? undefined : buildSearchUrl(def.resourceType, args, shape.allowed)
         let
            url = directId ? `${def.resourceType}/${directId}` : search!.url,
            retries = 0,
            currentCount = 0

         config.debug
            ? console.log(`🔥 ${def.resourceType} ${op} → ${url}`)
            : console.log(`🔥 ${def.resourceType} ${op}`)

         let result: unknown, json: string, stats: ReturnType<typeof bundleStats>, shaped: ReturnType<typeof enforceByteLimit>
         // eslint-disable-next-line no-constant-condition
         while (true) {
            result = await withRetry(`${def.resourceType} ${op}`, () => client.request(url))
            json = JSON.stringify(result, null, 2)
            stats = bundleStats(result, json)
            const
               notes = [
                  cap.warning,
                  shape.warn ? messages.countNotAdvertised.replace("{resourceType}", def.resourceType) : undefined,
                  retries > 0
                     ? messages.responseAutoRetried
                        .replace("{original}", String(search ? new URLSearchParams(search.url.split("?")[1] ?? "").get("_count") ?? "?" : "?"))
                        .replace("{reduced}", String(currentCount))
                        .replace("{limit}", String(config.fhirMaxResponseBytes))
                     : undefined,
                  responseNote(result, json),
               ].filter(Boolean),
               prefix = notes.length ? notes.join("\n") + "\n\n" : ""
            shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)
            if (!shaped.isError || !search || !stats) break
            const next = Math.floor((currentCount || stats.entries || config.fhirDefaultCount) / 2)
            if (next < 1) break
            currentCount = next
            retries++
            url = rebuildWithCount(search.url, currentCount)
            console.log(`✂️ ${def.resourceType}: response too large, retrying with _count=${currentCount}`)
         }

         console.log(`🔥 ${def.resourceType} OK`)
         emitAudit({
            ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op,
            status: shaped.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
            jsonBytes: Buffer.byteLength(json, "utf8"),
            ...(stats && { bundleEntries: stats.entries, bundleTotal: stats.total, hasNext: !!stats.nextUrl }),
            ...(search && { countInjected: search.countInjected, countCapped: search.countCapped, countSkipped: search.countSkipped }),
            ...(retries > 0 && { autoRetryCount: retries }),
            ...(cap.warning && { capWarning: true }),
         })
         return {
            content: [{ type: "text" as const, text: shaped.text }],
            ...(shaped.isError && { isError: true }),
         }
      } catch (err) {
         const { log, client } = formatFhirError(err)
         console.error(`🔥 ${def.resourceType} ERR ${log}`)
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
         return { content: [{ type: "text" as const, text: client }], isError: true }
      }
   }
