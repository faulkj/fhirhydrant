import { config } from "../config.ts"
import { createFhirClient } from "../fhir/auth/client.ts"
import { withRetry, formatFhirError } from "../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../audit.ts"

const WRITE_OPS = new Set<WriteAction>(["create", "update", "patch", "delete"])

/** True when an operation is a write action. */
export const isWriteOp = (op: AuditEvent["operation"]): op is WriteAction =>
   WRITE_OPS.has(op as WriteAction)

/**
 * Executes a FHIR write operation (create/update/patch/delete) using fhirclient
 * native methods. Body validation and normalization is done by request-guards;
 * parsedBody is the already-validated (and id-injected for update) object.
 */
export const executeWrite = async (
   toolName: string, def: ResourceDefinition,
   op: WriteAction, args: Record<string, unknown>, t0: number,
   parsedBody?: unknown,
): Promise<{ content: { type: "text"; text: string }[]; isError?: true }> => {
   const
      logTag = `${def.resource}.${op[0].toUpperCase()}${op.slice(1)}`,
      id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined,
      body = parsedBody ?? (typeof args["body"] === "string" ? JSON.parse(args["body"]) : undefined)

   try {
      const
         client = createFhirClient(),
         result = await withRetry(`${def.resource} ${op}`, () => {
            if (op === "create") return client.create(body)
            if (op === "update") return client.update(body)
            if (op === "delete") return client.delete(`${def.resource}/${id}`)
            // patch
            return client.patch(`${def.resource}/${id}`, body)
         }, 3, config.fhirRequestTimeoutMs),
         json = result ? JSON.stringify(result, null, 2) : `${op} succeeded`

      config.debug && console.log(`🔥 ${logTag} OK`)
      emitAudit({
         ts: new Date().toISOString(), tool: toolName, resource: def.resource,
         operation: op, status: "ok", durationMs: auditTime(t0), httpStatus: 200,
         jsonBytes: Buffer.byteLength(json, "utf8"),
      })
      return { content: [{ type: "text" as const, text: json }] }
   } catch (err) {
      const { log, client } = formatFhirError(err)
      console.error(`🔴 ${logTag} ERR ${log}`)
      emitAudit({
         ts: new Date().toISOString(), tool: toolName, resource: def.resource,
         operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err),
      })
      return { content: [{ type: "text" as const, text: client }], isError: true }
   }
}
