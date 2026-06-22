/** The four FHIR write interactions that can be enabled via FHIR_WRITE_CAPABILITIES. */
type WriteAction = "create" | "update" | "patch" | "delete"

/** All possible action values a resource tool can execute. */
type ToolAction = "search" | "read" | WriteAction

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

/** Validated runtime configuration shape — see config.ts. */
interface Config {
   fhirBaseUrl: string
   fhirVersion: FhirVersion
   readonly fhirServerUrl: string
   readonly fhirTokenEndpoint: string
   fhirClientId: string
   fhirActiveKey: KeyPair
   fhirRetiredKeys: KeyPair[]
   fhirJwksUrl: string | undefined
   port: number
   bindHost: string
   allowedHosts: string[] | undefined
   transport: "http" | "stdio"
   debug: boolean
   metadataMode: "strict" | "warn" | "off"
   fhirDefaultCount: number
   fhirMaxCount: number
   fhirMaxResponseBytes: number
   auditSinks: AuditSinkName[]
   auditFile: string
   auditUserHeader: string | undefined
   fhirRequestTimeoutMs: number
   paginationPaths: string[]
   responseMode: ConfigResponseMode
   fhirTerminologyBaseUrl?: string
   writeCapabilities: Set<WriteAction>
   operations: Set<string> | undefined
}
