import { basename } from "node:path"

/** Reads a required env var; throws if absent or empty. */
export const get = (key: string): string => {
   const val = process.env[key]
   if (!val) throw new Error(`Missing required env var: ${key}`)
   return val
}

/** Reads an optional env var; returns undefined if absent. */
export const opt = (key: string): string | undefined => process.env[key]

/** Parses MCP_TRANSPORT; defaults to "http". */
export const parseTransport = (): "http" | "stdio" => {
   const val = (opt("MCP_TRANSPORT") ?? "http").toLowerCase()
   if (val !== "http" && val !== "stdio")
      throw new Error(`Invalid MCP_TRANSPORT="${val}" — must be "http" or "stdio"`)
   return val as "http" | "stdio"
}

/** Parses PORT; defaults to 5000. */
export const parsePort = (): number => {
   const
      raw = opt("PORT") ?? "5000",
      port = /^\d+$/.test(raw) ? Number(raw) : NaN
   if (!Number.isFinite(port) || port < 1 || port > 65535)
      throw new Error(`Invalid PORT="${raw}" — must be 1–65535`)
   return port
}

/** Parses FHIR_METADATA_MODE; defaults to "strict". */
export const parseMetadataMode = (): Config["metadataMode"] => {
   const val = (opt("FHIR_METADATA_MODE") ?? "strict").toLowerCase()
   if (val !== "strict" && val !== "warn" && val !== "off")
      throw new Error(
         `Invalid FHIR_METADATA_MODE="${val}" — must be "strict", "warn", or "off"`,
      )
   return val as Config["metadataMode"]
}

/** Parses FHIR_RESPONSE_MODE; returns undefined if unset. */
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

/** Parses a positive-integer env var; falls back to the given default if unset. */
export const parsePositiveInt = (key: string, fallback: number): number => {
   const
      raw = opt(key),
      val = raw ? (/^\d+$/.test(raw) ? Number(raw) : NaN) : fallback
   if (!Number.isFinite(val) || val < 1)
      throw new Error(`Invalid ${key}="${raw}" — must be a positive integer`)
   return val
}

/** Parses FHIR_AUDIT_SINK into a list of valid sink names; warns about and skips unknowns. */
export const parseAuditSinks = (): AuditSinkName[] => {
   const
      raw = opt("FHIR_AUDIT_SINK"),
      valid = new Set<AuditSinkName>(["console", "file"]),
      names = raw?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [],
      good = names.filter((n): n is AuditSinkName => valid.has(n as AuditSinkName)),
      bad = names.filter((n) => !valid.has(n as AuditSinkName))
   bad.length && console.warn(`📋 Ignoring unknown audit sinks: ${bad.join(", ")}`)
   return good
}

/** Parses FHIR_PRIVATE_KEY into key pairs, with kid derived from each PEM filename. */
export const parseKeys = (): KeyPair[] => {
   const
      raw = get("FHIR_PRIVATE_KEY"),
      paths = raw.split(",").map((s) => s.trim()).filter(Boolean)
   if (!paths.length)
      throw new Error("FHIR_PRIVATE_KEY must contain at least one PEM file path")
   const
      keys = paths.map((p) => {
         const
            name = basename(p),
            match = /^private-(.+)\.pem$/i.exec(name)
         if (!match)
            throw new Error(
               `Invalid PEM filename "${name}" — must match private-<kid>.pem (e.g. private-20260610.pem)`,
            )
         return { kid: match[1], privateKey: p }
      }),
      kids = new Set<string>()
   for (const { kid } of keys) {
      if (kids.has(kid))
         throw new Error(`Duplicate kid "${kid}" — each PEM file must derive a unique kid`)
      kids.add(kid)
   }
   return keys
}

