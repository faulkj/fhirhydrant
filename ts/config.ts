import {
   get, opt, parseTransport, parsePort, parseMetadataMode,
   parseResponseMode, parseAllowedHosts, parsePaginationPaths,
   parsePositiveInt, parseAuditSinks, parseKeys,
} from "./config-parsers.ts"

/** Validated runtime configuration loaded from environment variables. */
export const config: Config = {
   fhirBaseUrl: get("FHIR_BASE_URL").replace(/\/$/, ""),
   get fhirServerUrl() {
      return opt("FHIR_SERVER_URL") ?? `${this.fhirBaseUrl}/api/FHIR/R4`
   },
   get fhirTokenEndpoint() {
      return opt("FHIR_TOKEN_URL") ?? `${this.fhirBaseUrl}/oauth2/token`
   },
   fhirClientId: get("FHIR_CLIENT_ID"),
   fhirKeys: parseKeys(),
   fhirActiveKey: get("FHIR_ACTIVE_KEY"),
   fhirJwksUrl: opt("FHIR_JWKS_URL"),
   port: parsePort(),
   bindHost: opt("BIND_HOST") ?? "127.0.0.1",
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
   paginationPaths: parsePaginationPaths(),
   responseMode: parseResponseMode(),
}

if (!config.fhirKeys.some((k) => k.kid === config.fhirActiveKey))
   throw new Error(
      `FHIR_ACTIVE_KEY="${config.fhirActiveKey}" does not match any derived kid — available: ${config.fhirKeys.map((k) => k.kid).join(", ")}`,
   )

if (config.fhirDefaultCount > config.fhirMaxCount)
   throw new Error(
      `FHIR_DEFAULT_COUNT (${config.fhirDefaultCount}) must not exceed FHIR_MAX_COUNT (${config.fhirMaxCount})`,
   )
