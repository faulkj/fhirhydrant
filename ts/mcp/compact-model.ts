import fhirpath_r4_model from "fhirpath/fhir-context/r4/index.js"

export const compactNode = (value: unknown, path: string, isRoot: boolean): unknown => {
   if (value === null || value === undefined) return undefined
   if (Array.isArray(value)) {
      const arr = value.map((item, i) => compactNode(item, path, false)).filter((v) => v !== undefined)
      return arr.length ? arr : undefined
   }
   if (typeof value !== "object") return value

   const
      obj = value as Record<string, unknown>,
      type = resolveType(path),
      simplified = simplify(type, obj)
   if (simplified !== undefined) return simplified

   const out: Record<string, unknown> = {}
   for (const [key, val] of Object.entries(obj)) {
      if (NOISE.has(key)) continue
      if (key.startsWith("_")) continue
      if (key === "id" && !isRoot) continue
      if (key === "resourceType") { out[key] = val; continue }

      const
         childPath = `${path}.${key}`,
         childType = resolveType(childPath),
         compacted = compactNode(val, childType && !isType(childType, "BackboneElement") ? childType : childPath, false)
      if (compacted !== undefined) out[key] = compacted
   }
   return Object.keys(out).length ? out : undefined
}

const
   raw = fhirpath_r4_model as Record<string, unknown>,
   p2t = raw.path2TypeWithoutElements as Record<string, string | string[]> | undefined,
   t2p = raw.type2Parent as Record<string, string> | undefined,
   modelOk = !!(p2t && t2p)

modelOk || console.warn("⚠️ fhirpath R4 model metadata unavailable — compact will use key-only stripping")

const
   NOISE = new Set(["meta", "text", "contained", "extension", "modifierExtension", "implicitRules", "language"]),

   resolveType = (path: string): string | undefined => {
      if (!modelOk) return undefined
      const types = p2t![path]
      if (types) return Array.isArray(types) ? types[0] : types
      if (t2p![path]) return path
      return undefined
   },

   isType = (type: string | undefined, ancestor: string): boolean => {
      if (!type || !modelOk) return false
      let cur: string | undefined = type
      while (cur) {
         if (cur === ancestor) return true
         cur = t2p![cur]
      }
      return false
   },

   pick = (obj: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined => {
      const out: Record<string, unknown> = {}
      let any = false
      for (const k of keys) {
         const v = obj[k]
         if (v !== undefined && v !== null) out[k] = v, any = true
      }
      return any ? out : undefined
   },

   simplifyCoding = (v: Record<string, unknown>) => pick(v, ["code", "display"]),

   SIMPLIFIERS: Record<string, (v: Record<string, unknown>) => unknown> = {
      CodeableConcept: (v) => {
         const
            coding = Array.isArray(v.coding)
               ? v.coding.map((c: Record<string, unknown>) => simplifyCoding(c)).filter(Boolean)
               : undefined,
            text = v.text,
            textIsDup = coding?.length === 1 && text === (coding[0] as Record<string, unknown>).display
         if (!coding?.length && !text) return undefined
         const out: Record<string, unknown> = {}
         coding?.length && (out.coding = coding)
         text && !textIsDup && (out.text = text)
         return out
      },
      Coding: simplifyCoding,
      Reference: (v) =>
         typeof v.reference === "string"
            ? v.reference
            : pick(v, ["display", "identifier"]),
      Identifier: (v) => pick(v, ["system", "value"]),
      HumanName: (v) => pick(v, ["family", "given", "text"]),
      Address: (v) => pick(v, ["line", "city", "state", "postalCode"]),
      ContactPoint: (v) => pick(v, ["system", "value"]),
      Period: (v) => pick(v, ["start", "end"]),
   },

   quantitySimplifier = (v: Record<string, unknown>) => pick(v, ["value", "unit"]),

   simplify = (type: string | undefined, value: Record<string, unknown>): unknown => {
      if (!type) return undefined
      if (SIMPLIFIERS[type]) return SIMPLIFIERS[type](value)
      if (isType(type, "Quantity")) return quantitySimplifier(value)
      return undefined
   }
