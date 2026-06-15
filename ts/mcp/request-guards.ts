import messages from "../../config/messages.json" with { type: "json" }
import { getSearchControls } from "../fhir/model/definitions.ts"
import { emitAudit, auditTime } from "../audit.ts"
import { validateDateArgs } from "./validation.ts"

/**
 * Validates a resource tool request: resolves direct-read, then checks requireOneOf,
 * requireCombination, and date-argument constraints. Returns a discriminated result.
 */
export const validateResourceRequest = (
   def: ResourceDefinition, args: Record<string, unknown>, toolName: string, t0: number,
): GuardResult => {
   const
      directId = isDirectRead(args, def.supportsDirectRead),
      op: AuditEvent["operation"] = directId ? "read" : "search",
      block = (text: string, extra?: Partial<AuditEvent>): GuardResult => {
         emitAudit({ ts: new Date().toISOString(), tool: toolName, resourceType: def.resourceType, operation: op, status: "blocked", durationMs: auditTime(t0), ...extra })
         return { ok: false, response: { content: [{ type: "text" as const, text }], isError: true } }
      }

   if (!directId && def.requireOneOf) {
      const ok = def.requireOneOf.some((k) => { const v = args[k]; return typeof v === "string" && v !== "" })
      if (!ok) return block(messages.requireOneOfFailed.replace("{keys}", def.requireOneOf.join(", ")), { validationBlocked: true })
   }

   if (!directId && def.requireCombination) {
      const has = (k: string) => { const v = args[k]; return typeof v === "string" && v !== "" }
      const matched = def.requireCombination.some((combo) => combo.every(has))
      if (!matched)
         return block(
            messages.requireCombinationFailed
               .replace("{resourceType}", def.resourceType)
               .replace("{sets}", def.requireCombination.map((combo) => combo.join(" + ")).join(", or ")),
            { validationBlocked: true },
         )
   }

   const dateErr = !directId ? validateDateArgs(args) : undefined
   if (dateErr) return block(dateErr, { validationBlocked: true })

   return { ok: true, directId, op }
}

const isDirectRead = (args: Record<string, unknown>, supportsDirectRead: boolean): string | undefined => {
   if (!supportsDirectRead) return undefined
   const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
   if (!id) return undefined
   const ignore = new Set(["_id", ...Object.keys(getSearchControls())])
   return Object.entries(args).some(([k, v]) => !ignore.has(k) && v !== undefined && v !== "") ? undefined : id
}
