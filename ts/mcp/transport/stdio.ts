import { StdioServerTransport } from "@modelcontextprotocol/server"

/** Starts the stdio MCP transport and returns a handle to attach a server and close the connection. */
export const startStdio = async (): Promise<TransportHandle> => {
   const transport = new StdioServerTransport()
   let connectedServer: import("@modelcontextprotocol/server").McpServer | undefined
   return {
      attach: async (factory) => {
         connectedServer = factory()
         await connectedServer.connect(transport)
         console.info("\x1b[34m🚒 fhirhydrant running in stdio mode\x1b[0m")
      },
      close: async () => {
         await connectedServer?.close()
         await transport.close()
      },
   }
}
