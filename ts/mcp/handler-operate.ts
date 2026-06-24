import { config } from "../config.ts"
import { log } from "../log.ts"
import { createFhirClient } from "../fhir/auth/client.ts"
import { withRetry, formatFhirError } from "../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"
import { extractFhirPath } from "../fhir/transform/fhirpath.ts"
import { extractResponseMode, resolveResponseMode } from "../fhir/transform/compact.ts"
import { applyResponsePipeline } from "../fhir/transform/pipeline.ts"
import { validateOperateArgs } from "./operate-guards.ts"

/** Creates the handler function for the operate MCP tool. */
export const makeOperateHandler = (enabledOps: OperationDefinition[]) =>
   async (args: Record<string, unknown>) => {
      const
         t0 = Date.now(),
         fhirpathExpr = extractFhirPath(args),
         explicit = extractResponseMode(args)
      const guard = validateOperateArgs(args, enabledOps)
      if (!guard.ok) return guard.response

      const { op, id, resource, params, body } = guard

      const resolvedLevel: OperationLevel = id && op.level.includes("instance")
         ? "instance"
         : op.level.includes("type")
            ? "type"
            : "system"

      const url = resolvedLevel === "instance"
         ? `${resource}/${id}/${op.operation}`
         : resolvedLevel === "type"
            ? `${resource}/${op.operation}`
            : op.operation.replace(/^\$/, "/$")

      const qs = Object.entries(params)
         .filter(([k]) => k !== "resourceType")
         .flatMap(([k, v]) =>
            Array.isArray(v)
               ? v.map((item) => `${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`)
               : v != null ? [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`] : [])
         .join("&")

      const fullUrl = qs ? `${url}?${qs}` : url
      const logTag = `${resource}.${op.operation}`
      log.debug(`🔥 ${logTag} ${op.method} → ${fullUrl}`)

      // $match: validate Parameters shape and auto-inject onlyCertainMatches
      let finalBody = body
      if (op.key === "match" && finalBody) {
         try {
            const parsed = JSON.parse(finalBody)
            if (parsed.resourceType !== "Parameters" || !Array.isArray(parsed.parameter)) {
               emitAudit({ ts: new Date().toISOString(), tool: "operate", resource, operation: op.auditOperation as AuditEvent["operation"], status: "blocked", durationMs: auditTime(t0), validationBlocked: true })
               return { content: [{ type: "text" as const, text: "$match body must be a FHIR Parameters resource with a parameter array" }], isError: true }
            }
            if (!parsed.parameter.some((p: Record<string, unknown>) => p.name === "onlyCertainMatches"))
               parsed.parameter.push({ name: "onlyCertainMatches", valueBoolean: true })
            finalBody = JSON.stringify(parsed)
         } catch { /* JSON syntax errors caught by operate-guards */ }
      }

      try {
         const
            client = createFhirClient(),
            requestOpts: { url: string; method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } =
               op.method === "POST"
                  ? { url: fullUrl, method: "POST", ...(finalBody ? { body: finalBody, headers: { "Content-Type": "application/fhir+json" } } : {}) }
                  : { url: fullUrl }

         const result = await withRetry(
            `${resource} ${op.operation}`,
            (signal) => client.request({ ...requestOpts, signal }),
            3,
            config.fhirRequestTimeoutMs,
         )

         const resolved = resolveResponseMode(explicit, undefined)
         if (!resolved) {
            emitAudit({ ts: new Date().toISOString(), tool: "operate", resource, operation: op.auditOperation as AuditEvent["operation"], status: "error", durationMs: auditTime(t0), httpStatus: 200 })
            return { content: [{ type: "text" as const, text: "Invalid responseMode — must be \"compact\" or \"full\"" }], isError: true }
         }
         const
            { effectiveMode: rawMode, wasDefaulted } = resolved,
            effectiveMode = op.defaultResponseMode && wasDefaulted && !config.responseMode ? op.defaultResponseMode : rawMode
         const pipeline = applyResponsePipeline({
            result, bundleResponse: op.bundleResponse, fhirpathExpr, effectiveMode, wasDefaulted,
         })

         if ("error" in pipeline) {
            emitAudit({ ts: new Date().toISOString(), tool: "operate", resource, operation: op.auditOperation as AuditEvent["operation"], status: "error", durationMs: auditTime(t0), httpStatus: 200 })
            return { content: [{ type: "text" as const, text: pipeline.error }], isError: true }
         }

         log.debug(`🟢 ${logTag} OK (${Buffer.byteLength(pipeline.text, "utf8")}B, ${auditTime(t0)}ms)`)
         emitAudit({
            ts: new Date().toISOString(), tool: "operate", resource,
            operation: op.auditOperation as AuditEvent["operation"],
            status: pipeline.isError ? "truncated" : "ok",
            durationMs: auditTime(t0), httpStatus: 200,
            jsonBytes: Buffer.byteLength(pipeline.text, "utf8"),
            ...(pipeline.stats && { bundleEntries: pipeline.stats.entries, bundleTotal: pipeline.stats.total, hasNext: !!pipeline.stats.nextUrl }),
            ...(pipeline.fhirpathFiltered && { fhirpathFiltered: true, fhirpathMatchCount: pipeline.fhirpathMatchCount }),
            responseMode: pipeline.effectiveMode,
            ...(pipeline.compacted && { compacted: true }),
         })
         return { content: [{ type: "text" as const, text: pipeline.text }], ...(pipeline.isError && { isError: true }) }
      } catch (err) {
         const { log: errLog, client } = formatFhirError(err)
         log.error(`🔴 ${logTag} ERR ${errLog} (${auditTime(t0)}ms)`)
         emitAudit({ ts: new Date().toISOString(), tool: "operate", resource, operation: op.auditOperation as AuditEvent["operation"], status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err) })
         return { content: [{ type: "text" as const, text: client }], isError: true }
      }
   }
