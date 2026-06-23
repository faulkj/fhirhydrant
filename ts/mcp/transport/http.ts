import { randomUUID } from "node:crypto"
import { config } from "../../config.ts"
import { withAuditContext } from "../../audit.ts"
import { jwksHandler } from "../../fhir/auth/jwks.ts"
import { getTokenResponse } from "../../fhir/auth/auth.ts"
import { isMetadataAvailable } from "../../fhir/model/metadata.ts"
import { getRegisteredToolCount } from "../resources.ts"

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

   app.get("/health", (_req: Req, res: Res) => {
      const token = getTokenResponse()
      res.json({
         status: "ok",
         mcp: mcpReady,
         metadata: isMetadataAvailable(),
         tools: getRegisteredToolCount(),
         auth: token.access_token !== undefined,
         ...(token.expires_in !== undefined && { tokenExpiresIn: token.expires_in }),
      })
   })

   if (!config.fhirJwksUrl) {
      app.get("/jwks", jwksHandler)
      console.info(`\x1b[35m🔑 Serving JWKS at http://${config.bindHost === "127.0.0.1" ? "localhost" : config.bindHost}:${config.port}/jwks\x1b[0m`)
   } else
      console.info("🔑 External JWKS URL configured — /jwks disabled")

   app.use("/mcp", (req: Req, res: Res, next: Next) => {
      applyMcpCors(req, res)
      if (req.method === "OPTIONS")
         return void res.status(204).end()
      next()
   })

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
         const displayHost = config.bindHost === "127.0.0.1"
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

const
   corsAllowedOrigins = new Set([
      "https://chatgpt.com",
      "https://chat.openai.com",
   ]),
   corsAllowedHeaders = [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Accept",
      "MCP-Protocol-Version",
      "Mcp-Session-Id",
      "mcp-session-id",
   ].join(", "),
   corsExposedHeaders = [
      "mcp-session-id",
      "x-session-id",
      "MCP-Session-Id",
   ].join(", "),

   applyMcpCors = (req: Req, res: Res) => {
      const origin = req.get("origin")
      if (origin && corsAllowedOrigins.has(origin)) {
         res.setHeader("Access-Control-Allow-Origin", origin)
         res.setHeader("Access-Control-Allow-Credentials", "true")
         res.vary("Origin")
      }
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", corsAllowedHeaders)
      res.setHeader("Access-Control-Expose-Headers", corsExposedHeaders)
   }
