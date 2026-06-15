import type { McpServer } from "@modelcontextprotocol/server"
import type { z } from "zod"
import messages from "../../../config/messages.json" with { type: "json" }
import { fetchMetadata, getCapabilitySummary } from "../../fhir/model/metadata.ts"
import { formatFhirError } from "../../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../../audit.ts"

/** Registers the capabilities tool for querying the FHIR server's CapabilityStatement. */
export const addCapabilities = (
   server: McpServer, description: string, inputSchema: z.ZodObject<z.ZodRawShape>,
): void => {
   server.registerTool(
      "capabilities",
      { description, inputSchema },
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
