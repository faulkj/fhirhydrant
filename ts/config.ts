import {
   get, opt, parseTransport, parsePort, parseMetadataMode,
   parseResponseMode, parseAllowedHosts, parsePaginationPaths,
   parsePositiveInt, parseAuditSinks, parseKeys, parseWriteCapabilities,
   parseOperations, parseFhirVersion,
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
   bindHost: opt("BIND_HOST") ?? (process.env["NODE_ENV"] === "development" ? "127.0.0.1" : "0.0.0.0"),
   allowedHosts: parseAllowedHosts(),
   transport: parseTransport(),
   debug: opt("DEBUG")?.toLowerCase() === "true",
   metadataMode: parseMetadataMode(),
   fhirDefaultCount: parsePositiveInt("FHIR_DEFAULT_COUNT", 20),
   fhirMaxCount: parsePositiveInt("FHIR_MAX_COUNT", 100),
   fhirMaxResponseBytes: parsePositiveInt("FHIR_MAX_RESPONSE_BYTES", 65536),
   auditSinks: parseAuditSinks(),
   auditFile: opt("FHIR_AUDIT_FILE") ?? "./audit.jsonl",
   auditUserHeader: opt("FHIR_AUDIT_USER_HEADER")?.trim() || undefined,
   fhirRequestTimeoutMs: parsePositiveInt("FHIR_REQUEST_TIMEOUT_MS", 30000),
   paginationPaths: parsePaginationPaths(),
   responseMode: parseResponseMode(),
   fhirTerminologyBaseUrl: (opt("FHIR_TERMINOLOGY_BASE_URL")?.replace(/\/+$/, "") || undefined),
   writeCapabilities: parseWriteCapabilities(),
   operations: parseOperations(),
}

console.log(`🔑 Active kid: ${config.fhirActiveKey.kid}`)
if (retiredKeys.length)
   console.log(`🔑 JWKS: ${1 + retiredKeys.length} keys`)

if (config.debug && process.env["NODE_ENV"]?.trim().toLowerCase() === "production")
   throw new Error(
      "DEBUG=true is not allowed when NODE_ENV=production — FHIR request URLs may contain PHI",
   )

if (config.fhirDefaultCount > config.fhirMaxCount)
   throw new Error(
      `FHIR_DEFAULT_COUNT (${config.fhirDefaultCount}) must not exceed FHIR_MAX_COUNT (${config.fhirMaxCount})`,
   )
