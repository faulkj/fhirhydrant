import messages from "../../../config/messages/core.json" with { type: "json" }
import { log } from "../../log.ts"
import { getSearchControls } from "../../fhir/model/definitions.ts"
import { emitAudit, auditTime } from "../../audit.ts"
import { validateDateArgs } from "../validation.ts"
import { validateWriteRequest } from "./write.ts"

const
   WRITE_OPS = new Set<ToolAction>(["create", "update", "patch", "delete"]),
   FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/

/**
 * Validates a resource tool request: resolves action / direct-read, then checks
 * write guards, requireOneOf, requireCombination, and date constraints.
 */
export const validateResourceRequest = (
   def: ResourceDefinition, args: Record<string, unknown>, toolName: string, t0: number,
): GuardResult => {
   const
      action = typeof args["action"] === "string" ? args["action"] as ToolAction : undefined,
      block = (text: string, op: AuditEvent["operation"], extra?: Partial<AuditEvent>): GuardResult => {
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resource: def.resource, operation: op, status: "blocked", durationMs: auditTime(t0), ...extra })
         return { ok: false, response: { content: [{ type: "text" as const, text }], isError: true } }
      }

   // — Write action guards —
   if (action && WRITE_OPS.has(action)) return validateWriteRequest(def, args, action, block)

   // — Explicit vread action —
   if (action === "vread") {
      const
         id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined,
         vid = typeof args["_vid"] === "string" && args["_vid"] ? args["_vid"] : undefined
      if (!id || !vid) return block(messages.vreadMissingVid, "vread", { validationBlocked: true })
      if (!FHIR_ID.test(vid)) return block(messages.vreadInvalidVid.replace("{value}", vid), "vread", { validationBlocked: true })
      return { ok: true, directId: id, versionId: vid, op: "vread" }
   }

   // — Explicit history action —
   if (action === "history") {
      const
         id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined,
         dateErr = validateDateArgs(args)
      if (dateErr) return block(dateErr, id ? "history-instance" : "history-type", { validationBlocked: true })
      return { ok: true, directId: id, op: id ? "history-instance" : "history-type" }
   }

   // — Explicit read action —
   if (action === "read") {
      const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
      if (!id) return block("read action requires _id", "read", { validationBlocked: true })
      return { ok: true, directId: id, op: "read" }
   }

   // — Explicit search action — forces search semantics, no direct-read inference
   if (action === "search")
      return validateSearchArgs(def, args, block) ?? { ok: true, directId: undefined, op: "search" }

   // — Default: infer read vs search from args (existing behavior) —
   const
      directId = isDirectRead(args, def.supportsDirectRead),
      op: AuditEvent["operation"] = directId ? "read" : "search"

   if (!directId) {
      const fail = validateSearchArgs(def, args, block)
      if (fail) return fail
   }

   return { ok: true, directId, op }
}

const
   validateSearchArgs = (
      def: ResourceDefinition, args: Record<string, unknown>,
      block: (text: string, op: AuditEvent["operation"], extra?: Partial<AuditEvent>) => GuardResult,
   ): GuardResult | undefined => {
      const hasId = typeof args["_id"] === "string" && args["_id"] !== ""

      if (!hasId && def.requireOneOf) {
         const ok = def.requireOneOf.some((k) => typeof args[k] === "string" && args[k] !== "")
         if (!ok) {
            const idOnly = def.requireOneOf.length === 1 && def.requireOneOf[0] === "_id"
            return block(
               idOnly
                  ? messages.requireIdOnly.replace("{resourceType}", def.resource)
                  : messages.requireOneOfFailed.replace("{keys}", def.requireOneOf.join(", ")),
               "search", { validationBlocked: true },
            )
         }
      }

      if (!hasId && def.requireCombination) {
         const has = (k: string) => typeof args[k] === "string" && args[k] !== ""
         if (!def.requireCombination.some((combo) => combo.every(has)))
            return block(
               messages.requireCombinationFailed
                  .replace("{resourceType}", def.resource)
                  .replace("{sets}", def.requireCombination.map((combo) => combo.join(" + ")).join(", or ")),
               "search", { validationBlocked: true },
            )
      }

      const dateErr = validateDateArgs(args)
      if (dateErr) return block(dateErr, "search", { validationBlocked: true })

      return undefined
   },

   isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
      if (!supportsDirectRead) return undefined
      const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
      if (!id) return undefined
      const ignore = new Set(["_id", "action", "body", "_vid", "_since", "_at", ...Object.keys(getSearchControls())])
      const hasExtra = Object.entries(args).some(([k, v]) => !ignore.has(k) && v !== undefined && v !== "")
      hasExtra && log.debug(`🔥 ${id}: direct read demoted to search — extra params present`)
      return hasExtra ? undefined : id
   }
