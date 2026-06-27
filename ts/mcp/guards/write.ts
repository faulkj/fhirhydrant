import messages from "../../../config/messages/write.json" with { type: "json" }
import { config } from "../../config/index.ts"
import { log } from "../../log.ts"
import { getEnabledActions } from "../validation.ts"
import { validateWriteBody } from "./validate-write-body.ts"

/** Validates a write-action request: checks capability gates, _id, body presence/shape, and resourceType. */
export const validateWriteRequest = (
   def: ResourceDefinition,
   args: Record<string, unknown>,
   action: ToolAction,
   block: (text: string, op: AuditEvent["operation"], extra?: Partial<AuditEvent>) => GuardResult,
): GuardResult => {
   const enabled = getEnabledActions(def)
   if (!enabled.includes(action)) {
      const msg = config.writeCapabilities.has(action as WriteAction)
         ? messages.writeNotAdvertised.replace("{resourceType}", def.resource).replace("{action}", action)
         : messages.writeNotEnabled.replace("{action}", action)
      return block(msg, action, { validationBlocked: true })
   }

   let parsedBody: unknown
   const id = typeof args["_id"] === "string" && args["_id"] ? args["_id"] : undefined
   if (NEEDS_ID.has(action) && !id)
      return block(messages.writeMissingId.replace("{action}", action), action, { validationBlocked: true })

   if (NEEDS_BODY.has(action)) {
      const raw = typeof args["body"] === "string" ? args["body"] : undefined
      if (!raw)
         return block(messages.writeMissingBody.replace("{action}", action), action, { validationBlocked: true })

      try { parsedBody = JSON.parse(raw) } catch (e) {
         return block(messages.writeInvalidBody.replace("{error}", e instanceof Error ? e.message : String(e)), action, { validationBlocked: true })
      }

      if (action === "patch") {
         if (!Array.isArray(parsedBody))
            return block(messages.writePatchInvalidFormat, action, { validationBlocked: true })
      } else {
         if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody))
            return block(messages.writeInvalidBody.replace("{error}", "expected a JSON object"), action, { validationBlocked: true })
         const body = parsedBody as Record<string, unknown>
         if (body.resourceType !== def.resource)
            return block(messages.writeResourceTypeMismatch
               .replace("{actual}", String(body.resourceType ?? "missing"))
               .replace("{expected}", def.resource), action, { validationBlocked: true })
         if (action === "update" && id && body.id && body.id !== id)
            return block(messages.writeResourceTypeMismatch
               .replace("{actual}", `body.id=${body.id}`)
               .replace("{expected}", `_id=${id}`), action, { validationBlocked: true })
         if (action === "update" && id && !body.id)
            (parsedBody as Record<string, unknown>).id = id
      }
   }

   // Lightweight structural validation (client-side) — runs on the normalized body
   if (config.validateWrites !== "off" && NEEDS_BODY.has(action)) {
      const { errors, warnings } = validateWriteBody(parsedBody, action, def.resource)
      for (const w of warnings) log.warn(`🔎 ${def.resource}.${action} — ${w}`)
      if (errors.length > 0)
         return block(messages.validateLocalFailed.replace("{issues}", errors.join("\n")), action, { validationBlocked: true })
   }

   return { ok: true, directId: id, op: action, parsedBody }
}

const
   NEEDS_BODY = new Set<ToolAction>(["create", "update", "patch"]),
   NEEDS_ID = new Set<ToolAction>(["update", "patch", "delete"])
