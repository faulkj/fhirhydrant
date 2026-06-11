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
         console.log(`[metadata] ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      if (def.supportsDirectRead && !meta.interactions.has("read"))
         console.warn(`[metadata] ${def.resourceType} does not advertise read — direct-read may fail`)

      if (!meta.interactions.has("search-type") && !meta.interactions.has("search"))
         console.warn(`[metadata] ${def.resourceType} does not advertise search — search may fail`)

      for (const param of Object.keys(def.searchParams)) {
         if (param === "_id") continue
         if (!meta.searchParams.has(param))
            console.warn(`[metadata] ${def.resourceType}: "${param}" not in /metadata — calls using this param will be blocked in strict mode`)
      }

      enabled.push(def)
   }

   setSkippedTools(skipped)
   return enabled
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
      return { error: `${def.resourceType} is not advertised by this FHIR server's /metadata.` }

   if (!directId) {
      const unadvertised: string[] = []
      for (const [key, val] of Object.entries(args)) {
         if (key === "_id") continue
         if (val === undefined || val === "") continue
         if (!meta.searchParams.has(key)) unadvertised.push(key)
      }

      if (unadvertised.length > 0) {
         const params = unadvertised.map((p) => `"${p}"`).join(", ")
         if (config.metadataMode === "strict")
            return {
               error: `${def.resourceType} search parameter ${params} not advertised by /metadata. Remove from definitions.json or set FHIR_METADATA_MODE=warn.`,
            }
         return {
            warning: `Note: ${def.resourceType} search parameter ${params} not advertised by /metadata — this call may be vendor-specific.`,
         }
      }
   }

   return {}
}
