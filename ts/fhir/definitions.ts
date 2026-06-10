import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as z from "zod"
import { validateDefinitions } from "./validate-definitions.ts"

const packaged = join(dirname(fileURLToPath(import.meta.url)), "../..", "definitions.json")

export const getDefinitionsPath = (): string => {
   const cwd = join(process.cwd(), "definitions.json")
   return existsSync(cwd) ? cwd : packaged
}

const parse = (): { definitions: ResourceDefinition[]; scopes: string[] } => {
   const
      raw = JSON.parse(
         readFileSync(getDefinitionsPath(), "utf8"),
      ) as unknown,
      result = validateDefinitions(raw)
   if (result.errors.length > 0)
      throw new Error(`definitions.json: ${result.errors.join("; ")}`)

   const
      seen = new Set<string>(),
      definitions: ResourceDefinition[] = result.entries.map((entry) => {
         if (seen.has(entry.toolName))
            throw new Error(
               `definitions.json: duplicate toolName "${entry.toolName}"`,
            )
         seen.add(entry.toolName)

         const
            params = entry.searchParams ?? {},
            shape: Record<
               string,
               z.ZodOptional<z.ZodString>
            > = Object.fromEntries(
               Object.entries(params).map(([key, desc]) => [
                  key,
                  z.string().optional().describe(desc),
               ]),
            )

         if (entry.supportsDirectRead && !shape["_id"]) {
            shape["_id"] = z
               .string()
               .optional()
               .describe(
                  `${entry.resourceType} resource ID — performs direct read when provided alone`,
               )
            console.warn(
               `[definitions] "${entry.toolName}": auto-injected _id for supportsDirectRead`,
            )
         }

         const schema = z.object(shape)

         return {
            resourceType: entry.resourceType,
            toolName: entry.toolName,
            description: entry.description,
            supportsDirectRead: entry.supportsDirectRead,
            requireOneOf: entry.requireOneOf,
            searchSchema: schema,
         }
      }),
      scopes = definitions.map((d) =>
         d.supportsDirectRead ?
            `system/${d.resourceType}.rs`
         :  `system/${d.resourceType}.s`,
      )
   return { definitions, scopes }
}

let snapshot = parse()

/** Returns the current valid set of generated FHIR resource definitions. */
export const getDefinitions = (): ResourceDefinition[] => snapshot.definitions

/** Returns the SMART scopes derived from the current definitions snapshot. */
export const getScopes = (): string[] => snapshot.scopes

/**
 * Re-reads definitions.json and rebuilds the snapshot.
 * Returns true on success. On failure, logs the error and retains the last valid snapshot.
 */
export const reloadDefinitions = (): boolean => {
   try {
      snapshot = parse()
      return true
   } catch (err) {
      console.error(
         "[definitions] Reload failed — keeping last valid snapshot:",
         err instanceof Error ? err.message : err,
      )
      return false
   }
}
