import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { config } from "../../config.ts"
import { getConfigDir } from "./definitions.ts"
import { validateOperations } from "./validate-operations.ts"

let catalog: OperationDefinition[] = []

const load = (): OperationDefinition[] => {
   const path = join(getConfigDir(), "operations.json")
   if (!existsSync(path)) {
      config.debug && console.info("📋 No config/operations.json found — operations disabled")
      return []
   }
   const
      raw = JSON.parse(readFileSync(path, "utf8")) as unknown,
      result = validateOperations(raw)

   if (result.errors.length > 0)
      throw new Error(`config/operations.json: ${result.errors.join("; ")}`)

   const defs: OperationDefinition[] = result.entries.map((e) => ({
      key: e.key,
      operation: e.operation,
      resource: e.resource,
      level: e.level as OperationLevel[],
      method: e.method as "GET" | "POST",
      description: e.description,
      params: e.params,
      requiresOneOf: e.requiresOneOf ?? [],
      acceptsBody: e.acceptsBody ?? false,
      bundleResponse: e.bundleResponse,
      auditOperation: e.auditOperation,
      affectsState: e.affectsState,
      defaultResponseMode: e.defaultResponseMode,
      notes: e.notes,
   }))

   const allowed = config.operations
   if (allowed) {
      const filtered = defs.filter((d) => allowed.has(d.key))
      config.debug && filtered.length < defs.length
         && console.info(`📋 FHIR_OPERATIONS filter: ${filtered.length}/${defs.length} operations enabled`)
      return filtered
   }
   return defs
}

catalog = load()

/** Returns the current set of enabled operation definitions. */
export const getOperations = (): OperationDefinition[] => catalog

/** Looks up a single operation by catalog key. */
export const getOperation = (key: string): OperationDefinition | undefined =>
   catalog.find((o) => o.key === key)

/**
 * Re-reads operations.json and rebuilds the catalog.
 * Returns true on success; on failure, logs and retains the last valid catalog.
 */
export const reloadOperations = (): boolean => {
   try {
      catalog = load()
      return true
   } catch (err) {
      console.error("📋 Failed to reload operations:", err instanceof Error ? err.message : err)
      return false
   }
}
