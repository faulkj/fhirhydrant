import type { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod"
import { config } from "../config.ts"
import { getDefinitions, getsearchControls, buildShape } from "../fhir/definitions.ts"
import { getResourceMeta } from "../fhir/metadata.ts"
import { createFhirClient } from "../fhir/client.ts"
import { withRetry, enforceByteLimit } from "../utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { canShapeCount, buildSearchUrl } from "./shaping.ts"
import { responseNote, bundleStats } from "./response-notes.ts"
import { filterAndValidateDefinitions, checkRuntimeCapability } from "./validation.ts"

const
   isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
      if (!supportsDirectRead) return undefined
      const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
      if (!id) return undefined
      return Object.entries(args).some(([k, v]) => k !== "_id" && v !== undefined && v !== "") ? undefined : id
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
         if (!directId && def.requireCombination) {
            const has = (k: string) => { const v = args[k]; return typeof v === "string" && v !== "" }
            const matched = def.requireCombination.some((combo) => combo.every(has))
            if (!matched) {
               const sets = def.requireCombination.map((c) => c.join(" + ")).join(", or ")
               emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), validationBlocked: true })
               return { content: [{ type: "text" as const, text: `${def.resourceType} search requires one of these parameter sets: ${sets}. Ask the user for the missing values.` }], isError: true }
            }
         }
         try {
            const
               shape = directId ? { allowed: false } : canShapeCount(def.resourceType),
               client = createFhirClient(),
               search = directId ? undefined : buildSearchUrl(def.resourceType, args, shape.allowed),
               url = directId ? `${def.resourceType}/${directId}` : search!.url

            config.debug ?
               console.log(`🔥 ${def.resourceType} ${op} → ${url}`)
            :  console.log(`🔥 ${def.resourceType} ${op}`)

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
            console.log(`🔥 ${def.resourceType} OK`)
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
            console.error(`🔥 ${def.resourceType} ERR ${message}`)
            emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
            return { content: [{ type: "text" as const, text: message }], isError: true }
         }
      }

const augmentSchema = (
   def: ResourceDefinition, meta: ResourceMeta, controlParams: Record<string, string>,
): { schema: z.ZodObject<z.ZodRawShape>; injected: string[] } => {
   const merged = { ...def.searchParams }, injected: string[] = []
   for (const [param, desc] of Object.entries(controlParams)) {
      if (merged[param]) continue
      if (param === "_include" || param === "_revinclude") {
         const values = param === "_include" ? meta.includes : meta.revincludes
         if (values.length === 0) continue
         const hint = values.length > 10 ? values.slice(0, 10).join(", ") + ", …" : values.join(", ")
         merged[param] = `${desc} (${hint})`
      } else {
         if (!meta.searchParams.has(param)) continue
         merged[param] = desc
      }
      injected.push(param)
   }
   return injected.length > 0
      ? { schema: z.object(buildShape(merged, def.resourceType, def.supportsDirectRead)), injected }
      : { schema: def.searchSchema, injected }
}

/** Registers an MCP tool for every ResourceDefinition in the current snapshot. */
export const registerAll = (server: McpServer): void => {
   const controlParams = getsearchControls()
   for (const def of filterAndValidateDefinitions(getDefinitions())) {
      const
         meta = getResourceMeta(def.resourceType),
         { schema, injected } = meta ? augmentSchema(def, meta, controlParams) : { schema: def.searchSchema, injected: [] as string[] }
      config.debug && injected.length && console.log(`📋 ${def.resourceType}: injected ${injected.join(", ")}`)
      server.registerTool(
         def.toolName,
         { description: def.description, inputSchema: schema },
         makeHandler(def.toolName),
      )
   }
}
