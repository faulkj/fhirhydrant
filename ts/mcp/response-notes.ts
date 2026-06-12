/** Builds a compact text note for a FHIR response — always includes the resourceType label,
 *  enriches Bundles with entry count, total, next link, and appends jsonBytes for all types. */
export const responseNote = (result: unknown, json: string): string | undefined => {
   if (!result || typeof result !== "object") return undefined
   const
      r = result as Record<string, unknown>,
      rt = r.resourceType
   if (typeof rt !== "string") return undefined
   const bytes = Buffer.byteLength(json, "utf8")
   if (rt !== "Bundle") return `${rt} jsonBytes=${bytes}`
   const
      entries = Array.isArray(r.entry) ? r.entry.length : 0,
      total = typeof r.total === "number" ? r.total : undefined,
      links = Array.isArray(r.link) ? r.link : [],
      next = links.find(
         (l): l is Record<string, unknown> =>
            !!l && typeof l === "object" && (l as Record<string, unknown>).relation === "next" && typeof (l as Record<string, unknown>).url === "string",
      ),
      parts = [
         `Bundle entries=${entries}`,
         total !== undefined ? `total=${total}` : undefined,
         `jsonBytes=${bytes}`,
      ].filter(Boolean).join(" ")
   return next ? `${parts}. Next: ${(next as Record<string, unknown>).url}` : parts
}
