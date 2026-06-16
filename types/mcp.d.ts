/** A single parameter definition in config/core-tools.json. */
interface CoreToolParam {
   type: "string" | "boolean"
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

/** Result of resource request validation — either success (directId + op) or an early-exit MCP error response. */
type GuardResult =
   | { ok: true; directId: string | undefined; op: AuditEvent["operation"] }
   | { ok: false; response: { content: { type: "text"; text: string }[]; isError: true } }
