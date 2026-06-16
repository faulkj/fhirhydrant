import { config } from "../config.ts"
import { isMetadataAvailable, getResourceMeta } from "../fhir/model/metadata.ts"
import { scopeAllowsResource } from "../fhir/auth/scopes.ts"

/** Filters definitions against cached /metadata. Returns surviving definitions and skipped-tool reasons. */
export const filterByMetadata = (defs: ResourceDefinition[]): { definitions: ResourceDefinition[]; skipped: CapabilitySummary["skippedTools"] } => {
   if (!isMetadataAvailable() || config.metadataMode === "off")
      return { definitions: defs, skipped: [] }

   const
      enabled: ResourceDefinition[] = [],
      skipped: CapabilitySummary["skippedTools"] = []

   for (const def of defs) {
      const meta = getResourceMeta(def.resource)

      if (!meta) {
         const reason = `${def.resource} not in /metadata`
         config.debug && console.warn(`🏥 ${reason} — skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      if (def.supportsDirectRead && !meta.interactions.has("read")) {
         const reason = `${def.resource} does not advertise read`
         config.debug && console.warn(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      if (!meta.interactions.has("search-type") && !meta.interactions.has("search")) {
         const reason = `${def.resource} does not advertise search`
         config.debug && console.warn(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      for (const param of Object.keys(def.searchParams)) {
         if (param === "_id" || param === "_include" || param === "_revinclude") continue
         if (!meta.searchParams.has(param))
            config.debug && console.warn(`🏥 ${def.resource}: "${param}" not in /metadata`)
      }

      enabled.push(def)
   }

   return { definitions: enabled, skipped }
}

/** Filters definitions against granted SMART scopes. Returns surviving definitions and skipped-tool reasons. */
export const filterByScopes = (
   defs: ResourceDefinition[], scopeMap: Map<string, Set<ScopePermission>>,
): { definitions: ResourceDefinition[]; skipped: CapabilitySummary["skippedTools"] } => {
   if (scopeMap.size === 0) return { definitions: defs, skipped: [] }

   const
      enabled: ResourceDefinition[] = [],
      skipped: CapabilitySummary["skippedTools"] = []

   for (const def of defs) {
      if (scopeAllowsResource(def.resource, scopeMap)) {
         enabled.push(def)
      } else {
         const reason = `${def.resource} not in granted scopes`
         config.debug && console.warn(`🔑 ${reason} — skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "scope" })
      }
   }

   return { definitions: enabled, skipped }
}
