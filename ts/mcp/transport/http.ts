import { randomUUID } from "node:crypto"
import { config } from "../../config.ts"
import { withAuditContext } from "../../audit.ts"
import { jwksHandler } from "../../fhir/auth/jwks.ts"

/** Starts the Streamable HTTP MCP transport and returns a handle to attach a server and shut down the listener. */
export const startHttp = async (): Promise<TransportHandle> => {
   const
      { createMcpExpressApp } =
         await import("@modelcontextprotocol/express"),
      { NodeStreamableHTTPServerTransport } =
         await import("@modelcontextprotocol/node"),
      app = createMcpExpressApp(
         config.allowedHosts
            ? { allowedHosts: config.allowedHosts }
            : undefined,
      ),
      transport = new NodeStreamableHTTPServerTransport({
         sessionIdGenerator: undefined,
      })

   let mcpReady = false
   let connectedServer: import("@modelcontextprotocol/server").McpServer | undefined

   app.get("/health", (_req: Req, res: Res) => res.json({ status: "ok" }))

   if (!config.fhirJwksUrl) {
      app.get("/jwks", jwksHandler)
      console.info(`\x1b[35m🔑 Serving JWKS at http://${config.bindHost === "0.0.0.0" ? "localhost" : config.bindHost}:${config.port}/jwks\x1b[0m`)
   } else
      console.info("🔑 External JWKS URL configured — /jwks disabled")

   // GET opens a server→client notification stream — not supported in stateless mode
   app.get("/mcp", (_req: Req, res: Res) => res.status(405).json({ error: "Server-initiated streams not supported in stateless mode" }))

   app.post("/mcp", async (req: Req, res: Res) => {
      if (!mcpReady)
         return void res.status(503).json({ status: "starting" })
      const
         body = req.body as Record<string, unknown> | undefined,
         method = body?.method as string | undefined
      method && method !== "tools/call" && console.log(`🔌 ${method}`)
      const
         requestId = randomUUID(),
         user = config.auditUserHeader ? req.get(config.auditUserHeader)?.trim() || undefined : undefined
      await withAuditContext({ requestId, ...(user ? { user } : {}) }, () => transport.handleRequest(req, res, req.body))
   })

   app.use((err: Error, _req: Req, res: Res, _next: Next) => {
      console.error("🌐 Request error: ", err.message)
      res.status(400).json({
         jsonrpc: "2.0",
         error: { code: -32700, message: "Parse error" },
         id: null,
      })
   })

   const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const s = app.listen(config.port, config.bindHost, () => {
         const displayHost = config.bindHost === "0.0.0.0" || config.bindHost === "127.0.0.1"
            ? "localhost"
            : config.bindHost
         console.info(`\x1b[34m🔥 fhirhydrant listening on http://${displayHost}:${config.port}/mcp\x1b[0m`)
         resolve(s)
      })
   })

   return {
      attach: async (factory) => {
         connectedServer = factory()
         await connectedServer.connect(transport)
         mcpReady = true
      },
      close: () =>
         new Promise<void>((resolve) => {
            void transport.close()
            void connectedServer?.close()
            httpServer.close(() => resolve())
            setTimeout(() => resolve(), 5000)
         }),
   }
}
