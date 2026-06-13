import { validateEntry } from "./validate-entry.ts"

const empty: ValidationResult = { entries: [], searchControls: {}, errors: [] }

/** Validates the raw config/definitions.json shape (object format) and returns cleaned entries + searchControls + errors. */
export const validateDefinitions = (raw: unknown): ValidationResult => {
   const errors: string[] = []

   if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return (errors.push("config/definitions.json must be an object with resources and searchControls"), empty)

   const root = raw as Record<string, unknown>

   if (!Array.isArray(root.resources))
      return (errors.push("config/definitions.json: resources must be an array"), empty)

   const rawCtrl = root.searchControls
   if (!rawCtrl || typeof rawCtrl !== "object" || Array.isArray(rawCtrl))
      return (errors.push("config/definitions.json: searchControls must be an object"), empty)

   const searchControls: Record<string, string> = {}
   for (const [key, val] of Object.entries(rawCtrl as Record<string, unknown>))
      if (typeof val === "string" && val.trim())
         searchControls[key] = val.trim()
      else if (val !== undefined)
         errors.push(`searchControls: "${key}" must be a non-empty string`)

   const
      seen = new Set<string>(),
      entries: ResourceDefinitionRaw[] = []

   for (const value of root.resources as unknown[]) {
      const entry = validateEntry(value, seen, errors)
      entry && entries.push(entry)
   }

   return { entries, searchControls, errors }
}
