import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { config } from "../config.ts"
import { getDefinitions } from "./definitions.ts"
import { createFhirClient } from "./client.ts"
import { withRetry } from "./utils.ts"
import { filterAndValidateDefinitions, checkRuntimeCapability, fetchMetadata, getCapabilitySummary } from "./metadata.ts"

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
      (def: ResourceDefinition) => async (args: Record<string, unknown>) => {
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
         makeHandler(def),
      )
}

const validatePageUrl = (url: string): string => {
   const
      baseHref = config.fhirServerUrl.replace(/\/?$/, "/"),
      serverUrl = new URL(baseHref),
      nextUrl = new URL(url, baseHref)

   if (nextUrl.origin !== serverUrl.origin)
      throw new Error(
         `Pagination URL origin "${nextUrl.origin}" does not match FHIR server origin "${serverUrl.origin}"`,
      )

   if (!nextUrl.pathname.startsWith(serverUrl.pathname))
      throw new Error(
         `Pagination URL path "${nextUrl.pathname}" is outside FHIR server base path "${serverUrl.pathname}"`,
      )

   return nextUrl.toString()
}

/** Registers built-in infrastructure tools (e.g. pagination) on the server. */
export const registerCoreTools = (server: McpServer): void => {
   server.registerTool(
      "fhir_fetch_page",
      {
         description:
            "Fetch a single page of FHIR Bundle results using a pagination URL. " +
            'The url must come from a FHIR Bundle\'s link array where relation is "next". ' +
            "Do not construct pagination URLs manually — only use links returned by the FHIR server.",
         inputSchema: z.object({
            url: z
               .string()
               .describe(
                  "Pagination URL from a FHIR Bundle link[rel=next].url value",
               ),
         }),
      },
      async (args: { url: string }) => {
         try {
            const
               validatedUrl = validatePageUrl(args.url),
               client = createFhirClient()

            config.debug ?
               console.log(`[fhir] fetch_page → ${validatedUrl}`)
            :  console.log("[fhir] fetch_page")

            const
               result = await withRetry("fetch_page", () => client.request(validatedUrl)),
               summary =
                  (
                     result &&
                     typeof result === "object" &&
                     (result as Record<string, unknown>).resourceType ===
                        "Bundle"
                  ) ?
                     `Bundle total=${(result as Record<string, unknown>).total ?? "?"}`
                  :  "ok"
            console.log(`[fhir] fetch_page OK ${summary}`)
            return {
               content: [
                  {
                     type: "text" as const,
                     text: JSON.stringify(result, null, 2),
                  },
               ],
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[fhir] fetch_page ERR ${message}`)
            return {
               content: [
                  {
                     type: "text" as const,
                     text: `${message}\n\nRetry with the same url to resume from this page.`,
                  },
               ],
               isError: true,
            }
         }
      },
   )

   server.registerTool(
      "capabilities",
      {
         description:
            "Returns a summary of the FHIR server's capabilities from /metadata (CapabilityStatement). " +
            "Shows supported resource types, their interactions, search parameters, and any tools that were skipped. " +
            "Call this before clinical queries to understand what the server supports. " +
            "Set refresh=true to re-fetch /metadata from the server.",
         inputSchema: z.object({
            refresh: z
               .boolean()
               .optional()
               .describe("Re-fetch /metadata from the server before returning the summary"),
         }),
      },
      async (args: { refresh?: boolean }) => {
         try {
            if (args.refresh) await fetchMetadata()
            const summary = getCapabilitySummary()
            if (!summary)
               return {
                  content: [{
                     type: "text" as const,
                     text: "No /metadata available. The server may not support CapabilityStatement, or FHIR_METADATA_MODE is set to off.",
                  }],
               }
            return {
               content: [{
                  type: "text" as const,
                  text: JSON.stringify(summary, null, 2),
               }],
            }
         } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            console.error(`[metadata] capabilities ERR ${message}`)
            return {
               content: [{ type: "text" as const, text: message }],
               isError: true,
            }
         }
      },
   )
}
