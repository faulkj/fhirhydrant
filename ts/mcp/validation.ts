import messages from "../../config/messages.json" with { type: "json" }
import { config } from "../config.ts"
import { isMetadataAvailable, getResourceMeta, setSkippedTools } from "../fhir/metadata.ts"

/**
 * Filters definitions against cached /metadata.
 * - Removes tools whose resourceType is entirely absent from metadata (all modes).
 * - Logs a warning for unadvertised searchParams (enforcement is deferred to checkRuntimeCapability).
 * - Returns definitions unchanged when metadata is unavailable or mode is "off".
 */
export const filterAndValidateDefinitions = (defs: ResourceDefinition[]): ResourceDefinition[] => {
   if (!isMetadataAvailable() || config.metadataMode === "off") {
      setSkippedTools([])
      return defs
   }

   const
      enabled: ResourceDefinition[] = [],
      skipped: CapabilitySummary["skippedTools"] = []

   for (const def of defs) {
      const meta = getResourceMeta(def.resourceType)

      if (!meta) {
         const reason = `${def.resourceType} not in /metadata`
         console.warn(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      if (def.supportsDirectRead && !meta.interactions.has("read")) {
         const reason = `${def.resourceType} does not advertise read interaction`
         console.error(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      if (!meta.interactions.has("search-type") && !meta.interactions.has("search")) {
         const reason = `${def.resourceType} does not advertise search interaction`
         console.error(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      for (const param of Object.keys(def.searchParams)) {
         if (param === "_id" || param === "_include" || param === "_revinclude") continue
         if (!meta.searchParams.has(param))
            console.warn(`🏥 ${def.resourceType}: "${param}" not in /metadata — calls using this param will be blocked in strict mode`)
      }

      enabled.push(def)
   }

   setSkippedTools(skipped)
   return enabled
}

const FHIR_DATE = /^(eq|ne|gt|lt|ge|le|sa|eb|ap)?\d{4}(-\d{2}(-\d{2})?)?$/
const isDateParam = (name: string): boolean => name === "date" || name === "birthdate" || name.endsWith("-date")

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

   const meta = getResourceMeta(def.resourceType)

   if (!meta)
      return { error: messages.resourceNotAdvertised.replace("{resourceType}", def.resourceType) }

   if (!directId) {
      const unadvertised: string[] = [], badIncludes: string[] = [], badRevIncludes: string[] = []
      for (const [key, val] of Object.entries(args)) {
         if (key === "_id") continue
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
            .replace("{resourceType}", def.resourceType)
            .replace("{parts}", parts.join("; "))
         if (config.metadataMode === "strict")
            return { error: messages.capabilityStrict.replace("{msg}", msg) }
         return { warning: messages.capabilityWarn.replace("{msg}", msg) }
      }
   }

   return {}
}
