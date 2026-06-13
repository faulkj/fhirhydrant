/** Request-scoped audit context — carried via AsyncLocalStorage, merged into events automatically. */
interface AuditContext { user?: string }

/** Allowed audit sink names. */
type AuditSinkName = "console" | "file"

/** A sink function that receives a structured audit event. */
type AuditSinkFn = (event: AuditEvent) => void

/** Structured, PHI-free audit event emitted for every FHIR MCP operation. */
interface AuditEvent {
   ts: string
   tool: string
   resourceType?: string
   operation: "search" | "read" | "paginate" | "capabilities"
   status: "ok" | "truncated" | "error" | "blocked"
   durationMs: number
   jsonBytes?: number
   bundleEntries?: number
   bundleTotal?: number
   hasNext?: boolean
   countInjected?: boolean
   countCapped?: boolean
   countSkipped?: boolean
   autoRetryCount?: number
   capWarning?: boolean
   metadataBlocked?: boolean
   validationBlocked?: boolean
   httpStatus?: number
   user?: string
}
