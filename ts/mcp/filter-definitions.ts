import { config } from "../config/index.ts"
import { log } from "../log.ts"
import { isMetadataAvailable, getResourceMeta } from "../fhir/model/metadata.ts"
import { scopeAllowsResource } from "../fhir/auth/scopes.ts"

/** Filters definitions against cached /metadata. Returns surviving definitions and skipped-tool reasons. */
export const filterByMetadata = (defs: ResourceDefinition[]): { definitions: ResourceDefinition[], skipped: CapabilitySummary["skippedTools"] } => {
   if (!isMetadataAvailable() || config.metadataMode === "off")
      return { definitions: defs, skipped: [] }

   const
      enabled: ResourceDefinition[] = [],
      skipped: CapabilitySummary["skippedTools"] = []

   for (const def of defs) {
      const meta = getResourceMeta(def.resource)

      if (!meta) {
         const reason = `${def.resource} not in /metadata`
         log.debug(`🏥 ${reason} — skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      if (def.supportsDirectRead && !meta.interactions.has("read")) {
         const reason = `${def.resource} does not advertise read`
         log.debug(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      if (!meta.interactions.has("search-type") && !meta.interactions.has("search")) {
         const reason = `${def.resource} does not advertise search`
         log.debug(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      if (def.trustConfig) {
         log.debug(`🏥 ${def.resource}: trustConfig set — keeping config searchParams over /metadata`)
         enabled.push(def)
         continue
      }

      const
         supported = (param: string) =>
            ALWAYS_ALLOWED.has(param) || meta.searchParams.has(param),
         searchParams: Record<string, string> = {}
      for (const [param, desc] of Object.entries(def.searchParams))
         if (supported(param)) searchParams[param] = desc
         else log.debug(`🏥 ${def.resource}: "${param}" not in /metadata — pruned`)

      const pruned = def.requireOneOf?.filter((set) => set.every(supported))
      if (def.requireOneOf?.length && !pruned?.length) {
         const reason = `${def.resource} has no satisfiable requireOneOf after metadata pruning`
         log.debug(`🏥 ${reason} — tool "${def.toolName}" skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "metadata" })
         continue
      }

      enabled.push({ ...def, searchParams, requireOneOf: pruned?.length ? pruned : undefined })
   }

   return { definitions: enabled, skipped }
}

const ALWAYS_ALLOWED = new Set(["_id", "_include", "_revinclude"])

/** Filters definitions against granted SMART scopes. Returns surviving definitions and skipped-tool reasons. */
export const filterByScopes = (
   defs: ResourceDefinition[], scopeMap: Map<string, Set<ScopePermission>>,
): { definitions: ResourceDefinition[], skipped: CapabilitySummary["skippedTools"] } => {
   if (scopeMap.size === 0) return { definitions: defs, skipped: [] }

   const
      enabled: ResourceDefinition[] = [],
      skipped: CapabilitySummary["skippedTools"] = []

   for (const def of defs) {
      if (scopeAllowsResource(def.resource, scopeMap)) {
         enabled.push(def)
      } else {
         const reason = `${def.resource} not in granted scopes`
         log.debug(`🔑 ${reason} — skipped`)
         skipped.push({ toolName: def.toolName, reason, gate: "scope" })
      }
   }

   return { definitions: enabled, skipped }
}
