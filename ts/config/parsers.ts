const VALID_FHIR_VERSIONS = new Set<FhirVersion>(["R4", "R4B", "R5"])

/** Parses FHIR_VERSION into a validated FhirVersion, defaults to R4 when unset. */
export const parseFhirVersion = (): FhirVersion => {
   const raw = opt("FHIR_VERSION")?.trim().toUpperCase() || "R4"
   if (!VALID_FHIR_VERSIONS.has(raw as FhirVersion))
      throw new Error(`Invalid FHIR_VERSION="${raw}" — must be "R4", "R4B", or "R5"`)
   return raw as FhirVersion
}

/** Parses FHIR_OPERATIONS into a Set of allowed operation keys, undefined means all enabled. */
export const parseOperations = (): Set<string> | undefined => {
   const raw = opt("FHIR_OPERATIONS")
   if (!raw) return undefined
   if (raw.trim().toLowerCase() === "none") return new Set()
   const
      keys = raw.split(",").map((s) => s.trim().toLowerCase().replace(/^\$/, "")).filter(Boolean)
   return keys.length ? new Set(keys) : undefined
}

/** Parses FHIR_WRITE_CAPABILITIES into a validated Set of write actions, empty when unset. */
export const parseWriteCapabilities = (): Set<WriteAction> => {
   const
      valid = new Set<WriteAction>(["create", "update", "patch", "delete"]),
      raw = opt("FHIR_WRITE_CAPABILITIES")
   if (!raw) return new Set()
   const actions = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
   for (const a of actions)
      if (!valid.has(a as WriteAction))
         throw new Error(`Invalid FHIR_WRITE_CAPABILITIES value "${a}" — allowed: ${[...valid].join(", ")}`)
   return new Set(actions as WriteAction[])
}

/** Reads a required env var, throws if absent or empty. */
export const get = (key: string): string => {
   const val = process.env[key]
   if (!val) throw new Error(`Missing required env var: ${key}`)
   return val
}

/** Reads an optional env var, returns undefined if absent. */
export const opt = (key: string): string | undefined => process.env[key]

/** Parses MCP_TRANSPORT, defaults to "http". */
export const parseTransport = (): "http" | "stdio" => {
   const val = (opt("MCP_TRANSPORT") ?? "http").toLowerCase()
   if (val !== "http" && val !== "stdio")
      throw new Error(`Invalid MCP_TRANSPORT="${val}" — must be "http" or "stdio"`)
   return val as "http" | "stdio"
}

/** Parses PORT, defaults to 5000. */
export const parsePort = (): number => {
   const
      raw = opt("PORT") ?? "5000",
      port = /^\d+$/.test(raw) ? Number(raw) : NaN
   if (!Number.isFinite(port) || port < 1 || port > 65535)
      throw new Error(`Invalid PORT="${raw}" — must be 1–65535`)
   return port
}

/** Parses FHIR_METADATA_MODE, defaults to "strict". */
export const parseMetadataMode = (): Config["metadataMode"] => {
   const val = (opt("FHIR_METADATA_MODE") ?? "strict").toLowerCase()
   if (val !== "strict" && val !== "warn" && val !== "off")
      throw new Error(
         `Invalid FHIR_METADATA_MODE="${val}" — must be "strict", "warn", or "off"`,
      )
   return val as Config["metadataMode"]
}

/** Parses FHIR_VALIDATE_WRITES, defaults to "local". */
export const parseValidateWrites = (): Config["validateWrites"] => {
   const val = (opt("FHIR_VALIDATE_WRITES") ?? "local").toLowerCase()
   if (val !== "off" && val !== "local" && val !== "server")
      throw new Error(`Invalid FHIR_VALIDATE_WRITES="${val}" — must be "off", "local", or "server"`)
   return val as Config["validateWrites"]
}

/** Parses FHIR_RESPONSE_MODE, returns undefined if unset. */
export const parseResponseMode = (): ConfigResponseMode => {
   const val = opt("FHIR_RESPONSE_MODE")?.toLowerCase()
   if (val === undefined) return undefined
   if (val !== "compact" && val !== "full" && val !== "compact-locked")
      throw new Error(
         `Invalid FHIR_RESPONSE_MODE="${val}" — must be "compact", "full", or "compact-locked"`,
      )
   return val as ConfigResponseMode
}

/** Parses ALLOWED_HOSTS into a trimmed string array, or undefined if unset. */
export const parseAllowedHosts = (): string[] | undefined =>
   opt("ALLOWED_HOSTS")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) || undefined

/** Parses FHIR_PAGINATION_PATHS into normalized path prefixes. */
export const parsePaginationPaths = (): string[] =>
   opt("FHIR_PAGINATION_PATHS")
      ?.split(",")
      .map((s) => s.trim().replace(/^\/?/, "/").replace(/\/*$/, "/"))
      .filter((p) => p.length > 1) ?? []
