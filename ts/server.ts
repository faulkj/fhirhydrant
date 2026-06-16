#!/usr/bin/env node

// Patch console methods to prepend ISO timestamps
for (const level of ["log", "info", "warn", "error"] as const) {
   const original = console[level].bind(console)
   console[level] = (...args: unknown[]) => original(new Date().toISOString().replace("T", " ").slice(0, 19), ...args)
}

// stdio: redirect stdout logging to stderr before anything else runs
if ((process.env["MCP_TRANSPORT"] ?? "http").toLowerCase() === "stdio") {
   console.log = (...args: unknown[]) => console.error(...args)
   console.info = (...args: unknown[]) => console.error(...args)
}

import { readFileSync, watch } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/server"
import { config } from "./config.ts"
import { initAuditSinks } from "./audit.ts"
import { startAuth, stopAuth, restartAuth } from "./fhir/auth/auth.ts"
import { getConfigDir, reloadDefinitions, getRequestedScopes } from "./fhir/model/definitions.ts"
import { fetchMetadata } from "./fhir/model/metadata.ts"
import { registerAll } from "./mcp/resources.ts"
import { registerCoreTools } from "./mcp/core-tools.ts"
import { startHttp } from "./mcp/transport/http.ts"
import { startStdio } from "./mcp/transport/stdio.ts"

const
   { version: pkgVersion } = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
   ) as { version: string },
   SERVER_INFO = { name: "fhirhydrant", version: pkgVersion },
   SERVER_INSTRUCTIONS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "config", "instructions.md"), "utf8").trim(),

   _ = (
      initAuditSinks(config.auditSinks, config.auditFile),
      config.auditUserHeader && console.info(`📋 User header: ${config.auditUserHeader}`),
      config.writeCapabilities.size > 0 && console.warn(`\x1b[31m⚠️  Write capabilities enabled: ${[...config.writeCapabilities].join(", ")}\x1b[0m`)
   ),
   makeServer = (): McpServer => {
      const s = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS })
      registerAll(s)
      registerCoreTools(s)
      return s
   }

let restartingAuth = false

const
   watchFiles = new Set(["resources.json", "search-controls.json"]),
   startDefinitionsWatcher = (): void => {
      const watchDir = getConfigDir()

      let debounce: ReturnType<typeof setTimeout> | undefined
      watch(watchDir, (_eventType, filename) => {
         if (!filename || !watchFiles.has(filename)) return
         clearTimeout(debounce)
         debounce = setTimeout(async () => {
            const
               prevScopes = getRequestedScopes().join(","),
               ok = reloadDefinitions()
            if (!ok) return
            console.log(`📋 Reloaded from ${filename}`)
            console.log("📋 Metadata cache may be stale — restart to re-validate against /metadata")
            if (getRequestedScopes().join(",") !== prevScopes) {
               if (restartingAuth)
                  return void console.log(
                     "📋 Auth restart already in progress — skipping",
                  )
               restartingAuth = true
               try {
                  console.log(
                     "📋 Scopes changed — restarting auth...",
                  )
                  await restartAuth()
                  console.info("📋 Auth restarted with new scopes")
               } catch (err) {
                  console.error(
                     "📋 Auth restart failed:",
                     err instanceof Error ? err.message : err,
                  )
               } finally {
                  restartingAuth = false
               }
            }
         }, 300)
      })
      console.info(`👀 Watching config/ for changes`)
   }

const selfHostJwks = config.transport !== "stdio" && !config.fhirJwksUrl

if (!selfHostJwks) await startAuth()

const { attach, close } =
   config.transport === "stdio"
      ? await startStdio()
      : await startHttp()

if (selfHostJwks) await startAuth()

if (config.metadataMode !== "off") await fetchMetadata()

await attach(makeServer)

process.env["NODE_ENV"] !== "production" && startDefinitionsWatcher()

let shutdownInProgress = false

const shutdown = async (code = 0): Promise<void> => {
   if (shutdownInProgress) return
   shutdownInProgress = true
   console.info("🛑 Shutting down...")
   stopAuth()
   await close()
   process.exit(code)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))
