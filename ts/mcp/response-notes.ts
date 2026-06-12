/** Parses Bundle stats from a FHIR response — shared between response notes and audit. */
export const bundleStats = (result: unknown, json: string): BundleStats | undefined => {
   if (!result || typeof result !== "object") return undefined
   const r = result as Record<string, unknown>
   if (r.resourceType !== "Bundle") return undefined
   const
      links = Array.isArray(r.link) ? r.link : [],
      next = links.find(
         (l): l is Record<string, unknown> =>
            !!l && typeof l === "object" && (l as Record<string, unknown>).relation === "next" && typeof (l as Record<string, unknown>).url === "string",
      )
   return {
      entries: Array.isArray(r.entry) ? r.entry.length : 0,
      total: typeof r.total === "number" ? r.total : undefined,
      jsonBytes: Buffer.byteLength(json, "utf8"),
      nextUrl: next ? String((next as Record<string, unknown>).url) : undefined,
   }
}

/** Builds a compact text note for a FHIR response — always includes the resourceType label,
 *  enriches Bundles with entry count, total, next link, and appends jsonBytes for all types. */
export const responseNote = (result: unknown, json: string): string | undefined => {
   if (!result || typeof result !== "object") return undefined
   const rt = (result as Record<string, unknown>).resourceType
   if (typeof rt !== "string") return undefined
   const stats = bundleStats(result, json)
   if (!stats) return `${rt} jsonBytes=${Buffer.byteLength(json, "utf8")}`
   const parts = [
      `Bundle entries=${stats.entries}`,
      stats.total !== undefined ? `total=${stats.total}` : undefined,
      `jsonBytes=${stats.jsonBytes}`,
   ].filter(Boolean).join(" ")
   return stats.nextUrl ? `${parts}. Next: ${stats.nextUrl}` : parts
}
