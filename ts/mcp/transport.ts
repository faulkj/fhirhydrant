import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server"
import { config } from "../config.ts"
import { withAuditContext } from "../audit.ts"
import { jwksHandler } from "../fhir/auth/jwks.ts"

/** Handle returned by transport start functions; provides attach (bind server) and close operations. */
export type TransportHandle = {
   attach: (s: McpServer) => Promise<void>
   close: () => Promise<void>
}

/** Starts the HTTP/SSE MCP transport and returns a handle to attach a server and shut down the listener. */
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

   app.get("/health", (_req: Req, res: Res) => res.json({ status: "ok" }))

   if (!config.fhirJwksUrl) {
      app.get("/jwks", jwksHandler)
      console.info(`\x1b[35m🔑 Serving JWKS at http://${config.bindHost === "0.0.0.0" ? "localhost" : config.bindHost}:${config.port}/jwks\x1b[0m`)
   } else
      console.info("🔑 External JWKS URL configured — /jwks disabled")

   app.all("/mcp", async (req: Req, res: Res) => {
      if (!mcpReady)
         return void res.status(503).json({ status: "starting" })
      const
         body = req.body as Record<string, unknown> | undefined,
         method = body?.method as string | undefined,
         toolName = method === "tools/call" ? (body?.params as Record<string, unknown>)?.name as string | undefined : undefined
      method && console.log(toolName ? `🔨 ${toolName.charAt(0).toUpperCase()}${toolName.slice(1)}` : `🔌 ${method}`)
      const user = config.auditUserHeader ? req.get(config.auditUserHeader)?.trim() || undefined : undefined
      await withAuditContext(user ? { user } : {}, () => transport.handleRequest(req, res, req.body))
   })

   app.use((err: Error, _req: Req, res: Res, _next: Next) => {
      console.error("🌐 Request error:", err.message)
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
}

/** Starts the stdio MCP transport and returns a handle to attach a server and close the connection. */
export const startStdio = async (): Promise<TransportHandle> => {
   console.log = (...args: unknown[]) => console.error(...args)
   console.info = (...args: unknown[]) => console.error(...args)
   const transport = new StdioServerTransport()
   return {
      attach: async (s: McpServer) => {
         await s.connect(transport)
         console.info("\x1b[34m🚒 fhirhydrant running in stdio mode\x1b[0m")
      },
      close: async () => {
         await transport.close()
      },
   }
}
