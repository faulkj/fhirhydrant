#!/usr/bin/env node

import { readFileSync, watch } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server"
import { config } from "./config.ts"
import { startAuth, stopAuth, restartAuth } from "./fhir/auth.ts"
import { getDefinitionsPath, reloadDefinitions, getScopes } from "./fhir/definitions.ts"
import { registerAll, registerCoreTools } from "./fhir/registry.ts"

const
   { version: pkgVersion } = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
   ) as { version: string },
   SERVER_INFO = { name: "fhirhydrant", version: pkgVersion },
   SERVER_INSTRUCTIONS = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "instructions.md"),
      "utf8",
   ).trim(),

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

   startHttp = async (): Promise<() => Promise<void>> => {
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
         server = makeServer(),
         transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
         })

      await server.connect(transport)

      app.get("/health", (_req: Req, res: Res) => res.json({ status: "ok" }))

      app.all("/mcp", async (req: Req, res: Res) => {
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

      const httpServer = app.listen(config.port, config.bindHost, () =>
         console.log(`fhirhydrant listening on ${config.bindHost}:${config.port}`),
      )

      return () =>
         new Promise<void>((resolve) => {
            void transport.close()
            void server.close()
            httpServer.close(() => resolve())
            setTimeout(() => resolve(), 5000)
         })
   },
   
   startStdio = async (): Promise<() => Promise<void>> => {
      console.log = (...args: unknown[]) => console.error(...args)
      const
         server = makeServer(),
         transport = new StdioServerTransport()
      await server.connect(transport)
      console.log("fhirhydrant running in stdio mode")
      return async () => {
         await transport.close()
         await server.close()
      }
   }

await startAuth()

const close = config.transport === "stdio" ? await startStdio() : await startHttp()

process.env["NODE_ENV"] !== "production" && startDefinitionsWatcher()

let shutdownInProgress = false

const shutdown = async (code = 0): Promise<void> => {
   if (shutdownInProgress) return
   shutdownInProgress = true
   console.log("Shutting down...")
   stopAuth()
   await close()
   process.exit(code)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))
