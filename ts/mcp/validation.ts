import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { isMetadataAvailable, getResourceMeta } from "../fhir/model/metadata.ts"
import { scopeActions } from "../fhir/auth/scopes.ts"

/** Returns actions available for a definition, considering write config, /metadata, and granted SMART scopes. */
export const getEnabledActions = (
   def: ResourceDefinition, scopeMap?: Map<string, Set<ScopePermission>>,
): ToolAction[] => {
   const
      actions: ToolAction[] = [],
      checkMeta = isMetadataAvailable() && config.metadataMode !== "off",
      meta = checkMeta ? getResourceMeta(def.resource) : undefined
   if (def.supportsDirectRead) actions.push("read")
   actions.push("search")
   for (const w of config.writeCapabilities)
      if (config.metadataMode === "off" || (checkMeta && meta?.interactions.has(writeInteraction[w])))
         actions.push(w)

   const allowed = scopeActions(def.resource, scopeMap)
   return allowed.size === 0 ? [] : actions.filter((action) => allowed.has(action))
}

/** Validates date-typed search params. Returns an error string for the first malformed value, or undefined if all are valid. */
export const validateDateArgs = (args: Record<string, unknown>): string | undefined => {
   for (const [k, v] of Object.entries(args)) {
      if (!isDateParam(k) || typeof v !== "string" || v === "") continue
      if (!FHIR_DATE.test(v))
         return messages.invalidDateParam.replace("{param}", k).replace("{value}", v)
   }
   return undefined
}

/**
 * Runtime capability check — called per-request in tool handlers.
 * Returns an error string to block the request, a warning string to prepend to the response, or neither.
 */
export const checkRuntimeCapability = (
   def: ResourceDefinition,
   args: Record<string, unknown>,
   directId: string | undefined,
): { error?: string; warning?: string } => {
   if (!isMetadataAvailable() || config.metadataMode === "off") return {}

   const meta = getResourceMeta(def.resource)

   if (!meta)
      return { error: messages.resourceNotAdvertised.replace("{resourceType}", def.resource) }

   if (!directId) {
      const
         mcpOnly = new Set(["action", "body", "fhirpath", "responseMode"]),
         unadvertised: string[] = [], badIncludes: string[] = [], badRevIncludes: string[] = []
      for (const [key, val] of Object.entries(args)) {
         if (key === "_id" || mcpOnly.has(key)) continue
         if (val === undefined || val === "") continue
         if (key === "_include") {
            if (!meta.includes.includes(val as string) && !meta.includes.includes("*")) badIncludes.push(val as string)
            continue
         }
         if (key === "_revinclude") {
            if (!meta.revincludes.includes(val as string) && !meta.revincludes.includes("*")) badRevIncludes.push(val as string)
            continue
         }
         if (!meta.searchParams.has(key)) unadvertised.push(key)
      }

      const parts: string[] = []
      if (unadvertised.length > 0)
         parts.push(messages.paramsNotAdvertised.replace("{params}", unadvertised.map((p) => `"${p}"`).join(", ")))
      if (badIncludes.length > 0)
         parts.push(messages.includesNotAdvertised.replace("{values}", badIncludes.map((v) => `"${v}"`).join(", ")))
      if (badRevIncludes.length > 0)
         parts.push(messages.revincludesNotAdvertised.replace("{values}", badRevIncludes.map((v) => `"${v}"`).join(", ")))

      if (parts.length > 0) {
         const msg = messages.capabilityMismatch
            .replace("{resourceType}", def.resource)
            .replace("{parts}", parts.join("; "))
         if (config.metadataMode === "strict")
            return { error: messages.capabilityStrict.replace("{msg}", msg) }
         return { warning: messages.capabilityWarn.replace("{msg}", msg) }
      }
   }

   return {}
}

const
   FHIR_DATE = /^(eq|ne|gt|lt|ge|le|sa|eb|ap)?\d{4}(-\d{2}(-\d{2})?)?$/,
   isDateParam = (name: string): boolean => name === "date" || name === "birthdate" || name.endsWith("-date"),

   writeInteraction: Record<WriteAction, string> = {
      create: "create", update: "update", patch: "patch", delete: "delete"
   }
