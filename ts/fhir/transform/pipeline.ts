import messages from "../../../config/messages.json" with { type: "json" }
import { config } from "../../config.ts"
import { applyFhirPath } from "./fhirpath.ts"
import { compact } from "./compact.ts"
import { bundleStats, responseNote } from "./response-notes.ts"
import { enforceByteLimit } from "../utils.ts"
import { tryChunkBundle } from "./bundle-chunks.ts"

/** Options for the shared response pipeline. */
interface PipelineOpts {
   result: unknown
   bundleResponse: boolean
   fhirpathExpr?: string
   effectiveMode: ResponseMode
   wasDefaulted: boolean
   extraNotes?: string[]
}

/** Result from the response pipeline — ready to emit as MCP content. */
interface PipelineResult {
   text: string
   isError: boolean
   stats: BundleStats | undefined
   effectiveMode: ResponseMode
   compacted: boolean
   fhirpathFiltered: boolean
   fhirpathMatchCount: number
}

/** Applies FHIRPath, compact, byte-limit, chunk fallback, and response notes to a FHIR response. */
export const applyResponsePipeline = (opts: PipelineOpts): PipelineResult | { error: string } => {
   const
      { result, bundleResponse, fhirpathExpr, effectiveMode, wasDefaulted, extraNotes } = opts

   let
      json = JSON.stringify(result, null, 2),
      stats = bundleResponse ? bundleStats(result, json) : undefined,
      filtered = false,
      matchCount = 0,
      compacted = false

   const sourceBytes = Buffer.byteLength(json, "utf8")

   if (fhirpathExpr) {
      const fp = applyFhirPath(result, fhirpathExpr)
      if ("error" in fp) return { error: messages.fhirpathError.replace("{error}", fp.error) }
      filtered = true
      matchCount = fp.nodes.length
      json = JSON.stringify(fp.nodes, null, 2)
   }

   if (effectiveMode === "compact") {
      json = JSON.stringify(compact(JSON.parse(json)))
      compacted = true
   }
   const notes = [
      ...(extraNotes ?? []),
      bundleResponse && stats ? responseNote(result, json) : undefined,
      filtered ? messages.fhirpathFiltered.replace("{matchCount}", String(matchCount)).replace("{sourceBytes}", String(sourceBytes)) : undefined,
      wasDefaulted && compacted ? messages.responseModeCompact : undefined,
   ].filter(Boolean)

   const
      prefix = notes.length ? notes.join("\n") + "\n\n" : "",
      shaped = enforceByteLimit(`${prefix}${json}`, config.fhirMaxResponseBytes)

   if (shaped.isError && bundleResponse) {
      const chunked = tryChunkBundle(JSON.parse(json), prefix, config.fhirMaxResponseBytes)
      if (chunked)
         return { text: chunked.text, isError: false, stats, effectiveMode, compacted, fhirpathFiltered: filtered, fhirpathMatchCount: matchCount }
   }

   return {
      text: shaped.text,
      isError: !!shaped.isError,
      stats,
      effectiveMode,
      compacted,
      fhirpathFiltered: filtered,
      fhirpathMatchCount: matchCount,
   }
}
