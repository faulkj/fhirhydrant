/** A private key and its derived kid (from PEM filename). */
interface KeyPair {
   /** Key identifier derived from the PEM filename: private-<kid>.pem → kid. */
   kid: string
   /** PEM file path as provided in FHIR_PRIVATE_KEY. */
   privateKey: string
}

/** Validated runtime configuration shape — see config.ts. */
interface Config {
   fhirBaseUrl: string
   readonly fhirServerUrl: string
   readonly fhirTokenEndpoint: string
   fhirClientId: string
   fhirKeys: KeyPair[]
   fhirActiveKey: string
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
   paginationPaths: string[]
}
