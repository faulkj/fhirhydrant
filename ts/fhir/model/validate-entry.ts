const text = (value: unknown): string | undefined =>
   typeof value === "string" && value.trim() ? value.trim() : undefined

/** Validates a single resource entry from config/resources/. Returns the entry or pushes errors. */
export const validateEntry = (
   value: unknown, seen: Set<string>, errors: string[],
): ResourceDefinitionRaw | undefined => {
   if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("entries must be objects")
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
         `Invalid entry for resource "${text(entry["resource"]) ?? "(missing)"}": searchParams must be an object when provided`,
      )
      return undefined
   }

   const
      rt = text(entry["resource"]),
      name = text(entry["toolName"]),
      desc = text(entry["description"])

   if (!rt || !name || !desc || typeof entry.supportsDirectRead !== "boolean") {
      errors.push(
         `Invalid entry for resource "${rt ?? "(missing)"}": requires resource, toolName, description (non-empty strings) and supportsDirectRead (boolean)`,
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
      isParam = (v: unknown): v is string => typeof v === "string" && !!v.trim(),
      rawRequire = entry["requireOneOf"],
      requireOneOf =
         Array.isArray(rawRequire) && rawRequire.length > 0 &&
         rawRequire.every((e: unknown) => isParam(e) || (Array.isArray(e) && e.length > 0 && e.every(isParam)))
            ? rawRequire.map((e) => Array.isArray(e) ? e as string[] : [e as string])
            : undefined

   if (rawRequire !== undefined && !requireOneOf)
      errors.push(`"${name}": requireOneOf must be a non-empty array of param names or non-empty param-name arrays when provided`)

   if (requireOneOf) {
      const paramKeys = new Set(Object.keys(params))
      for (const key of requireOneOf.flat())
         if (!paramKeys.has(key))
            errors.push(`"${name}": requireOneOf key "${key}" is not in searchParams`)
   }

   if (entry["trustConfig"] !== undefined && typeof entry["trustConfig"] !== "boolean")
      errors.push(`"${name}": trustConfig must be a boolean when provided`)

   return {
      resource: rt,
      toolName: name,
      description: desc,
      supportsDirectRead: entry["supportsDirectRead"] as boolean,
      searchParams:
         Object.keys(params).length > 0
            ? (params as Record<string, string>)
            : undefined,
      requireOneOf,
      trustConfig: entry["trustConfig"] === true ? true : undefined,
   }
}
