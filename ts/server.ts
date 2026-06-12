#!/usr/bin/env node

import { readFileSync, watch } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server"
import { config } from "./config.ts"
import { initAuditSinks } from "./audit.ts"
import { startAuth, stopAuth, restartAuth } from "./fhir/auth.ts"
import { getDefinitionsPath, reloadDefinitions, getScopes } from "./fhir/definitions.ts"
import { jwksHandler } from "./fhir/jwks.ts"
import { fetchMetadata } from "./fhir/metadata.ts"
import { registerAll } from "./mcp/resources.ts"
import { registerCoreTools } from "./mcp/core-tools.ts"

const
   { version: pkgVersion } = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
   ) as { version: string },
   SERVER_INFO = { name: "fhirhydrant", version: pkgVersion },
   SERVER_INSTRUCTIONS = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "instructions.md"),
      "utf8",
   ).trim(),

   _ = initAuditSinks(config.auditSinks, config.auditFile),
   makeServer = (): McpServer => {
      const s = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS })
      registerAll(s)
      registerCoreTools(s)
      return s
   }

let restartingAuth = false

const
   startDefinitionsWatcher = (): void => {
      const
         defPath = getDefinitionsPath(),
         watchDir = dirname(defPath),
         watchFile = basename(defPath)

      let debounce: ReturnType<typeof setTimeout> | undefined
      watch(watchDir, (_eventType, filename) => {
         if (filename !== watchFile) return
         clearTimeout(debounce)
         debounce = setTimeout(async () => {
            const
               prevScopes = getScopes().join(","),
               ok = reloadDefinitions()
            if (!ok) return
            console.log(`[definitions] Reloaded from ${watchFile}`)
            console.log("[definitions] Metadata cache may be stale — restart to re-validate against /metadata")
            if (getScopes().join(",") !== prevScopes) {
               if (restartingAuth)
                  return void console.log(
                     "[definitions] Auth restart already in progress — skipping",
                  )
               restartingAuth = true
               try {
                  console.log(
                     "[definitions] Scopes changed — restarting auth...",
                  )
                  await restartAuth()
                  console.log("[definitions] Auth restarted with new scopes")
               } catch (err) {
                  console.error(
                     "[definitions] Auth restart failed:",
                     err instanceof Error ? err.message : err,
                  )
               } finally {
                  restartingAuth = false
               }
            }
         }, 300)
      })
      console.log(`[definitions] Watching ${watchFile} for changes`)
   },

   startHttp = async (): Promise<{
      attach: (s: McpServer) => Promise<void>
      close: () => Promise<void>
   }> => {
      const
         { createMcpExpressApp } =
            await import("@modelcontextprotocol/express"),
         { NodeStreamableHTTPServerTransport } =
            await import("@modelcontextprotocol/node"),
         app = createMcpExpressApp(
            config.allowedHosts ?
               { allowedHosts: config.allowedHosts }
            :  undefined,
         ),
         transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
         })

      let mcpReady = false

      app.get("/health", (_req: Req, res: Res) => res.json({ status: "ok" }))

      if (!config.fhirJwksUrl) {
         app.get("/jwks", jwksHandler)
         console.log("[jwks] Serving JWKS at /jwks")
      } else
         console.log("[jwks] External JWKS URL configured — /jwks disabled")

      app.all("/mcp", async (req: Req, res: Res) => {
         if (!mcpReady)
            return void res.status(503).json({ status: "starting" })
         const
            body = req.body as Record<string, unknown> | undefined,
            method = body?.method ?? req.method
         method && console.log(`[mcp] ${method}`)
         await transport.handleRequest(req, res, req.body)
      })

      app.use((err: Error, _req: Req, res: Res, _next: Next) => {
         console.error("[http] Request error:", err.message)
         res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32700, message: "Parse error" },
            id: null,
         })
      })

      const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
         const s = app.listen(config.port, config.bindHost, () => {
            console.log(`fhirhydrant listening on ${config.bindHost}:${config.port}`)
            resolve(s)
         })
      })

      return {
         attach: async (s: McpServer) => {
            await s.connect(transport)
            mcpReady = true
         },
         close: () =>
            new Promise<void>((resolve) => {
               void transport.close()
               httpServer.close(() => resolve())
               setTimeout(() => resolve(), 5000)
            }),
      }
   },

   startStdio = async (): Promise<{
      attach: (s: McpServer) => Promise<void>
      close: () => Promise<void>
   }> => {
      console.log = (...args: unknown[]) => console.error(...args)
      const transport = new StdioServerTransport()
      return {
         attach: async (s: McpServer) => {
            await s.connect(transport)
            console.log("fhirhydrant running in stdio mode")
         },
         close: async () => {
            await transport.close()
         },
      }
   }

const selfHostJwks = config.transport === "http" && !config.fhirJwksUrl

if (!selfHostJwks) await startAuth()

const { attach, close } = config.transport === "stdio" ? await startStdio() : await startHttp()

if (selfHostJwks) await startAuth()

if (config.metadataMode !== "off") await fetchMetadata()

const server = makeServer()
await attach(server)

process.env["NODE_ENV"] !== "production" && startDefinitionsWatcher()

let shutdownInProgress = false

const shutdown = async (code = 0): Promise<void> => {
   if (shutdownInProgress) return
   shutdownInProgress = true
   console.log("Shutting down...")
   stopAuth()
   await server.close()
   await close()
   process.exit(code)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))
