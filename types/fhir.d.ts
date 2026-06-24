/** Raw shape of a single entry in config/resources.json. */
interface ResourceDefinitionRaw {
   resource: string
   toolName: string
   description: string
   supportsDirectRead: boolean
   searchParams?: Record<string, string>
   requireOneOf?: string[]
   requireCombination?: string[][]
}

/** Describes a FHIR resource type and how it maps to an MCP tool. */
interface ResourceDefinition {
   resource: string
   toolName: string
   description: string
   supportsDirectRead: boolean
   requireOneOf?: string[]
   requireCombination?: string[][]
   searchParams: Record<string, string>
   searchSchema: import("zod").ZodObject<import("zod").ZodRawShape>
}

/** Parsed definitions snapshot built from config/resources.json and config/search-controls.json. */
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

/** A single parameter definition in config/operations.json. */
interface OperationParamDef {
   type: "string" | "boolean" | "number"
   optional?: boolean
   description: string
   repeat?: boolean
   default?: string | number | boolean
}

/** Raw shape of a single entry in config/operations.json. */
interface OperationDefinitionRaw {
   key: string
   operation: string
   resource: string | null
   level: OperationLevel[]
   method: "GET" | "POST"
   description: string
   params: Record<string, OperationParamDef>
   requiresOneOf?: string[][]
   acceptsBody?: boolean
   bundleResponse: boolean
   auditOperation: string
   affectsState: boolean
   defaultResponseMode?: ResponseMode
   notes?: string
}

/** Describes a FHIR operation and its runtime schema — built from config/operations.json. */
interface OperationDefinition {
   key: string
   operation: string
   resource: string | null
   level: OperationLevel[]
   method: "GET" | "POST"
   description: string
   params: Record<string, OperationParamDef>
   requiresOneOf: string[][]
   acceptsBody: boolean
   bundleResponse: boolean
   auditOperation: string
   affectsState: boolean
   defaultResponseMode: ResponseMode | undefined
   notes: string | undefined
}

/** Trimmed, JSON-serializable summary of the FHIR server's CapabilityStatement. */
interface CapabilitySummary {
   serverUrl: string
   fetchedAt: string
   mode: Config["metadataMode"]
   resources: Array<{
      type: string
      interactions: string[]
      searchParams: string[]
      operations: string[]
      includes: string[]
      revincludes: string[]
      enabledOperations?: ToolAction[]
   }>
   grantedScope?: string
   skippedTools: Array<{
      toolName: string
      reason: string
      gate?: "metadata" | "scope"
   }>
}
