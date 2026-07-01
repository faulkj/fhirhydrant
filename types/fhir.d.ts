/** Raw shape of a single resource file in config/resources/. */
interface ResourceDefinitionRaw {
   resource: string
   toolName: string
   description: string
   supportsDirectRead: boolean
   searchParams?: Record<string, string>
   requireOneOf?: string[][]
   trustConfig?: boolean
}

/** Describes a FHIR resource type and how it maps to an MCP tool. */
interface ResourceDefinition {
   resource: string
   toolName: string
   description: string
   supportsDirectRead: boolean
   requireOneOf?: string[][]
   searchParams: Record<string, string>
   searchSchema: import("zod").ZodObject<import("zod").ZodRawShape>
   /** When true, /metadata searchParam pruning is skipped for this resource — the config is trusted over an under-reporting CapabilityStatement (e.g. Epic hides enabled Medication/Organization search params). Interaction gates and SMART scopes still apply. */
   trustConfig?: boolean
}

/** Parsed definitions snapshot built from config/resources/ and config/search-controls.json. */
interface DefinitionsSnapshot {
   definitions: ResourceDefinition[]
   scopes: string[]
   searchControls: Record<string, string>
}

/** Return shape of validateResources. */
interface ValidationResult {
   entries: ResourceDefinitionRaw[]
   errors: string[]
}

/** Getter-backed token response compatible with fhirclient — access_token always reflects the latest issued token. */
type TokenResponse = {
   token_type: "bearer"
   readonly access_token: string | undefined
   readonly expires_in: number | undefined
   readonly scope?: string
}

/** Individual SMART v2 permission character. */
type ScopePermission = "c" | "r" | "u" | "d" | "s"

/** Shape of the object returned by calling the fhirclient smart() function — exposes the static client factory. */
type SmartNamespace = {
   client: (
      state: object,
   ) => InstanceType<typeof import("fhirclient/lib/Client.js").default>
}

/** fhirclient instance type. */
type FhirClient = ReturnType<typeof import("fhirclient").client>

/** Parsed capability metadata for a single FHIR resource type (internal fast-lookup shape). */
interface ResourceMeta {
   interactions: Set<string>
   searchParams: Set<string>
   includes: string[]
   revincludes: string[]
   operations: string[]
}

/** Single entry in the terminology search cache — holds filtered results and fetch state. */
interface TerminologySearchCacheEntry {
   items: string[]
   codes: Set<string>
   nextRawOffset: number
   exhausted: boolean
   createdAt: number
   accessedAt: number
}

/** Allowed operation invocation levels. */
type OperationLevel = "system" | "type" | "instance"
