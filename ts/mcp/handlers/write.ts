import messages from "../../../config/messages/write.json" with { type: "json" }
import { config } from "../../config/index.ts"
import { log } from "../../log.ts"
import { createFhirClient } from "../../fhir/auth/client.ts"
import { withRetry, formatFhirError } from "../../fhir/utils.ts"
import { emitAudit, auditTime, errorStatus } from "../../audit.ts"

const
   WRITE_OPS = new Set<WriteAction>(["create", "update", "patch", "delete"]),
   SERVER_VALIDATE_OPS = new Set<WriteAction>(["create", "update"]),

   serverValidate = async (
      client: FhirClient, def: ResourceDefinition, op: WriteAction, body: unknown, id: string | undefined,
   ): Promise<string | undefined> => {
      const
         mode = op === "create" ? "create" : "update",
         url = op === "update" && id
            ? `${def.resource}/${id}/$validate?mode=${mode}`
            : `${def.resource}/$validate?mode=${mode}`
      try {
         const
            outcome = await withRetry(`${def.resource} $validate`, (signal) => client.request({
               url, method: "POST", body: JSON.stringify(body),
               headers: { "Content-Type": "application/fhir+json" }, signal,
            }), 3, config.fhirRequestTimeoutMs) as Record<string, unknown>,
            issues = fatalIssues(outcome)
         return issues.length ? messages.validateServerFailed.replace("{issues}", issues.join("\n")) : undefined
      } catch (err) {
         return messages.validateServerFailed.replace("{issues}", formatFhirError(err).client)
      }
   },

   fatalIssues = (outcome: Record<string, unknown>): string[] => {
      if (!outcome || outcome["resourceType"] !== "OperationOutcome" || !Array.isArray(outcome["issue"])) return []
      return (outcome["issue"] as Array<Record<string, unknown>>)
         .filter((i) => i["severity"] === "fatal" || i["severity"] === "error")
         .map((i) => String((i["details"] as Record<string, unknown>)?.["text"] ?? i["diagnostics"] ?? i["code"] ?? "error"))
   }

/** True when an operation is a write action. */
export const isWriteOp = (op: AuditEvent["operation"]): op is WriteAction =>
   WRITE_OPS.has(op as WriteAction)

/**
 * Executes a FHIR write operation (create/update/patch/delete) using fhirclient
 * native methods. Body validation and normalization is done by guards/request,
 * parsedBody is the already-validated (and id-injected for update) object.
 */
export const executeWrite = async (
   toolName: string, def: ResourceDefinition,
   op: WriteAction, args: Record<string, unknown>, t0: number,
   parsedBody?: unknown,
): Promise<{ content: { type: "text", text: string }[], isError?: true }> => {
   const
      logTag = `${def.resource}.${op[0].toUpperCase()}${op.slice(1)}`,
      id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined,
      body = parsedBody ?? (typeof args["body"] === "string" ? JSON.parse(args["body"]) : undefined)

   try {
      const
         client = createFhirClient()

      if (config.validateWrites === "server" && SERVER_VALIDATE_OPS.has(op)) {
         const failure = await serverValidate(client, def, op, body, id)
         if (failure) {
            log.debug(`🔎 ${logTag} server $validate blocked (${auditTime(t0)}ms)`)
            emitAudit({
               ts: new Date().toISOString(), tool: toolName, resource: def.resource,
               operation: "validate", status: "blocked", durationMs: auditTime(t0), validationBlocked: true,
            })
            return { content: [{ type: "text" as const, text: failure }], isError: true }
         }
      }

      log.info(`🔥 ${logTag} → ${op} ${def.resource}${id ? '/' + id : ''}`)
      const
         result = await withRetry(`${def.resource} ${op}`, () => {
            if (op === "create") return client.create(body)
            if (op === "update") return client.update(body)
            if (op === "delete") return client.delete(`${def.resource}/${id}`)
            // patch
            return client.patch(`${def.resource}/${id}`, body)
         }, 3, config.fhirRequestTimeoutMs),
         json = result ? JSON.stringify(result, null, 2) : `${op} succeeded`

      log.debug(`🟢 ${logTag} OK (${Buffer.byteLength(json, "utf8")}B, ${auditTime(t0)}ms)`)
      emitAudit({
         ts: new Date().toISOString(), tool: toolName, resource: def.resource,
         operation: op, status: "ok", durationMs: auditTime(t0), httpStatus: 200,
         jsonBytes: Buffer.byteLength(json, "utf8"),
      })
      return { content: [{ type: "text" as const, text: json }] }
   } catch (err) {
      const { log: errLog, client } = formatFhirError(err)
      log.error(`🔴 ${logTag} ERR ${errLog} (${auditTime(t0)}ms)`)
      emitAudit({
         ts: new Date().toISOString(), tool: toolName, resource: def.resource,
         operation: op, status: "error", durationMs: auditTime(t0), httpStatus: errorStatus(err),
      })
      return { content: [{ type: "text" as const, text: client }], isError: true }
   }
}
