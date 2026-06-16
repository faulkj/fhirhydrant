import { config } from "../config.ts"
import { isMetadataAvailable, getResourceMeta, setSkippedTools } from "../fhir/model/metadata.ts"

/**
 * Filters definitions against cached /metadata.
 * - Removes tools whose resource type is entirely absent from metadata (all modes).
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
      const meta = getResourceMeta(def.resource)

      if (!meta) {
         const reason = `${def.resource} not in /metadata`
         console.warn(`🏥 ${reason} — skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      if (def.supportsDirectRead && !meta.interactions.has("read")) {
         const reason = `${def.resource} does not advertise read`
         console.error(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      if (!meta.interactions.has("search-type") && !meta.interactions.has("search")) {
         const reason = `${def.resource} does not advertise search`
         console.error(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason })
         continue
      }

      for (const param of Object.keys(def.searchParams)) {
         if (param === "_id" || param === "_include" || param === "_revinclude") continue
         if (!meta.searchParams.has(param))
            console.warn(`🏥 ${def.resource}: "${param}" not in /metadata`)
      }

      enabled.push(def)
   }

   setSkippedTools(skipped)
   return enabled
}
