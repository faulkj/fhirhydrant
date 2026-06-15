import { compactNode } from "./compact-model.ts"

export const extractResponseMode = (args: Record<string, unknown>): ResponseMode | null | undefined => {
   const raw = args["responseMode"]
   delete args["responseMode"]
   if (raw === undefined || raw === null || raw === "") return undefined
   return raw === "compact" || raw === "full" ? raw : null
}

export const compact = (data: unknown): unknown => {
   if (!data || typeof data !== "object") return data
   const r = data as Record<string, unknown>
   if (r.resourceType === "Bundle") {
      const
         entries = Array.isArray(r.entry)
            ? (r.entry as Record<string, unknown>[])
               .map((e) => {
                  const compacted = e.resource ? compactNode(e.resource, String((e.resource as Record<string, unknown>).resourceType), true) : undefined
                  return compacted !== undefined ? { resource: compacted } : undefined
               })
               .filter(Boolean)
            : undefined,
         nextLink = (Array.isArray(r.link) ? r.link as Record<string, unknown>[] : [])
            .find((l) => l?.relation === "next" && typeof l?.url === "string"),
         out: Record<string, unknown> = { resourceType: "Bundle" }
      r.type !== undefined && (out.type = r.type)
      r.total !== undefined && (out.total = r.total)
      nextLink && (out.link = [{ relation: "next", url: nextLink.url }])
      entries?.length && (out.entry = entries)
      return out
   }
   if (typeof r.resourceType === "string")
      return compactNode(data, r.resourceType as string, true) ?? data
   return data
}
