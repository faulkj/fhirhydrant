import type { McpServer } from "@modelcontextprotocol/server"
import type { z } from "zod"
import messages from "../../../config/messages.json" with { type: "json" }
import { config } from "../../config.ts"
import { createFhirClient } from "../../fhir/auth/client.ts"
import { withRetry, enforceByteLimit, formatFhirError } from "../../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../../audit.ts"
import { responseNote, bundleStats } from "../../fhir/transform/response-notes.ts"
import { extractFhirPath, applyFhirPath } from "../../fhir/transform/fhirpath.ts"
import { extractResponseMode, resolveResponseMode, compact } from "../../fhir/transform/compact.ts"

/** Registers the paginate tool for fetching next-page Bundle results. */
export const addPaginate = (
   server: McpServer, description: string, inputSchema: z.ZodObject<z.ZodRawShape>,
): void => {
   server.registerTool(
      "paginate",
      { description, inputSchema },
      async (args: Record<string, unknown>) => {
         const
            fhirpathExpr = extractFhirPath(args),
            explicit = extractResponseMode(args),
            t0 = Date.now(),
            resolved = resolveResponseMode(explicit)
         if (!resolved)
            return { content: [{ type: "text" as const, text: "Invalid responseMode — must be \"compact\" or \"full\"" }], isError: true }
         const { effectiveMode, wasDefaulted } = resolved
         try {
            const
               validatedUrl = validatePageUrl(args["url"] as string),
               client = createFhirClient()

            config.debug && console.log(`🔥 Paginate → ${validatedUrl}`)

            const result = await withRetry(
               "paginate",
               (signal) => client.request({ url: validatedUrl, signal }),
               3,
               config.fhirRequestTimeoutMs,
            )
            let json = JSON.stringify(result, null, 2), filtered = false, matchCount = 0, compacted = false
            const
               stats = bundleStats(result, json),
               sourceBytes = Buffer.byteLength(json, "utf8")

            if (fhirpathExpr) {
               const fp = applyFhirPath(result, fhirpathExpr)
               if ("error" in fp) {
                  emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0), httpStatus: 200, fhirpathFiltered: true })
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
                  responseNote(result, json),
                  filtered
                     ? messages.fhirpathFiltered
                        .replace("{matchCount}", String(matchCount))
                        .replace("{sourceBytes}", String(sourceBytes))
                     : undefined,
                  wasDefaulted && compacted ? messages.responseModeCompact : undefined,
               ].filter(Boolean),
               prefix = notes.length ? notes.join("\n") + "\n\n" : "",
               shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)
            console.log("🟢 Paginate OK")
            emitAudit({
               ts: new Date().toISOString(), tool: "paginate", operation: "paginate",
               status: shaped.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
               jsonBytes: Buffer.byteLength(json, "utf8"),
               ...(stats && { bundleEntries: stats.entries, bundleTotal: stats.total, hasNext: !!stats.nextUrl }),
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
            console.error(`🔴 Paginate ERR ${log}`)
            emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return {
               content: [{ type: "text" as const, text: messages.paginationRetryHint.replace("{message}", client) }],
               isError: true,
            }
         }
      },
   )
}

const validatePageUrl = (url: string): string => {
   const
      baseHref = config.fhirServerUrl.replace(/\/?$/, "/"),
      serverUrl = new URL(baseHref),
      nextUrl = new URL(url, baseHref)

   if (nextUrl.origin !== serverUrl.origin)
      throw new Error(messages.paginationOriginMismatch
         .replace("{actual}", nextUrl.origin)
         .replace("{expected}", serverUrl.origin))

   const
      basePath = serverUrl.pathname.replace(/\/*$/, "/"),
      prefixes = [...(basePath.length > 1 ? [basePath] : []), ...config.paginationPaths]
   if (prefixes.length && !prefixes.some((p) => nextUrl.pathname === p.slice(0, -1) || nextUrl.pathname.startsWith(p)))
      throw new Error(messages.paginationPathMismatch
         .replace("{actual}", nextUrl.pathname))
   return nextUrl.toString()
}
