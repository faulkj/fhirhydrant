import type { McpServer } from "@modelcontextprotocol/server"
import type { z } from "zod"
import messages from "../../../config/messages.json" with { type: "json" }
import { log } from "../../log.ts"
import { emitAudit, auditTime } from "../../audit.ts"
import { isChunkUrl, retrieveChunk } from "../../fhir/transform/bundle-chunks.ts"
import { validatePageUrl } from "./validate-page-url.ts"
import { readOnlyAnnotations } from "../annotations.ts"
import { executeRead } from "../read-response.ts"

/** Registers the paginate tool for fetching next-page Bundle results. */
export const addPaginate = (
   server: McpServer, description: string, inputSchema: z.ZodObject<z.ZodRawShape>,
): void => {
   server.registerTool(
      "paginate",
      { description, inputSchema, annotations: readOnlyAnnotations },
      async (args: Record<string, unknown>) => {
         const t0 = Date.now()
         try {
            const validatedUrl = validatePageUrl(args["url"] as string)

            if (isChunkUrl(validatedUrl)) {
               const text = retrieveChunk(validatedUrl)
               if (!text) {
                  emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0) })
                  return { content: [{ type: "text" as const, text: (messages as Record<string, string>)["paginationChunkExpired"] ?? "Chunk expired. Re-fetch the original server page URL." }], isError: true }
               }
               log.debug("🟢 Paginate (chunk)")
               emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "ok", durationMs: auditTime(t0) })
               return { content: [{ type: "text" as const, text }] }
            }

            return executeRead({
               url: validatedUrl, tool: "paginate", op: "paginate", args, t0,
               isBundle: true, allowCoalesce: true,
            })
         } catch (err) {
            // validatePageUrl throws on invalid URLs
            const msg = err instanceof Error ? err.message : String(err)
            log.error(`🔴 Paginate ERR ${msg} (${auditTime(t0)}ms)`)
            emitAudit({ ts: new Date().toISOString(), tool: "paginate", operation: "paginate", status: "error", durationMs: auditTime(t0) })
            return { content: [{ type: "text" as const, text: msg }], isError: true }
         }
      },
   )
}
