import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as z from "zod"
import { validateResources } from "./validate-definitions.ts"

/** Returns the current valid set of generated FHIR resource definitions. */
export const getDefinitions = (): ResourceDefinition[] => snapshot.definitions

/** Returns the SMART scopes derived from the current definitions snapshot. */
export const getScopes = (): string[] => snapshot.scopes

/** Returns the user-editable search-control descriptions from config/search-controls.json. */
export const getSearchControls = (): Record<string, string> => snapshot.searchControls

const configDir = (): string => {
   const
      bundled = join(dirname(fileURLToPath(import.meta.url)), "../..", "config"),
      source = join(dirname(fileURLToPath(import.meta.url)), "../../..", "config")
   return existsSync(join(bundled, "resources.json")) ? bundled : source
}

/** Returns the absolute path to the config directory (bundled or source mode). */
export const getConfigDir = (): string => configDir()

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

const parse = (): DefinitionsSnapshot => {
   const
      dir = getConfigDir(),
      rawResources = JSON.parse(readFileSync(join(dir, "resources.json"), "utf8")) as unknown,
      rawControls = JSON.parse(readFileSync(join(dir, "search-controls.json"), "utf8")) as unknown,
      result = validateResources(rawResources)
   if (result.errors.length > 0)
      throw new Error(`config/resources.json: ${result.errors.join("; ")}`)

   if (!rawControls || typeof rawControls !== "object" || Array.isArray(rawControls))
      throw new Error("config/search-controls.json must be a plain object")
   const searchControls: Record<string, string> = {}
   for (const [key, val] of Object.entries(rawControls as Record<string, unknown>))
      if (typeof val === "string" && val.trim())
         searchControls[key] = val.trim()
      else
         throw new Error(`config/search-controls.json: "${key}" must be a non-empty string`)

   const
      seen = new Set<string>(),
      definitions: ResourceDefinition[] = result.entries.map((entry) => {
         if (seen.has(entry.toolName))
            throw new Error(`config/resources.json: duplicate toolName "${entry.toolName}"`)
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
         d.supportsDirectRead
            ? `system/${d.resourceType}.rs`
            : `system/${d.resourceType}.s`,
      )
   return { definitions, scopes, searchControls }
}

let snapshot = parse()

/**
 * Re-reads config files and rebuilds the snapshot.
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
