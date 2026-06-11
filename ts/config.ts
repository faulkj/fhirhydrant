import { basename } from "node:path"

const
   get = (key: string): string => {
      const val = process.env[key]
      if (!val) throw new Error(`Missing required env var: ${key}`)
      return val
   },
   opt = (key: string): string | undefined => process.env[key],
   parseTransport = (): "http" | "stdio" => {
      const val = (opt("MCP_TRANSPORT") ?? "http").toLowerCase()
      if (val !== "http" && val !== "stdio")
         throw new Error(
            `Invalid MCP_TRANSPORT="${val}" — must be "http" or "stdio"`,
         )
      return val as "http" | "stdio"
   },
   parsePort = (): number => {
      const
         raw = opt("PORT") ?? "5000",
         port = parseInt(raw, 10)
      if (!Number.isFinite(port) || port < 1 || port > 65535)
         throw new Error(`Invalid PORT="${raw}" — must be 1–65535`)
      return port
   },
   parseMetadataMode = (): Config["metadataMode"] => {
      const val = (opt("FHIR_METADATA_MODE") ?? "strict").toLowerCase()
      if (val !== "strict" && val !== "warn" && val !== "off")
         throw new Error(
            `Invalid FHIR_METADATA_MODE="${val}" — must be "strict", "warn", or "off"`,
         )
      return val as Config["metadataMode"]
   },
   parseAllowedHosts = (): string[] | undefined =>
      opt("ALLOWED_HOSTS")
         ?.split(",")
         .map((s) => s.trim())
         .filter(Boolean) || undefined,
   parseKeys = (): KeyPair[] => {
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
}

if (!config.fhirKeys.some((k) => k.kid === config.fhirActiveKey))
   throw new Error(
      `FHIR_ACTIVE_KEY="${config.fhirActiveKey}" does not match any derived kid — available: ${config.fhirKeys.map((k) => k.kid).join(", ")}`,
   )
