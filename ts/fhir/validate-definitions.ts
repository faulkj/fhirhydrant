import { validateEntry } from "./validate-entry.ts"

/** Validates the raw config/resources.json array and returns cleaned entries + errors. */
export const validateResources = (raw: unknown): ValidationResult => {
   const errors: string[] = []

   if (!Array.isArray(raw))
      return { entries: [], errors: ["must be an array"] }

   const
      seen = new Set<string>(),
      entries: ResourceDefinitionRaw[] = []

   for (const value of raw as unknown[]) {
      const entry = validateEntry(value, seen, errors)
      entry && entries.push(entry)
   }

   return { entries, errors }
}
