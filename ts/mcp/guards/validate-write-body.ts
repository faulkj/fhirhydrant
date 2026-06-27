import messages from "../../../config/messages/write.json" with { type: "json" }

/**
 * Pure client-side structural validation for write payloads. No config/audit/log
 * imports — returns blocking errors and non-blocking warnings for the caller to act on.
 * Assumes the body is already JSON-parsed and resourceType-matched by the write guard.
 */
export const validateWriteBody = (
   body: unknown, action: ToolAction, resource: string,
): WriteBodyValidation => {
   const result: WriteBodyValidation = { errors: [], warnings: [] }

   if (action === "patch") {
      validatePatch(body, result)
      return result
   }

   const obj = body as Record<string, unknown>

   if (typeof obj["id"] === "string" && !FHIR_ID.test(obj["id"]))
      result.errors.push(messages.validateInvalidId.replace("{value}", obj["id"]))

   if (action === "create" && obj["id"] != null)
      result.warnings.push(messages.validateCreateHasId.replace("{resourceType}", resource))

   scanReferences(obj, result, 0)
   return result
}

const
   FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/,
   REFERENCE = /^(#[A-Za-z0-9\-.]{1,64}|[A-Z][a-zA-Z]+\/[A-Za-z0-9\-.]{1,64}|(https?|urn):\S+)$/,
   PATCH_OPS = new Set(["add", "remove", "replace", "move", "copy", "test"]),
   MAX_DEPTH = 6,

   validatePatch = (body: unknown, result: WriteBodyValidation): void => {
      if (!Array.isArray(body)) return
      for (let i = 0; i < body.length; i++) {
         const e = body[i] as Record<string, unknown>
         if (!e || typeof e !== "object" || typeof e["op"] !== "string" || !PATCH_OPS.has(e["op"]))
            result.errors.push(messages.validatePatchBadOp.replace("{index}", String(i)).replace("{value}", String(e?.["op"] ?? "missing")))
         else if (typeof e["path"] !== "string" || !e["path"].startsWith("/"))
            result.errors.push(messages.validatePatchBadPath.replace("{index}", String(i)))
      }
   },

   scanReferences = (node: unknown, result: WriteBodyValidation, depth: number): void => {
      if (depth > MAX_DEPTH || !node || typeof node !== "object") return
      if (Array.isArray(node)) {
         for (const item of node) scanReferences(item, result, depth + 1)
         return
      }
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
         if (key === "reference" && typeof val === "string" && val && !REFERENCE.test(val))
            result.warnings.push(messages.validateBadReference.replace("{value}", val))
         else if (val && typeof val === "object")
            scanReferences(val, result, depth + 1)
      }
   }
