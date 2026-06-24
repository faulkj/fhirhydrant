import {
   get, opt, parseTransport, parsePort, parseMetadataMode,
   parseResponseMode, parseAllowedHosts, parsePaginationPaths,
   parsePositiveInt, parseNonNegativeInt, parseAuditSinks, parseKeys,
   parseWriteCapabilities, parseOperations, parseFhirVersion,
} from "./config-parsers.ts"

/** Validated runtime configuration loaded from environment variables. */
const { activeKey, retiredKeys } = parseKeys()

export const config: Config = {
   fhirBaseUrl: get("FHIR_BASE_URL").replace(/\/$/, ""),
   fhirVersion: parseFhirVersion(),
   get fhirServerUrl() {
      return opt("FHIR_SERVER_URL") ?? `${this.fhirBaseUrl}/api/FHIR/${this.fhirVersion}`
   },
   get fhirTokenEndpoint() {
      return opt("FHIR_TOKEN_URL") ?? `${this.fhirBaseUrl}/oauth2/token`
   },
   fhirClientId: get("FHIR_CLIENT_ID"),
   fhirActiveKey: activeKey,
   fhirRetiredKeys: retiredKeys,
   fhirJwksUrl: opt("FHIR_JWKS_URL"),
   port: parsePort(),
   bindHost: opt("BIND_HOST") ?? (process.argv.includes("--dev") ? "127.0.0.1" : "0.0.0.0"),
   allowedHosts: parseAllowedHosts(),
   transport: parseTransport(),
   debug: opt("DEBUG")?.toLowerCase() === "true",
   metadataMode: parseMetadataMode(),
   fhirDefaultCount: parseNonNegativeInt("FHIR_DEFAULT_COUNT", 0),
   fhirMaxCount: parseNonNegativeInt("FHIR_MAX_COUNT", 0),
   fhirMaxResponseBytes: parsePositiveInt("FHIR_MAX_RESPONSE_BYTES", 262144),
   auditSinks: parseAuditSinks(),
   auditFile: opt("FHIR_AUDIT_FILE") ?? "./audit.jsonl",
   auditUserHeader: opt("FHIR_AUDIT_USER_HEADER")?.trim() || undefined,
   fhirRequestTimeoutMs: parsePositiveInt("FHIR_REQUEST_TIMEOUT_MS", 30000),
   paginationPaths: parsePaginationPaths(),
   responseMode: parseResponseMode(),
   fhirTerminologyBaseUrl: (opt("FHIR_TERMINOLOGY_BASE_URL")?.replace(/\/+$/, "") || undefined),
   fhirTerminologyTimeoutMs: parsePositiveInt("FHIR_TERMINOLOGY_TIMEOUT_MS", 15000),
   writeCapabilities: parseWriteCapabilities(),
   operations: parseOperations(),
   prefetchMaxPages: parsePositiveInt("FHIR_PREFETCH_MAX_PAGES", 5),
   prefetchMaxEntries: parsePositiveInt("FHIR_PREFETCH_MAX_ENTRIES", 5000),
   prefetchMaxBytes: parsePositiveInt("FHIR_PREFETCH_MAX_BYTES", 2097152),
   prefetchTimeoutMs: parsePositiveInt("FHIR_PREFETCH_TIMEOUT_MS", 25000),
}

config.debug && console.log(`🔑 Active kid: ${config.fhirActiveKey.kid}`)
if (retiredKeys.length)
   console.log(`🔑 JWKS: ${1 + retiredKeys.length} keys`)

if (config.fhirDefaultCount > 0 && config.fhirMaxCount > 0 && config.fhirDefaultCount > config.fhirMaxCount)
   throw new Error(
      `FHIR_DEFAULT_COUNT (${config.fhirDefaultCount}) must not exceed FHIR_MAX_COUNT (${config.fhirMaxCount})`,
   )
