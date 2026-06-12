import type { McpServer } from "@modelcontextprotocol/server"
import { config } from "../config.ts"
import { getDefinitions } from "../fhir/definitions.ts"
import { createFhirClient } from "../fhir/client.ts"
import { withRetry, enforceByteLimit } from "../utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { canShapeCount, buildSearchUrl } from "./shaping.ts"
import { responseNote, bundleStats } from "./response-notes.ts"
import { filterAndValidateDefinitions, checkRuntimeCapability } from "./validation.ts"

const
   isDirectRead = (
      args: Record<string, unknown>,
      supportsDirectRead: boolean,
   ): string | undefined => {
      if (!supportsDirectRead) return undefined
      const id =
         typeof args["_id"] === "string" && args["_id"] ?
            args["_id"]
         :  undefined
      if (!id) return undefined
      const otherKeys = Object.entries(args).some(
         ([k, v]) => k !== "_id" && v !== undefined && v !== "",
      )
      return otherKeys ? undefined : id
   },
   makeHandler =
      (toolName: string) => async (args: Record<string, unknown>) => {
         const def = getDefinitions().find((d) => d.toolName === toolName)
         if (!def)
            return {
               content: [{ type: "text" as const, text: `Tool "${toolName}" is no longer in definitions — restart to apply definition changes` }],
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
               return { content: [{ type: "text" as const, text: `Search requires at least one of: ${def.requireOneOf.join(", ")}` }], isError: true }
            }
         }
         try {
            const
               shape = directId ? { allowed: false } : canShapeCount(def.resourceType),
               client = createFhirClient(),
               search = directId ? undefined : buildSearchUrl(def.resourceType, args, shape.allowed),
               url = directId ? `${def.resourceType}/${directId}` : search!.url

            config.debug ?
               console.log(`[fhir] ${def.resourceType} ${op} → ${url}`)
            :  console.log(`[fhir] ${def.resourceType} ${op}`)

            const
               result = await withRetry(`${def.resourceType} ${op}`, () => client.request(url)),
               json = JSON.stringify(result, null, 2),
               stats = bundleStats(result, json),
               notes = [
                  cap.warning,
                  shape.warn ? `Note: _count was injected but ${def.resourceType} does not advertise it in /metadata.` : undefined,
                  responseNote(result, json),
               ].filter(Boolean),
               prefix = notes.length ? notes.join("\n") + "\n\n" : "",
               shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)
            console.log(`[fhir] ${def.resourceType} OK`)
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
            console.error(`[fhir] ${def.resourceType} ERR ${message}`)
            emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return { content: [{ type: "text" as const, text: message }], isError: true }
         }
      }

/** Registers an MCP tool for every ResourceDefinition in the current snapshot. */
export const registerAll = (server: McpServer): void => {
   for (const def of filterAndValidateDefinitions(getDefinitions()))
      server.registerTool(
         def.toolName,
         { description: def.description, inputSchema: def.searchSchema },
         makeHandler(def.toolName),
      )
}
