import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getDefinitions, getSearchControls } from "../fhir/model/definitions.ts"
import { createFhirClient } from "../fhir/auth/client.ts"
import { withRetry, enforceByteLimit, formatFhirError } from "../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { canShapeCount, buildSearchUrl, rebuildWithCount } from "../fhir/transform/shaping.ts"
import { responseNote, bundleStats } from "../fhir/transform/response-notes.ts"
import { checkRuntimeCapability, validateDateArgs } from "./validation.ts"
import { extractFhirPath, applyFhirPath } from "../fhir/transform/fhirpath.ts"
import { extractResponseMode, compact } from "../fhir/transform/compact.ts"

/** Returns the resource ID for a direct read when exactly _id is set and the server supports it, otherwise undefined. */
export const isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
   if (!supportsDirectRead) return undefined
   const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
   if (!id) return undefined
   const ignore = new Set(["_id", ...Object.keys(getSearchControls())])
   return Object.entries(args).some(([k, v]) => !ignore.has(k) && v !== undefined && v !== "") ? undefined : id
}

/** Returns an async MCP tool handler bound to the given resource tool name. */
export const makeHandler =
   (toolName: string) => async (args: Record<string, unknown>) => {
      const def = getDefinitions().find((d) => d.toolName === toolName)
      if (!def)
         return {
            content: [{ type: "text" as const, text: messages.toolNotFound.replace("{toolName}", toolName) }],
            isError: true,
         }
      const
         fhirpathExpr = extractFhirPath(args),
         explicit = extractResponseMode(args),
         directId = isDirectRead(args, def.supportsDirectRead),
         op: AuditEvent["operation"] = directId ? "read" : "search",
         cap = checkRuntimeCapability(def, args, directId),
         locked = config.responseMode === "compact-locked",
         t0 = Date.now()
      if (explicit === null)
         return { content: [{ type: "text" as const, text: "Invalid responseMode — must be \"compact\" or \"full\"" }], isError: true }
      const
         effectiveMode: ResponseMode = locked
            ? "compact"
            : explicit ?? (config.responseMode === "full" ? "full" : config.responseMode === "compact" ? "compact" : directId ? "full" : "compact"),
         wasDefaulted = !locked && explicit === undefined
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
      const dateErr = !directId ? validateDateArgs(args) : undefined
      if (dateErr) {
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), validationBlocked: true })
         return { content: [{ type: "text" as const, text: dateErr }], isError: true }
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

         let result: unknown, json: string, stats: ReturnType<typeof bundleStats>, shaped: ReturnType<typeof enforceByteLimit>, filtered = false, matchCount = 0, compacted = false
         // eslint-disable-next-line no-constant-condition
         while (true) {
            result = await withRetry(`${def.resourceType} ${op}`, () => client.request(url))
            json = JSON.stringify(result, null, 2)
            stats = bundleStats(result, json)
            const sourceBytes = Buffer.byteLength(json, "utf8")

            if (fhirpathExpr) {
               const fp = applyFhirPath(result, fhirpathExpr)
               if ("error" in fp) {
                  emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: 200, fhirpathFiltered: true })
                  return { content: [{ type: "text" as const, text: messages.fhirpathError.replace("{error}", fp.error) }], isError: true }
               }
               filtered = true
               matchCount = fp.nodes.length
               json = JSON.stringify(fp.nodes, null, 2)
            }

            if (effectiveMode === "compact") {
               json = JSON.stringify(compact(JSON.parse(json)))
               compacted = true
            }

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
                  filtered
                     ? messages.fhirpathFiltered
                        .replace("{matchCount}", String(matchCount))
                        .replace("{sourceBytes}", String(sourceBytes))
                     : undefined,
                  wasDefaulted && compacted ? messages.responseModeCompact : undefined,
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
            ...(filtered && { fhirpathFiltered: true, fhirpathMatchCount: matchCount }),
            responseMode: effectiveMode,
            ...(compacted && { compacted: true }),
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
