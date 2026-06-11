import type { McpServer } from "@modelcontextprotocol/server"
import { config } from "../config.ts"
import { getDefinitions } from "../fhir/definitions.ts"
import { createFhirClient } from "../fhir/client.ts"
import { withRetry } from "../utils.ts"
import { filterAndValidateDefinitions, checkRuntimeCapability } from "./validation.ts"

const
   buildSearchUrl = (
      resourceType: string,
      args: Record<string, unknown>,
   ): string => {
      const params = new URLSearchParams()
      for (const [key, val] of Object.entries(args))
         val !== undefined && val !== "" && params.append(key, String(val))
      const qs = params.toString()
      return qs ? `${resourceType}?${qs}` : resourceType
   },
   isDirectRead = (
      args: Record<string, unknown>,
      supportsDirectRead: boolean,
   ): string | undefined => {
      if (!supportsDirectRead) return undefined
      const id =
         typeof args["_id"] === "string" && args["_id"] ?
            args["_id"]
         :  undefined
      if (!id) return undefined
      const otherKeys = Object.entries(args).some(
         ([k, v]) => k !== "_id" && v !== undefined && v !== "",
      )
      return otherKeys ? undefined : id
   },
   makeHandler =
      (toolName: string) => async (args: Record<string, unknown>) => {
         const def = getDefinitions().find((d) => d.toolName === toolName)
         if (!def)
            return {
               content: [{ type: "text" as const, text: `Tool "${toolName}" is no longer in definitions — restart to apply definition changes` }],
               isError: true,
            }
         const
            directId = isDirectRead(args, def.supportsDirectRead),
            cap = checkRuntimeCapability(def, args, directId)
         if (cap.error)
            return {
               content: [{ type: "text" as const, text: cap.error }],
               isError: true,
            }
         if (!directId && def.requireOneOf) {
            const ok = def.requireOneOf.some((k) => {
               const v = args[k]
               return typeof v === "string" && v !== ""
            })
            if (!ok)
               return {
                  content: [{ type: "text" as const, text: `Search requires at least one of: ${def.requireOneOf.join(", ")}` }],
                  isError: true,
               }
         }
         try {
            const
               client = createFhirClient(),
               url =
                  directId ?
                     `${def.resourceType}/${directId}`
                  :  buildSearchUrl(def.resourceType, args),
               op = directId ? "read" : "search"

            config.debug ?
               console.log(`[fhir] ${def.resourceType} ${op} → ${url}`)
            :  console.log(`[fhir] ${def.resourceType} ${op}`)

            const
               result = await withRetry(`${def.resourceType} ${op}`, () => client.request(url)),
               summary =
                  (
                     result &&
                     typeof result === "object" &&
                     (result as Record<string, unknown>).resourceType ===
                        "Bundle"
                  ) ?
                     `Bundle total=${(result as Record<string, unknown>).total ?? "?"}`
                  :  ((result as Record<string, unknown>)?.resourceType ??
                     "ok")
            console.log(`[fhir] ${def.resourceType} OK ${summary}`)
            const text =
               cap.warning ?
                  `${cap.warning}\n\n${JSON.stringify(result, null, 2)}`
               :  JSON.stringify(result, null, 2)
            return {
               content: [{ type: "text" as const, text }],
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[fhir] ${def.resourceType} ERR ${message}`)
            return {
               content: [{ type: "text" as const, text: message }],
               isError: true,
            }
         }
      }

/** Registers an MCP tool for every ResourceDefinition in the current snapshot. */
export const registerAll = (server: McpServer): void => {
   for (const def of filterAndValidateDefinitions(getDefinitions()))
      server.registerTool(
         def.toolName,
         { description: def.description, inputSchema: def.searchSchema },
         makeHandler(def.toolName),
      )
}
