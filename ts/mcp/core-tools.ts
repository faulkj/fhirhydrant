import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "../config.ts"
import { createFhirClient } from "../fhir/client.ts"
import { fetchMetadata, getCapabilitySummary } from "../fhir/metadata.ts"
import { withRetry, enforceByteLimit } from "../utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { responseNote, bundleStats } from "./response-notes.ts"

const
   // Probe cwd first, then bundled package root, then source layout fallback
   coreToolsPath = (): string => {
      const
         cwd = join(process.cwd(), "core-tools.json"),
         bundled = join(dirname(fileURLToPath(import.meta.url)), "..", "core-tools.json"),
         source = join(dirname(fileURLToPath(import.meta.url)), "../..", "core-tools.json")
      return existsSync(cwd) ? cwd
         : existsSync(bundled) ? bundled
         : source
   },
   loadCoreTools = (): CoreToolDef[] =>
      JSON.parse(readFileSync(coreToolsPath(), "utf8")) as CoreToolDef[],
   validatePageUrl = (url: string): string => {
      const
         baseHref = config.fhirServerUrl.replace(/\/?$/, "/"),
         serverUrl = new URL(baseHref),
         nextUrl = new URL(url, baseHref)
      if (nextUrl.origin !== serverUrl.origin)
         throw new Error(`Pagination URL origin "${nextUrl.origin}" does not match FHIR server origin "${serverUrl.origin}"`)
      if (!nextUrl.pathname.startsWith(serverUrl.pathname))
         throw new Error(`Pagination URL path "${nextUrl.pathname}" is outside FHIR server base path "${serverUrl.pathname}"`)
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

   server.registerTool(
      "paginate",
      { description: def("paginate").description, inputSchema: buildSchema(def("paginate").params) },
      async (args: Record<string, unknown>) => {
         const t0 = Date.now()
         try {
            const
               validatedUrl = validatePageUrl(args["url"] as string),
               client = createFhirClient()

            config.debug ?
               console.log(`[fhir] paginate → ${validatedUrl}`)
            :  console.log("[fhir] paginate")

            const
               result = await withRetry("paginate", () => client.request(validatedUrl)),
               json = JSON.stringify(result, null, 2),
               stats = bundleStats(result, json),
               note = responseNote(result, json),
               prefix = note ? note + "\n\n" : "",
               shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)
            console.log("[fhir] paginate OK")
            emitAudit({
               ts: new Date().toISOString(), tool: "paginate", operation: "paginate",
               status: shaped.isError ? "truncated" : "ok", durationMs: auditTime(t0), httpStatus: 200,
               jsonBytes: Buffer.byteLength(json, "utf8"),
               ...(stats && { bundleEntries: stats.entries, bundleTotal: stats.total, hasNext: !!stats.nextUrl }),
            })
            return {
               content: [{ type: "text" as const, text: shaped.text }],
               ...(shaped.isError && { isError: true }),
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[fhir] paginate ERR ${message}`)
            emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return {
               content: [{ type: "text" as const, text: `${message}\n\nRetry with the same url to resume from this page.` }],
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
                  content: [{ type: "text" as const, text: "No /metadata available. The server may not support CapabilityStatement, or FHIR_METADATA_MODE is set to off." }],
               }
            }
            emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "ok", durationMs: auditTime(t0), ...(args["refresh"] ? { httpStatus: 200 } : {}) })
            return {
               content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[metadata] capabilities ERR ${message}`)
            emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return {
               content: [{ type: "text" as const, text: message }],
               isError: true,
            }
         }
      },
   )
}
