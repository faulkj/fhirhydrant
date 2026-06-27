/** A single parameter definition in config/core-tools.json. */
interface CoreToolParam {
   type: "string" | "boolean" | "number"
   optional?: boolean
   description: string
}

/** A single entry in config/core-tools.json. */
interface CoreToolDef {
   name: string
   description: string
   params: Record<string, CoreToolParam>
}

/** Parsed stats from a FHIR Bundle response — shared between response notes and audit. */
interface BundleStats {
   entries: number
   total: number | undefined
   jsonBytes: number
   nextUrl: string | undefined
}

/** Handle returned by transport start functions; provides attach (bind server factory) and close operations. */
interface TransportHandle {
   attach: (factory: () => import("@modelcontextprotocol/server").McpServer) => Promise<void>
   close: () => Promise<void>
}

/** Options for the shared read/search/history/paginate execution wrapper. */
interface ReadOpts {
   url: string
   tool: string
   resource?: string
   op: AuditEvent["operation"]
   args: Record<string, unknown>
   t0: number
   isBundle: boolean
   allowCoalesce?: boolean
   search?: { url: string; countInjected: boolean; countCapped: boolean; countSkipped: boolean }
   notes?: string[]
}

/** Result of pure client-side write-payload validation — blocking errors and non-blocking warnings. */
interface WriteBodyValidation {
   errors: string[]
   warnings: string[]
}

/** Result of resource request validation — either success (directId + op) or an early-exit MCP error response. */
type GuardResult =
   | { ok: true; directId: string | undefined; op: AuditEvent["operation"]; versionId?: string; parsedBody?: unknown }
   | { ok: false; response: { content: { type: "text"; text: string }[]; isError: true } }

/** Result from tryChunkBundle when chunking is possible. */
interface ChunkBuildResult {
   text: string
}

/** Return shape from the coalescing loop — MCP-ready response plus audit stats. */
interface CoalesceResult {
   text: string
   isError: boolean
   pagesFetched: number
   entriesSeen: number
   entriesReturned: number
   rawBytes: number
   truncated: boolean
   truncateReason?: string
}

/** Summary of a successfully preflighted Bundle — entry counts and resource types touched. */
interface BundlePreflightSummary {
   readCount: number
   writeCount: number
   resourceTypes: string[]
}

/** Result of bundle request validation — success with parsed Bundle or failure with error response. */
type BundleGuardResult =
   | { ok: true; bundle: Record<string, unknown>; type: BundleType; summary: BundlePreflightSummary; warning?: string }
   | { ok: false; response: { content: { type: "text"; text: string }[]; isError: true } }
