const text = (value: unknown): string | undefined =>
   typeof value === "string" && value.trim() ? value.trim() : undefined

/** Validates a single resource entry from config/definitions.json. Returns the entry or pushes errors. */
export const validateEntry = (
   value: unknown, seen: Set<string>, errors: string[],
): ResourceDefinitionRaw | undefined => {
   if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("config/definitions.json entries must be objects")
      return undefined
   }

   const
      entry = value as Record<string, unknown>,
      searchParams = entry["searchParams"]

   if (
      searchParams !== undefined &&
      (!searchParams || typeof searchParams !== "object" || Array.isArray(searchParams))
   ) {
      errors.push(
         `Invalid entry for resourceType "${text(entry["resourceType"]) ?? "(missing)"}": searchParams must be an object when provided`,
      )
      return undefined
   }

   const
      rt = text(entry["resourceType"]),
      name = text(entry["toolName"]),
      desc = text(entry["description"])

   if (!rt || !name || !desc || typeof entry.supportsDirectRead !== "boolean") {
      errors.push(
         `Invalid entry for resourceType "${rt ?? "(missing)"}": requires resourceType, toolName, description (non-empty strings) and supportsDirectRead (boolean)`,
      )
      return undefined
   }

   if (seen.has(name)) {
      errors.push(`Duplicate toolName "${name}"`)
      return undefined
   }
   seen.add(name)

   const params = (searchParams ?? {}) as Record<string, unknown>

   for (const [key, val] of Object.entries(params))
      if (typeof key !== "string" || typeof val !== "string")
         errors.push(`"${name}": searchParams keys and values must be strings (got key="${key}")`)

   if (!entry.supportsDirectRead && Object.keys(params).length === 0) {
      errors.push(`"${name}" has no searchParams and supportsDirectRead is false`)
      return undefined
   }

   const
      rawRequire = entry["requireOneOf"],
      requireOneOf =
         Array.isArray(rawRequire) && rawRequire.length > 0 && rawRequire.every((v: unknown) => typeof v === "string" && v.trim())
            ? (rawRequire as string[])
            : undefined

   if (rawRequire !== undefined && !requireOneOf)
      errors.push(`"${name}": requireOneOf must be a non-empty array of strings when provided`)

   if (requireOneOf) {
      const paramKeys = new Set(Object.keys(params))
      for (const key of requireOneOf)
         if (!paramKeys.has(key))
            errors.push(`"${name}": requireOneOf key "${key}" is not in searchParams`)
   }

   const
      rawCombo = entry["requireCombination"],
      requireCombination =
         Array.isArray(rawCombo) && rawCombo.length > 0 &&
         rawCombo.every((c: unknown) => Array.isArray(c) && c.length > 0 && c.every((v: unknown) => typeof v === "string" && v.trim()))
            ? (rawCombo as string[][])
            : undefined

   if (rawCombo !== undefined && !requireCombination)
      errors.push(`"${name}": requireCombination must be a non-empty array of non-empty string arrays when provided`)

   if (requireCombination) {
      const paramKeys = new Set(Object.keys(params))
      for (const combo of requireCombination)
         for (const key of combo)
            if (!paramKeys.has(key))
               errors.push(`"${name}": requireCombination key "${key}" is not in searchParams`)
   }

   return {
      resourceType: rt,
      toolName: name,
      description: desc,
      supportsDirectRead: entry["supportsDirectRead"] as boolean,
      searchParams:
         Object.keys(params).length > 0
            ? (params as Record<string, string>)
            : undefined,
      requireOneOf,
      requireCombination,
   }
}
