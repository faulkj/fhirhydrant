import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { createFhirClient } from "../fhir/client.ts"
import { fetchMetadata, getCapabilitySummary } from "../fhir/metadata.ts"
import { withRetry, enforceByteLimit, formatFhirError } from "../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { responseNote, bundleStats } from "./response-notes.ts"
import { extractFhirPath, applyFhirPath } from "./fhirpath.ts"
import { extractResponseMode, compact } from "./compact.ts"

const
   coreToolsPath = (): string => {
      const
         bundled = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "core-tools.json"),
         source = join(dirname(fileURLToPath(import.meta.url)), "../..", "config", "core-tools.json")
      return existsSync(bundled) ? bundled : source
   },
   loadCoreTools = (): CoreToolDef[] =>
      JSON.parse(readFileSync(coreToolsPath(), "utf8")) as CoreToolDef[],
   validatePageUrl = (url: string): string => {
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

/** Registers built-in infrastructure tools (e.g. pagination, capabilities) on the server. */
export const registerCoreTools = (server: McpServer): void => {
   const
      tools = loadCoreTools(),
      buildSchema = (params: Record<string, { type: string; optional?: boolean; description: string }>) => {
         const shape: Record<string, z.ZodTypeAny> = {}
         for (const [key, p] of Object.entries(params)) {
            const base = p.type === "boolean" ? z.boolean() : z.string()
            shape[key] = p.optional ? base.optional().describe(p.description) : base.describe(p.description)
         }
         return z.object(shape)
      },
      def = (name: string) => tools.find((t) => t.name === name)!

   const paginateParams = config.responseMode === "compact-locked"
      ? Object.fromEntries(Object.entries(def("paginate").params).filter(([k]) => k !== "responseMode"))
      : def("paginate").params

   server.registerTool(
      "paginate",
      { description: def("paginate").description, inputSchema: buildSchema(paginateParams) },
      async (args: Record<string, unknown>) => {
         const
            fhirpathExpr = extractFhirPath(args),
            explicit = extractResponseMode(args),
            locked = config.responseMode === "compact-locked",
            t0 = Date.now()
         if (explicit === null)
            return { content: [{ type: "text" as const, text: "Invalid responseMode — must be \"compact\" or \"full\"" }], isError: true }
         const
            effectiveMode: ResponseMode = locked
               ? "compact"
               : explicit ?? (config.responseMode === "full" ? "full" : "compact"),
            wasDefaulted = !locked && explicit === undefined
         try {
            const
               validatedUrl = validatePageUrl(args["url"] as string),
               client = createFhirClient()

            config.debug
               ? console.log(`🔥 paginate → ${validatedUrl}`)
               : console.log("🔥 paginate")

            const result = await withRetry("paginate", () => client.request(validatedUrl))
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

            if (effectiveMode === "compact" && !filtered) {
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
            console.log("🔥 paginate OK")
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
            console.error(`🔥 paginate ERR ${log}`)
            emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return {
               content: [{ type: "text" as const, text: messages.paginationRetryHint.replace("{message}", client) }],
               isError: true,
            }
         }
      },
   )

   server.registerTool(
      "capabilities",
      { description: def("capabilities").description, inputSchema: buildSchema(def("capabilities").params) },
      async (args: Record<string, unknown>) => {
         const t0 = Date.now()
         try {
            if (args["refresh"]) await fetchMetadata()
            const summary = getCapabilitySummary()
            if (!summary) {
               emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "ok", durationMs: auditTime(t0) })
               return {
                  content: [{ type: "text" as const, text: messages.capabilitiesUnavailable }],
               }
            }
            emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "ok", durationMs: auditTime(t0), ...(args["refresh"] ? { httpStatus: 200 } : {}) })
            return {
               content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
            }
         } catch (err) {
            const { log, client } = formatFhirError(err)
            console.error(`🏥 capabilities ERR ${log}`)
            emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return {
               content: [{ type: "text" as const, text: client }],
               isError: true,
            }
         }
      },
   )
}
