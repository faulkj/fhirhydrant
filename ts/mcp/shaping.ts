import { config } from "../config.ts"
import { isMetadataAvailable, getResourceMeta } from "../fhir/metadata.ts"

export const canShapeCount = (resourceType: string): { allowed: boolean, warn?: boolean } => {
   if (!isMetadataAvailable() || config.metadataMode === "off")
      return { allowed: true }
   if (getResourceMeta(resourceType)?.searchParams.has("_count"))
      return { allowed: true }
   if (config.metadataMode === "warn")
      return { allowed: true, warn: true }
   return { allowed: false }
}

const shapeCount = (params: URLSearchParams, resourceType: string): { injected: boolean, capped: boolean } => {
   const
      raw = params.get("_count"),
      n = raw !== null ? parseInt(raw, 10) : NaN
   if (raw === null || !Number.isFinite(n) || n < 1) {
      params.set("_count", String(config.fhirDefaultCount))
      config.debug && console.log(`[shaping] ${resourceType}: _count${raw === null ? ` not provided, defaulted to ${config.fhirDefaultCount}` : `="${raw}" invalid, replaced with ${config.fhirDefaultCount}`}`)
      return { injected: true, capped: false }
   }
   if (n > config.fhirMaxCount) {
      params.set("_count", String(config.fhirMaxCount))
      config.debug && console.log(`[shaping] ${resourceType}: _count=${n} capped to ${config.fhirMaxCount}`)
      return { injected: false, capped: true }
   }
   return { injected: false, capped: false }
}

export const buildSearchUrl = (
   resourceType: string,
   args: Record<string, unknown>,
   applyCount: boolean,
): { url: string, countInjected: boolean, countCapped: boolean, countSkipped: boolean } => {
   const params = new URLSearchParams()
   for (const [key, val] of Object.entries(args))
      val !== undefined && val !== "" && params.append(key, String(val))
   let countInjected = false, countCapped = false
   const countSkipped = !applyCount
   if (applyCount) {
      const s = shapeCount(params, resourceType)
      countInjected = s.injected
      countCapped = s.capped
   } else {
      config.debug && console.log(`[shaping] ${resourceType}: _count skipped (not advertised, strict mode)`)
   }
   const qs = params.toString()
   return {
      url: qs ? `${resourceType}?${qs}` : resourceType,
      countInjected,
      countCapped,
      countSkipped,
   }
}
