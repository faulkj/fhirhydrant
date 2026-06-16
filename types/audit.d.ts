/** Request-scoped audit context — carried via AsyncLocalStorage, merged into events automatically. */
interface AuditContext {
   requestId?: string
   user?: string
}

/** Allowed audit sink names. */
type AuditSinkName = "console" | "file"

/** A sink function that receives a structured audit event. */
type AuditSinkFn = (event: AuditEvent) => void

/** Structured, PHI-free audit event emitted for every FHIR MCP operation. */
interface AuditEvent {
   ts: string
   tool: string
   resource?: string
   operation: "search" | "read" | "create" | "update" | "patch" | "delete" | "paginate" | "capabilities" | "lookup" | "expand"
   status: "ok" | "truncated" | "error" | "blocked"
   system?: string
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
   scopeBlocked?: boolean
   validationBlocked?: boolean
   fhirpathFiltered?: boolean
   fhirpathMatchCount?: number
   responseMode?: ResponseMode
   compacted?: boolean
   httpStatus?: number
   timedOut?: boolean
   requestId?: string
   user?: string
}
