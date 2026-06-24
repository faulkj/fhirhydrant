import { config } from "../../config.ts"
import { withRetry, enforceByteLimit } from "../utils.ts"
import { compact } from "./compact.ts"
import { tryChunkBundle } from "./bundle-chunks.ts"
import { coalesceNote } from "./response-notes.ts"

/** Extracts and removes `maxResults` from tool args; returns parsed positive int or undefined. */
export const extractMaxResults = (args: Record<string, unknown>): number | undefined => {
   const raw = args["maxResults"]
   delete args["maxResults"]
   if (raw === undefined || raw === null || raw === "") return undefined
   const n = typeof raw === "number" ? raw : Number(raw)
   return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined
}

/** Extracts and removes `prefetch` from tool args; returns false only when explicitly disabled. */
export const extractPrefetch = (args: Record<string, unknown>): boolean => {
   const raw = args["prefetch"]
   delete args["prefetch"]
   return String(raw).toLowerCase() !== "false"
}

/**
 * Coalesces multiple upstream FHIR pages into one compact Bundle.
 * Compacts each page immediately and accumulates only compact entries.
 * Returns a complete MCP-ready response with notes and audit stats.
 */
export const coalesce = async (
   firstResult: unknown,
   client: { request: (opts: { url: string; signal?: AbortSignal }) => Promise<unknown> },
   label: string,
   maxResults?: number,
   t0?: number,
): Promise<CoalesceResult> => {
   const
      start = t0 ?? Date.now(),
      entries: unknown[] = [],
      cap = maxResults ?? config.prefetchMaxEntries

   let
      pages = 0,
      entriesSeen = 0,
      rawBytes = 0,
      nextUrl: string | undefined = undefined,
      truncated = false,
      truncateReason: string | undefined = undefined,
      bundleType: unknown = undefined,
      bundleTotal: unknown = undefined,
      current: unknown = firstResult

   while (current) {
      const b = current as Record<string, unknown>
      if (pages === 0) {
         bundleType = b.type
         bundleTotal = b.total
      }

      const pageJson = JSON.stringify(current)
      rawBytes += Buffer.byteLength(pageJson, "utf8")

      const pageEntries = Array.isArray(b.entry) ? b.entry as unknown[] : []
      entriesSeen += pageEntries.length

      const compacted = compact(current) as Record<string, unknown>
      const compactEntries = Array.isArray(compacted.entry) ? compacted.entry as unknown[] : []
      entries.push(...compactEntries)
      pages++

      const links = Array.isArray(b.link) ? b.link as Record<string, unknown>[] : []
      nextUrl = links.find((l) => l?.relation === "next" && typeof l?.url === "string")?.url as string | undefined

      if (!nextUrl) break
      if (pages >= config.prefetchMaxPages)
         truncated = true, truncateReason = "maxPages"
      else if (entries.length >= cap)
         truncated = true, truncateReason = "maxResults"
      else if (entriesSeen >= config.prefetchMaxEntries)
         truncated = true, truncateReason = "maxEntries"
      else if (rawBytes >= config.prefetchMaxBytes)
         truncated = true, truncateReason = "maxBytes"
      else if (Date.now() - start >= config.prefetchTimeoutMs)
         truncated = true, truncateReason = "timeout"
      if (truncated) break

      try {
         current = await withRetry(
            label,
            (signal) => client.request({ url: nextUrl!, signal }),
            3,
            config.fhirRequestTimeoutMs,
         )
      } catch {
         truncated = true
         truncateReason = "fetchError"
         break
      }
   }

   const bundle: Record<string, unknown> = { resourceType: "Bundle" }
   bundleType !== undefined && (bundle.type = bundleType)
   bundleTotal !== undefined && (bundle.total = bundleTotal)
   entries.length && (bundle.entry = entries)
   truncated && nextUrl && (bundle.link = [{ relation: "next", url: nextUrl }])

   const
      hasMore = truncated && !!nextUrl,
      note = coalesceNote(pages, entriesSeen, entries.length, hasMore, truncated ? truncateReason : undefined),
      json = JSON.stringify(bundle),
      prefix = `${note}\n\n`,
      shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)

   let text = shaped.text, isError = !!shaped.isError
   if (shaped.isError) {
      const chunked = tryChunkBundle(bundle, prefix, config.fhirMaxResponseBytes)
      if (chunked) text = chunked.text, isError = false
   }

   return {
      text,
      isError,
      pagesFetched: pages,
      entriesSeen,
      entriesReturned: entries.length,
      rawBytes,
      truncated,
      ...(truncateReason && { truncateReason }),
   }
}
