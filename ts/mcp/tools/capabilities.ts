import type { McpServer } from "@modelcontextprotocol/server"
import type { z } from "zod"
import messages from "../../../config/messages.json" with { type: "json" }
import { fetchMetadata, getCapabilitySummary } from "../../fhir/model/metadata.ts"
import { getDefinitions } from "../../fhir/model/definitions.ts"
import { getTokenResponse } from "../../fhir/auth/auth.ts"
import { parseGrantedScopes } from "../../fhir/auth/scopes.ts"
import { formatFhirError } from "../../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../../audit.ts"
import { getEnabledActions } from "../validation.ts"

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
            const
               defsByType = new Map(getDefinitions().map((d) => [d.resource, d])),
               scopeMap = parseGrantedScopes(getTokenResponse().scope),
               enriched = {
                  ...summary,
                  grantedScope: getTokenResponse().scope,
                  resources: summary.resources.map((r) => {
                     const def = defsByType.get(r.type)
                     return { ...r, enabledOperations: def ? getEnabledActions(def, scopeMap) : [] }
                  }),
               }
            emitAudit({ ts: new Date().toISOString(), tool: "capabilities", operation: "capabilities", status: "ok", durationMs: auditTime(t0), ...(args["refresh"] ? { httpStatus: 200 } : {}) })
            return {
               content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }],
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
