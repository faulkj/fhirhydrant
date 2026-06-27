/** Validated runtime configuration shape — see config.ts. */
interface Config {
   /** FHIR_BASE_URL — base server URL with any trailing slash stripped. Required. */
   fhirBaseUrl: string
   /** FHIR_VERSION — R4, R4B, or R5. Defaults to R4. Drives FHIRPath evaluation and compact model metadata. */
   fhirVersion: FhirVersion
   /** Derived FHIR REST root — FHIR_SERVER_URL when set, else `${fhirBaseUrl}/api/FHIR/${fhirVersion}`. */
   readonly fhirServerUrl: string
   /** Derived OAuth2 token endpoint — FHIR_TOKEN_URL when set, else `${fhirBaseUrl}/oauth2/token`. */
   readonly fhirTokenEndpoint: string
   /** FHIR_CLIENT_ID — SMART Backend Services client_id used in the JWT client assertion. Required. */
   fhirClientId: string
   /** FHIR_ACTIVE_KEY — current signing key (PKCS#8 PEM) with its thumbprint-derived kid. */
   fhirActiveKey: KeyPair
   /** FHIR_RETIRED_KEYS — additional keys still published in the JWKS for rotation; empty when unset. */
   fhirRetiredKeys: KeyPair[]
   /** FHIR_JWKS_URL — registered JWKS URL emitted as `jku` in the JWT header; undefined when self-hosting the JWKS. */
   fhirJwksUrl: string | undefined
   /** PORT — HTTP listen port. Defaults to 5000. */
   port: number
   /** BIND_HOST — bind address. Defaults to 127.0.0.1 in --dev, otherwise 0.0.0.0. */
   bindHost: string
   /** ALLOWED_HOSTS — Host header allow-list for the HTTP transport; undefined disables the check. */
   allowedHosts: string[] | undefined
   /** MCP_TRANSPORT — http or stdio. Defaults to http. */
   transport: "http" | "stdio"
   /** Numeric log level: error=0, warn=1, info=2, debug=3. */
   logLevel: number
   /** FHIR_METADATA_MODE — strict (block), warn (advise), or off (skip) for /metadata capability checks. Defaults to strict. */
   metadataMode: "strict" | "warn" | "off"
   /** FHIR_DEFAULT_COUNT — _count injected into searches when allowed; 0 lets the server decide. */
   fhirDefaultCount: number
   /** FHIR_MAX_COUNT — cap applied to caller-supplied _count; 0 means no cap. */
   fhirMaxCount: number
   /** FHIR_MAX_RESPONSE_BYTES — byte ceiling for a tool response before chunking. Defaults to 262144. */
   fhirMaxResponseBytes: number
   /** FHIR_AUDIT_SINK — active audit sinks (console, file); empty disables auditing. */
   auditSinks: AuditSinkName[]
   /** FHIR_AUDIT_FILE — path for the file audit sink. Defaults to ./audit.jsonl. */
   auditFile: string
   /** FHIR_AUDIT_USER_HEADER — request header whose value is recorded as the audit user; undefined when unset. */
   auditUserHeader: string | undefined
   /** FHIR_REQUEST_TIMEOUT_MS — per-attempt timeout for outgoing FHIR requests. Defaults to 30000. */
   fhirRequestTimeoutMs: number
   /** FHIR_PAGINATION_PATHS — extra normalized path prefixes accepted on pagination links; empty when unset. */
   paginationPaths: string[]
   /** FHIR_RESPONSE_MODE — compact, full, or compact-locked; undefined means search defaults compact and direct reads default full. */
   responseMode: ConfigResponseMode
   /** FHIR_TERMINOLOGY_BASE_URL — terminology server root; presence enables the terminology tools. */
   fhirTerminologyBaseUrl?: string
   /** FHIR_TERMINOLOGY_TIMEOUT_MS — per-request timeout for terminology calls. Defaults to 15000. */
   fhirTerminologyTimeoutMs: number
   /** FHIR_WRITE_CAPABILITIES — enabled write actions (create/update/patch/delete); empty means read-only. */
   writeCapabilities: Set<WriteAction>
   /** Write-payload validation level: off (none), local (client-side structural), server (local + server $validate preflight). */
   validateWrites: "off" | "local" | "server"
   /** FHIR_OPERATIONS — allowed operation catalog keys; undefined enables all, empty set disables all. */
   operations: Set<string> | undefined
   /** FHIR_PREFETCH_MAX_PAGES — max upstream pages fetched per coalesced compact search. Defaults to 5. */
   prefetchMaxPages: number
   /** FHIR_PREFETCH_MAX_ENTRIES — max entries accumulated during prefetch coalescing. Defaults to 5000. */
   prefetchMaxEntries: number
   /** FHIR_PREFETCH_MAX_BYTES — max raw bytes accumulated during prefetch coalescing. Defaults to 2097152. */
   prefetchMaxBytes: number
   /** FHIR_PREFETCH_TIMEOUT_MS — wall-clock budget for a coalesced prefetch loop. Defaults to 25000. */
   prefetchTimeoutMs: number
   /** FHIR_BUNDLE_CAPABILITIES — allowed Bundle types (batch/transaction); empty disables the bundle tool. */
   bundleCapabilities: Set<BundleType>
   /** FHIR_BUNDLE_WRITES_ENABLED — allow write entries inside Bundles (also gated by writeCapabilities). Defaults to false. */
   bundleWritesEnabled: boolean
}

/** The four FHIR write interactions that can be enabled via FHIR_WRITE_CAPABILITIES. */
type WriteAction = "create" | "update" | "patch" | "delete"

/** Allowed FHIR Bundle types for the bundle execution tool. */
type BundleType = "batch" | "transaction"

/** All possible action values a resource tool can execute. */
type ToolAction = "search" | "read" | "vread" | "history" | WriteAction

/** A private key and its derived kid. */
interface KeyPair {
   /** RFC 7638 JWK Thumbprint (first 12 base64url chars of SHA-256). */
   kid: string
   /** Raw RSA PKCS#8 PEM content. */
   privateKey: string
}

/** Per-call response shape: compact (token-efficient) or full (raw FHIR JSON). */
type ResponseMode = "compact" | "full"

/** Server-wide response mode from FHIR_RESPONSE_MODE env var. */
type ConfigResponseMode = ResponseMode | "compact-locked" | undefined

/** Supported FHIR version for FHIRPath evaluation and compact model metadata. */
type FhirVersion = "R4" | "R4B" | "R5"

/** Allowed log level strings for the LOG_LEVEL env var. */
type LogLevel = "error" | "warn" | "info" | "debug"

