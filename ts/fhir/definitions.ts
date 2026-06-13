import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as z from "zod"
import { validateDefinitions } from "./validate-definitions.ts"

/** Returns the current valid set of generated FHIR resource definitions. */
export const getDefinitions = (): ResourceDefinition[] => snapshot.definitions

/** Returns the SMART scopes derived from the current definitions snapshot. */
export const getScopes = (): string[] => snapshot.scopes

/** Returns the user-editable search-control descriptions from definitions.json. */
export const getsearchControls = (): Record<string, string> => snapshot.searchControls

const packaged = join(dirname(fileURLToPath(import.meta.url)), "../..", "definitions.json")

export const getDefinitionsPath = (): string => {
   const cwd = join(process.cwd(), "definitions.json")
   return existsSync(cwd) ? cwd : packaged
}

/** Builds a Zod shape from search params, auto-injecting _id when needed. */
export const buildShape = (
   params: Record<string, string>,
   resourceType: string,
   supportsDirectRead: boolean,
): Record<string, z.ZodOptional<z.ZodString>> => {
   const shape: Record<string, z.ZodOptional<z.ZodString>> = Object.fromEntries(
      Object.entries(params).map(([key, desc]) => [key, z.string().optional().describe(desc)]),
   )
   if (supportsDirectRead && !shape["_id"]) {
      shape["_id"] = z.string().optional().describe(`${resourceType} resource ID — performs direct read when provided alone`)
      console.warn(`📋 "${resourceType}": auto-injected _id for supportsDirectRead`)
   }
   return shape
}

type Snapshot = { definitions: ResourceDefinition[]; scopes: string[]; searchControls: Record<string, string> }

const parse = (): Snapshot => {
   const
      raw = JSON.parse(readFileSync(getDefinitionsPath(), "utf8")) as unknown,
      result = validateDefinitions(raw)
   if (result.errors.length > 0)
      throw new Error(`definitions.json: ${result.errors.join("; ")}`)

   const
      seen = new Set<string>(),
      definitions: ResourceDefinition[] = result.entries.map((entry) => {
         if (seen.has(entry.toolName))
            throw new Error(`definitions.json: duplicate toolName "${entry.toolName}"`)
         seen.add(entry.toolName)

         const params = entry.searchParams ?? {}
         return {
            resourceType: entry.resourceType,
            toolName: entry.toolName,
            description: entry.description,
            supportsDirectRead: entry.supportsDirectRead,
            requireOneOf: entry.requireOneOf,
            requireCombination: entry.requireCombination,
            searchParams: params,
            searchSchema: z.object(buildShape(params, entry.resourceType, entry.supportsDirectRead)),
         }
      }),
      scopes = definitions.map((d) =>
         d.supportsDirectRead ?
            `system/${d.resourceType}.rs`
         :  `system/${d.resourceType}.s`,
      )
   return { definitions, scopes, searchControls: result.searchControls }
}

let snapshot = parse()

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
         "📋 Reload failed — keeping last valid snapshot:",
         err instanceof Error ? err.message : err,
      )
      return false
   }
}
