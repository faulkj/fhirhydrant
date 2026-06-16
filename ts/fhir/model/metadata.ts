import { config } from "../../config.ts"
import { createFhirClient } from "../auth/client.ts"
import { withRetry } from "../utils.ts"

let
   cache: CapabilitySummary | null = null,
   resourceIndex = new Map<string, ResourceMeta>(),
   skipped: CapabilitySummary["skippedTools"] = []

/** Fetches and caches the FHIR server's CapabilityStatement. Non-throwing. */
export const fetchMetadata = async (): Promise<void> => {
   try {
      const
         client = createFhirClient(),
         raw = await withRetry(
            "metadata",
            (signal) => client.request({ url: "metadata", signal }),
            3,
            config.fhirRequestTimeoutMs,
         ) as Record<string, unknown>

      if (raw?.resourceType !== "CapabilityStatement") {
         console.warn("🏥 Response is not a CapabilityStatement — skipping metadata gating")
         return
      }

      const
         restEntries = Array.isArray(raw.rest) ? raw.rest as Array<Record<string, unknown>> : [],
         serverRest = restEntries.find((r) => r.mode === "server") ?? restEntries[0]

      if (!serverRest) {
         console.warn("🏥 No rest entry found in CapabilityStatement — skipping metadata gating")
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
            revincludes = Array.isArray(res.searchRevInclude)
               ? (res.searchRevInclude as string[]).filter(Boolean)
               : [],
            operations = Array.isArray(res.operation)
               ? (res.operation as Array<Record<string, unknown>>)
                  .map((o) => o.name as string)
                  .filter(Boolean)
               : []

         newIndex.set(type, { interactions, searchParams, includes, revincludes, operations })
         summaryResources.push({
            type,
            interactions: [...interactions],
            searchParams: [...searchParams],
            operations,
            includes,
            revincludes,
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
      config.debug && console.info(`🏥 Loaded CapabilityStatement — ${summaryResources.length} resource types`)
   } catch (err) {
      console.warn(
         "🏥 Could not fetch CapabilityStatement — skipping metadata gating:",
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

/** Updates the skipped-tools state. Called by mcp/validation.ts after filtering. */
export const setSkippedTools = (list: CapabilitySummary["skippedTools"]): void => {
   skipped = list
   if (cache) cache.skippedTools = list
}
