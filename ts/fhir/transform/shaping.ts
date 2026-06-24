import { config } from "../../config.ts"
import { log } from "../../log.ts"
import { isMetadataAvailable, getResourceMeta } from "../model/metadata.ts"

const MCP_LOCAL = new Set(["action", "body", "fhirpath", "responseMode", "maxResults", "prefetch", "_vid", "_since", "_at"])

/** Returns whether _count injection/capping is allowed for the given resource type given current metadata mode. */
export const canShapeCount = (resource: string): { allowed: boolean, warn?: boolean } => {
   if (!isMetadataAvailable() || config.metadataMode === "off")
      return { allowed: true }
   if (getResourceMeta(resource)?.searchParams.has("_count"))
      return { allowed: true }
   if (config.metadataMode === "warn")
      return { allowed: true, warn: true }
   return { allowed: false }
}

const shapeCount = (params: URLSearchParams, resource: string): { injected: boolean, capped: boolean } => {
   const
      raw = params.get("_count"),
      n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN
   if (raw === null || !Number.isFinite(n) || n < 1) {
      if (config.fhirDefaultCount === 0) return { injected: false, capped: false }
      params.set("_count", String(config.fhirDefaultCount))
      log.debug(`✂️ ${resource}: _count${raw === null ? ` not provided, defaulted to ${config.fhirDefaultCount}` : `="${raw}" invalid, replaced with ${config.fhirDefaultCount}`}`)
      return { injected: true, capped: false }
   }
   if (config.fhirMaxCount > 0 && n > config.fhirMaxCount) {
      params.set("_count", String(config.fhirMaxCount))
      log.debug(`✂️ ${resource}: _count=${n} capped to ${config.fhirMaxCount}`)
      return { injected: false, capped: true }
   }
   return { injected: false, capped: false }
}

/** Builds a FHIR search URL from tool args, injecting and capping _count as configured. */
export const buildSearchUrl = (
   resource: string,
   args: Record<string, unknown>,
   applyCount: boolean,
): { url: string, countInjected: boolean, countCapped: boolean, countSkipped: boolean } => {
   const params = new URLSearchParams()
   for (const [key, val] of Object.entries(args))
      !MCP_LOCAL.has(key) && val !== undefined && val !== "" && params.append(key, String(val))
   let countInjected = false, countCapped = false
   const countSkipped = !applyCount
   if (applyCount) {
      const s = shapeCount(params, resource)
      countInjected = s.injected
      countCapped = s.capped
   } else {
      log.debug(`✂️ ${resource}: _count skipped (not advertised, strict mode)`)
   }
   const qs = params.toString()
   return {
      url: qs ? `${resource}?${qs}` : resource,
      countInjected,
      countCapped,
      countSkipped,
   }
}

/** Replaces _count in an existing search URL (e.g. for byte-limit auto-retry). */
export const rebuildWithCount = (url: string, count: number): string => {
   const
      qIdx = url.indexOf("?"),
      base = qIdx >= 0 ? url.slice(0, qIdx) : url,
      params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "")
   params.set("_count", String(count))
   return `${base}?${params.toString()}`
}

/** Builds a FHIR history URL with optional _since, _at, and _count query params. */
export const buildHistoryUrl = (
   basePath: string, since?: string, at?: string, count?: number,
): string => {
   const params = new URLSearchParams()
   since && params.append("_since", since)
   at && params.append("_at", at)
   count && params.append("_count", String(count))
   const qs = params.toString()
   return qs ? `${basePath}?${qs}` : basePath
}
