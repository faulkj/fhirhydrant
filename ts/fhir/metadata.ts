import { config } from "../config.ts"
import { createFhirClient } from "./client.ts"
import { withRetry } from "./utils.ts"

let
   cache: CapabilitySummary | null = null,
   resourceIndex = new Map<string, ResourceMeta>(),
   skipped: CapabilitySummary["skippedTools"] = []

/** Fetches and caches the FHIR server's CapabilityStatement. Non-throwing. */
export const fetchMetadata = async (): Promise<void> => {
   try {
      const
         client = createFhirClient(),
         raw = await withRetry("metadata", () => client.request("metadata")) as Record<string, unknown>

      if (raw?.resourceType !== "CapabilityStatement") {
         console.warn("[metadata] Response is not a CapabilityStatement — skipping metadata gating")
         return
      }

      const
         restEntries = Array.isArray(raw.rest) ? raw.rest as Array<Record<string, unknown>> : [],
         serverRest = restEntries.find((r) => r.mode === "server") ?? restEntries[0]

      if (!serverRest) {
         console.warn("[metadata] No rest entry found in CapabilityStatement — skipping metadata gating")
         return
      }

      const
         resources = Array.isArray(serverRest.resource) ? serverRest.resource as Array<Record<string, unknown>> : [],
         newIndex = new Map<string, ResourceMeta>(),
         summaryResources: CapabilitySummary["resources"] = []

      for (const res of resources) {
         const type = res.type as string | undefined
         if (!type) continue

         const
            interactions = new Set<string>(
               Array.isArray(res.interaction)
                  ? (res.interaction as Array<Record<string, unknown>>)
                     .map((i) => i.code as string)
                     .filter(Boolean)
                  : [],
            ),
            searchParams = new Set<string>(
               Array.isArray(res.searchParam)
                  ? (res.searchParam as Array<Record<string, unknown>>)
                     .map((p) => p.name as string)
                     .filter(Boolean)
                  : [],
            ),
            includes = Array.isArray(res.searchInclude)
               ? (res.searchInclude as string[]).filter(Boolean)
               : [],
            operations = Array.isArray(res.operation)
               ? (res.operation as Array<Record<string, unknown>>)
                  .map((o) => o.name as string)
                  .filter(Boolean)
               : []

         newIndex.set(type, { interactions, searchParams, includes, operations })
         summaryResources.push({
            type,
            interactions: [...interactions],
            searchParams: [...searchParams],
            operations,
            includes,
         })
      }

      resourceIndex = newIndex
      cache = {
         serverUrl: config.fhirServerUrl,
         fetchedAt: new Date().toISOString(),
         mode: config.metadataMode,
         resources: summaryResources,
         skippedTools: skipped,
      }
      console.log(`[metadata] Loaded CapabilityStatement — ${summaryResources.length} resource types`)
   } catch (err) {
      console.warn(
         "[metadata] Could not fetch CapabilityStatement — skipping metadata gating:",
         err instanceof Error ? err.message : err,
      )
   }
}

/** Whether a cached CapabilityStatement is available. */
export const isMetadataAvailable = (): boolean => cache !== null

/** Returns parsed metadata for a single resource type, or undefined. */
export const getResourceMeta = (resourceType: string): ResourceMeta | undefined =>
   resourceIndex.get(resourceType)

/** Returns the trimmed, JSON-serializable capability summary, or null. */
export const getCapabilitySummary = (): CapabilitySummary | null => {
   if (!cache) return null
   return { ...cache, skippedTools: skipped }
}

/**
 * Filters definitions against cached /metadata.
 * - Removes tools whose resourceType is absent from metadata.
 * - In strict mode, throws if configured searchParams are not advertised.
 * - In warn mode, logs warnings for unadvertised params.
 * - Returns definitions unchanged when metadata is unavailable or mode is "off".
 */
export const filterAndValidateDefinitions = (defs: ResourceDefinition[]): ResourceDefinition[] => {
   if (!isMetadataAvailable() || config.metadataMode === "off") return defs

   const enabled: ResourceDefinition[] = []

   skipped = []

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

      let skip = false
      for (const param of Object.keys(def.searchParams)) {
         if (param === "_id") continue
         if (!meta.searchParams.has(param)) {
            const msg = `[metadata] ${def.resourceType}: "${param}" not in /metadata`
            if (config.metadataMode === "strict") {
               console.error(`${msg} — tool "${def.toolName}" skipped. Remove from definitions.json or set FHIR_METADATA_MODE=warn.`)
               skipped.push({ toolName: def.toolName, reason: `param "${param}" not in /metadata` })
               skip = true
               break
            } else
               console.warn(`${msg} — this call may be vendor-specific.`)
         }
      }

      if (!skip) enabled.push(def)
   }

   if (cache) cache.skippedTools = skipped

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
