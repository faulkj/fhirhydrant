import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { getResourceMeta, isMetadataAvailable } from "../fhir/model/metadata.ts"
import { scopeAllowsResource } from "../fhir/auth/scopes.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes } from "../fhir/auth/scopes.ts"

let skippedOps: Array<{ key: string; reason: string; gate: "metadata" | "scope" }> = []

/** Returns operations skipped during gating — for capabilities output. */
export const getSkippedOperations = (): typeof skippedOps => skippedOps

/** Filters operations against cached /metadata. In strict mode, operations are skipped when the resource is missing or the operation is not advertised. In warn mode, unadvertised operations are registered with a debug note. */
export const filterOperationsByMetadata = (
   ops: OperationDefinition[],
): OperationDefinition[] => {
   if (!isMetadataAvailable() || config.metadataMode === "off") return ops

   const enabled: OperationDefinition[] = []
   skippedOps = []

   for (const op of ops) {
      if (!op.resource) { enabled.push(op); continue }
      const meta = getResourceMeta(op.resource)
      if (!meta && config.metadataMode === "strict") {
         const reason = `${op.resource} not in /metadata`
         config.debug && console.warn(`🏥 ${reason} — operation "${op.key}" skipped`)
         skippedOps.push({ key: op.key, reason, gate: "metadata" })
         continue
      }
      if (meta) {
         const opName = op.operation.replace(/^\$/, "")
         if (!meta.operations.includes(opName)) {
            if (config.metadataMode === "strict") {
               const reason = `${op.resource} does not advertise ${op.operation}`
               config.debug && console.warn(`🏥 ${reason} — operation "${op.key}" skipped`)
               skippedOps.push({ key: op.key, reason, gate: "metadata" })
               continue
            }
            config.debug && console.log(`🏥 ${op.resource} does not advertise ${op.operation} — registering anyway (warn mode)`)
         }
      }
      enabled.push(op)
   }
   return enabled
}

/** Filters operations against granted SMART scopes. */
export const filterOperationsByScopes = (
   ops: OperationDefinition[], scopeMap: Map<string, Set<ScopePermission>>,
): OperationDefinition[] => {
   if (scopeMap.size === 0) return ops
   const enabled: OperationDefinition[] = []
   for (const op of ops) {
      if (!op.resource) { enabled.push(op); continue }
      if (scopeAllowsResource(op.resource, scopeMap)) {
         enabled.push(op)
      } else {
         const reason = `${op.resource} not in granted scopes`
         config.debug && console.warn(`🔑 ${reason} — operation "${op.key}" skipped`)
         skippedOps.push({ key: op.key, reason, gate: "scope" })
      }
   }
   return enabled
}

const
   RESOURCE_TYPE_RE = /^[A-Z][a-zA-Z]+$/,
   FHIR_ID_RE = /^[A-Za-z0-9\-.]{1,64}$/

/** Runtime error helper. */
const err = (text: string) =>
   ({ ok: false as const, response: { content: [{ type: "text" as const, text }], isError: true as const } })

/** Validates operate tool args at invocation time. Returns the resolved operation or an error response. */
export const validateOperateArgs = (
   args: Record<string, unknown>, enabledOps: OperationDefinition[],
): { ok: true; op: OperationDefinition; id: string | undefined; resource: string; params: Record<string, unknown>; body: string | undefined }
   | { ok: false; response: { content: { type: "text"; text: string }[]; isError: true } } => {

   const rawKey = String(args["operation"] ?? "").toLowerCase().replace(/^\$/, "")
   const op = enabledOps.find((o) => o.key === rawKey)
   if (!op) return err(messages.operationNotFound.replace("{key}", rawKey))

   const
      id = args["id"] != null ? String(args["id"]) : undefined,
      resourceType = args["resourceType"] != null ? String(args["resourceType"]) : op.resource,
      params = (args["params"] ?? {}) as Record<string, unknown>,
      body = args["body"] != null ? String(args["body"]) : undefined

   if (!resourceType && !op.resource)
      return err(messages.operationMissingResourceType.replace("{operation}", op.operation))

   const resource = resourceType ?? op.resource!

   if (!RESOURCE_TYPE_RE.test(resource))
      return err(`Invalid resourceType "${resource}" — must be a valid FHIR resource type name`)

   if (id && !FHIR_ID_RE.test(id))
      return err(`Invalid id "${id}" — must be a valid FHIR resource id (1-64 alphanumeric/dash/dot characters)`)

   if (!op.resource) {
      if (isMetadataAvailable() && config.metadataMode === "strict" && !getResourceMeta(resource))
         return err(`${resource} is not available on this FHIR server (not in /metadata)`)
      const scopeMap = parseGrantedScopes(getTokenResponse().scope)
      if (scopeMap.size > 0 && !scopeAllowsResource(resource, scopeMap))
         return err((messages.operationScopeBlocked as string)
            .replace("{operation}", op.operation)
            .replace("{resource}", resource))
   }

   if (op.level.includes("instance") && !op.level.includes("type") && !id)
      return err(messages.operationMissingId.replace("{operation}", op.operation))

   for (const [k, def] of Object.entries(op.params)) {
      if (def.default != null && params[k] == null) params[k] = def.default
      if (!def.optional && params[k] == null)
         return err(messages.operationMissingRequiredParam
            .replace("{operation}", op.operation)
            .replace("{keys}", k))
   }

   for (const group of op.requiresOneOf) {
      if (!group.some((k) => params[k] != null))
         return err(messages.operationMissingRequiredParam
            .replace("{operation}", op.operation)
            .replace("{keys}", group.join(" or ")))
   }

   if (op.acceptsBody && op.method === "POST") {
      const mode = params["mode"] != null ? String(params["mode"]).toLowerCase() : undefined
      if (mode === "delete") {
         if (!id) return err(messages.operationMissingId.replace("{operation}", op.operation))
      } else if (!body) {
         return err(messages.operationMissingBody.replace("{operation}", op.operation))
      }
      if (body) {
         try { JSON.parse(body) }
         catch (e) {
            return err((messages.operationInvalidBody as string)
               .replace("{operation}", op.operation)
               .replace("{error}", e instanceof Error ? e.message : String(e)))
         }
      }
   }

   return { ok: true, op, id, resource, params, body }
}
