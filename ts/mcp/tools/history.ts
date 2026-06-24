import type { McpServer } from "@modelcontextprotocol/server"
import type { z } from "zod"
import { buildHistoryUrl } from "../../fhir/transform/shaping.ts"
import { validateDateArgs } from "../validation.ts"
import { readOnlyAnnotations } from "../annotations.ts"
import { executeRead } from "../read-response.ts"

/** Registers the system-level _history core tool. */
export const addSystemHistory = (
   server: McpServer, description: string, inputSchema: z.ZodObject<z.ZodRawShape>,
): void => {
   server.registerTool(
      "system_history",
      { description, inputSchema, annotations: readOnlyAnnotations },
      async (args: Record<string, unknown>) => {
         const
            t0 = Date.now(),
            dateErr = validateDateArgs(args)
         if (dateErr)
            return { content: [{ type: "text" as const, text: dateErr }], isError: true }

         const
            since = typeof args["_since"] === "string" && args["_since"] ? args["_since"] : undefined,
            at = typeof args["_at"] === "string" && args["_at"] ? args["_at"] : undefined,
            count = args["_count"] != null ? Number(args["_count"]) : undefined,
            url = buildHistoryUrl("_history", since, at, count)

         return executeRead({
            url, tool: "system_history", op: "history", args, t0,
            isBundle: true, allowCoalesce: true,
         })
      },
   )
}
