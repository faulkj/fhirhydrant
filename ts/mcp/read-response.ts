import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { log } from "../log.ts"
import { createFhirClient } from "../fhir/auth/client.ts"
import { withRetry, formatFhirError } from "../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { rebuildWithCount } from "../fhir/transform/shaping.ts"
import { extractFhirPath } from "../fhir/transform/fhirpath.ts"
import { extractResponseMode, resolveResponseMode } from "../fhir/transform/compact.ts"
import { coalesce, extractMaxResults, extractPrefetch } from "../fhir/transform/coalesce.ts"
import { applyResponsePipeline } from "../fhir/transform/pipeline.ts"

/** Options for the shared read/search/history/paginate execution wrapper. */
interface ReadOpts {
   url: string
   tool: string
   resource?: string
   op: AuditEvent["operation"]
   args: Record<string, unknown>
   t0: number
   isBundle: boolean
   allowCoalesce?: boolean
   search?: { url: string; countInjected: boolean; countCapped: boolean; countSkipped: boolean }
   notes?: string[]
}

/** Shared FHIR fetch → transform → audit execution. Returns an MCP tool response. */
export const executeRead = async (opts: ReadOpts) => {
   const
      { tool, resource, op, args, t0, isBundle, allowCoalesce, search, notes } = opts,
      fhirpathExpr = extractFhirPath(args),
      explicit = extractResponseMode(args),
      maxResults = extractMaxResults(args),
      prefetchEnabled = extractPrefetch(args),
      logTag = resource ? `${resource}.${op[0].toUpperCase()}${op.slice(1)}` : op

   const resolved = resolveResponseMode(explicit, !isBundle ? "unused" : undefined)
   if (!resolved)
      return { content: [{ type: "text" as const, text: "Invalid responseMode — must be \"compact\" or \"full\"" }], isError: true }
   const { effectiveMode, wasDefaulted } = resolved

   let url = opts.url, retries = 0, currentCount = 0
   log.debug(`🔥 ${logTag} → ${url}`)

   try {
      const client = createFhirClient()

      while (true) { // eslint-disable-line no-constant-condition
         const result = await withRetry(
            `${resource ?? "system"} ${op}`,
            (signal) => client.request({ url, signal }),
            3,
            config.fhirRequestTimeoutMs,
         )

         // Coalesce: multi-page fetch when conditions are met
         if (allowCoalesce && effectiveMode === "compact" && prefetchEnabled && !fhirpathExpr) {
            const r = result as Record<string, unknown>
            if (r.resourceType === "Bundle" && Array.isArray(r.link) &&
               (r.link as Record<string, unknown>[]).some((l) => l?.relation === "next" && typeof l?.url === "string")) {
               const c = await coalesce(result, client, logTag, maxResults, t0)
               log.debug(`🟢 ${logTag} OK (coalesced ${c.pagesFetched} pages, ${c.entriesReturned} entries)`)
               emitAudit({
                  ts: new Date().toISOString(), tool, resource, operation: op,
                  status: c.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
                  prefetchPages: c.pagesFetched, prefetchEntries: c.entriesReturned,
                  prefetchRawBytes: c.rawBytes, prefetchTruncated: c.truncated || undefined,
                  ...(c.truncateReason && { prefetchTruncateReason: c.truncateReason }),
                  responseMode: effectiveMode, compacted: true,
               })
               return { content: [{ type: "text" as const, text: c.text }], ...(c.isError && { isError: true }) }
            }
         }

         const retryNote = retries > 0
            ? messages.responseAutoRetried
               .replace("{original}", String(search ? new URLSearchParams(search.url.split("?")[1] ?? "").get("_count") ?? "?" : "?"))
               .replace("{reduced}", String(currentCount)).replace("{limit}", String(config.fhirMaxResponseBytes))
            : undefined
         const pipeline = applyResponsePipeline({
            result, bundleResponse: isBundle, fhirpathExpr, effectiveMode, wasDefaulted,
            extraNotes: [...(notes ?? []), ...(retryNote ? [retryNote] : [])].filter(Boolean) as string[],
         })
         if ("error" in pipeline) {
            emitAudit({ ts: new Date().toISOString(), tool, resource, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: 200, fhirpathFiltered: true })
            return { content: [{ type: "text" as const, text: pipeline.error }], isError: true }
         }

         // Count auto-retry: only for search paths with a rebuildable URL
         if (pipeline.isError && search && pipeline.stats) {
            const next = Math.floor((currentCount || pipeline.stats.entries || config.fhirDefaultCount) / 2)
            if (next >= 1) {
               currentCount = next
               retries++
               url = rebuildWithCount(search.url, currentCount)
               log.info(`✂️ ${resource}: response too large, retrying with _count=${currentCount}`)
               continue
            }
         }

         log.debug(`🟢 ${logTag} OK (${pipeline.stats?.entries ?? 1}E, ${auditTime(t0)}ms)`)
         emitAudit({
            ts: new Date().toISOString(), tool, resource, operation: op,
            status: pipeline.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
            ...(pipeline.stats && { bundleEntries: pipeline.stats.entries, bundleTotal: pipeline.stats.total, hasNext: !!pipeline.stats.nextUrl }),
            ...(search && { countInjected: search.countInjected, countCapped: search.countCapped, countSkipped: search.countSkipped }),
            ...(retries > 0 && { autoRetryCount: retries }),
            ...(pipeline.fhirpathFiltered && { fhirpathFiltered: true, fhirpathMatchCount: pipeline.fhirpathMatchCount }),
            responseMode: pipeline.effectiveMode,
            ...(pipeline.compacted && { compacted: true }),
         })
         return {
            content: [{ type: "text" as const, text: pipeline.text }],
            ...(pipeline.isError && { isError: true }),
         }
      }
   } catch (err) {
      const { log: errLog, client } = formatFhirError(err)
      log.error(`🔴 ${logTag} ERR ${errLog} (${auditTime(t0)}ms)`)
      emitAudit({ ts: new Date().toISOString(), tool, resource, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
      return { content: [{ type: "text" as const, text: client }], isError: true }
   }
}
