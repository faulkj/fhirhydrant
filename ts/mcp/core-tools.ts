import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "../config.ts"
import { log } from "../log.ts"
import { getSystemInteractions } from "../fhir/model/metadata.ts"
import { getTokenResponse } from "../fhir/auth/auth.ts"
import { parseGrantedScopes } from "../fhir/auth/scopes.ts"
import { addPaginate } from "./tools/paginate.ts"
import { addCapabilities } from "./tools/capabilities.ts"
import { addTerminologyLookup } from "./tools/terminology-lookup.ts"
import { addCodeSearch } from "./tools/code-search.ts"
import { addSystemHistory } from "./tools/history.ts"

/** Loads all core tool definitions from config/core-tools.json. */
export const loadCoreTools = (): CoreToolDef[] =>
   JSON.parse(readFileSync(coreToolsPath(), "utf8")) as CoreToolDef[]

/** Builds a Zod input schema from a core tool param definition map. */
export const buildSchema = (params: Record<string, { type: string; optional?: boolean; description: string }>) => {
   const shape: Record<string, z.ZodTypeAny> = {}
   for (const [key, p] of Object.entries(params)) {
      const base = p.type === "boolean" ? z.boolean() : p.type === "number" ? z.number() : z.string()
      shape[key] = p.optional ? base.optional().describe(p.description) : base.describe(p.description)
   }
   return z.object(shape)
}

/** Registers built-in infrastructure tools (e.g. pagination, capabilities) on the server. */
export const registerCoreTools = (server: McpServer): void => {
   const
      tools = loadCoreTools(),
      def = (name: string) => tools.find((t) => t.name === name)!,
      paginateParams = config.responseMode === "compact-locked"
         ? Object.fromEntries(Object.entries(def("paginate").params).filter(([k]) => k !== "responseMode"))
         : def("paginate").params

   addPaginate(server, def("paginate").description, buildSchema(paginateParams))
   addCapabilities(server, def("capabilities").description, buildSchema(def("capabilities").params))

   if (config.fhirTerminologyBaseUrl) {
      addTerminologyLookup(server, def("terminology_lookup").description, buildSchema(def("terminology_lookup").params))
      addCodeSearch(server, def("code_search").description, buildSchema(def("code_search").params))
      log.debug(`📋 Terminology tools enabled (→ ${config.fhirTerminologyBaseUrl})`)
   } else
      log.debug("📋 Terminology tools disabled — FHIR_TERMINOLOGY_BASE_URL not set")

   // System history: only when advertised (or metadata off) and scopes allow it
   const
      sysInteractions = getSystemInteractions(),
      scopeMap = parseGrantedScopes(getTokenResponse().scope),
      historyAllowed = (config.metadataMode === "off" || sysInteractions.has("history-system"))
         && (scopeMap.size === 0 || scopeMap.get("*")?.has("r"))
   if (historyAllowed) {
      const historyParams = config.responseMode === "compact-locked"
         ? Object.fromEntries(Object.entries(def("system_history").params).filter(([k]) => k !== "responseMode"))
         : def("system_history").params
      addSystemHistory(server, def("system_history").description, buildSchema(historyParams))
      log.debug("📋 System history tool enabled")
   } else
      log.debug("📋 System history tool disabled — requires system history-system interaction and wildcard read scope (system/*.r)")
}

const
   coreToolsPath = (): string => {
      const
         bundled = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "core-tools.json"),
         source = join(dirname(fileURLToPath(import.meta.url)), "../..", "config", "core-tools.json")
      return existsSync(bundled) ? bundled : source
   }
