import { StdioServerTransport } from "@modelcontextprotocol/server/stdio"
import { log } from "../../log.ts"

/** Starts the stdio MCP transport and returns a handle to attach a server and close the connection. */
export const startStdio = async (): Promise<TransportHandle> => {
   const transport = new StdioServerTransport()
   let connectedServer: import("@modelcontextprotocol/server").McpServer | undefined
   return {
      attach: async (factory) => {
         connectedServer = factory()
         await connectedServer.connect(transport)
         log.log("🚒 fhirhydrant running in stdio mode")
      },
      close: async () => {
         await connectedServer?.close()
         await transport.close()
      },
   }
}
