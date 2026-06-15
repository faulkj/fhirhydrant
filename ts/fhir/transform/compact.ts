import { config } from "../../config.ts"
import { compactNode } from "./compact-model.ts"

/**
 * Resolves the effective response mode from the explicit per-request value and global config.
 * @param explicit  Value from extractResponseMode (undefined = absent, null = invalid).
 * @param directId  When truthy, the request is a direct read (defaults to "full" when global mode is unset).
 */
export const resolveResponseMode = (
   explicit: ResponseMode | null | undefined, directId?: string,
): { effectiveMode: ResponseMode; wasDefaulted: boolean } | null => {
   if (explicit === null) return null
   const
      locked = config.responseMode === "compact-locked",
      effectiveMode: ResponseMode = locked
         ? "compact"
         : explicit ?? (config.responseMode === "full" ? "full" : config.responseMode === "compact" ? "compact" : directId ? "full" : "compact"),
      wasDefaulted = !locked && explicit === undefined
   return { effectiveMode, wasDefaulted }
}

/** Extracts and removes responseMode from tool args; returns undefined (absent), null (invalid), or the mode string. */
export const extractResponseMode = (args: Record<string, unknown>): ResponseMode | null | undefined => {
   const raw = args["responseMode"]
   delete args["responseMode"]
   if (raw === undefined || raw === null || raw === "") return undefined
   return raw === "compact" || raw === "full" ? raw : null
}

/** Compacts a FHIR resource or Bundle, stripping noise and simplifying well-known datatypes. */
export const compact = (data: unknown): unknown => {
   if (!data || typeof data !== "object") return data
   if (Array.isArray(data))
      return data.map((item) => compact(item)).filter((v) => v !== undefined)
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
   return compactNode(data, "", false) ?? data
}
