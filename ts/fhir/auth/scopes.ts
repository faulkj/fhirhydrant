/** Parses a SMART v2 (or v1) granted scope string into a resource → permissions map. */
export const parseGrantedScopes = (scope: string | undefined): Map<string, Set<ScopePermission>> => {
   const map = new Map<string, Set<ScopePermission>>()
   if (!scope?.trim()) return map

   for (const token of scope.split(/\s+/)) {
      const match = SCOPE_RE.exec(token)
      if (!match) continue
      const
         resource = match[1]!,
         permissions = normalizePermissions(match[2]!)
      if (!permissions.size) continue
      const existing = map.get(resource)
      existing
         ? permissions.forEach((perm) => existing.add(perm))
         : map.set(resource, permissions)
   }
   return map
}

/** Returns true when the scope map is permissive (empty) or explicitly grants access to the resource. */
export const scopeAllowsResource = (resource: string, scopeMap: Map<string, Set<ScopePermission>>): boolean =>
   scopeMap.size === 0 || scopeMap.has(resource) || scopeMap.has("*")

/** Returns the set of ToolActions allowed for a resource by the scope map. Empty map = all actions. */
export const scopeActions = (resource: string, scopeMap: Map<string, Set<ScopePermission>> | undefined): Set<ToolAction> => {
   if (!scopeMap || scopeMap.size === 0) return ALL_ACTIONS

   const
      explicit = scopeMap.get(resource),
      wildcard = scopeMap.get("*"),
      merged = new Set<ScopePermission>()
   explicit?.forEach((perm) => merged.add(perm))
   wildcard?.forEach((perm) => merged.add(perm))
   if (merged.size === 0) return new Set()

   const actions = new Set<ToolAction>()
   for (const perm of merged) {
      const mapped = PERM_TO_ACTIONS[perm]
      mapped && mapped.forEach((action) => actions.add(action))
   }
   return actions
}

const
   SCOPE_RE = /^system\/([A-Z][A-Za-z]*|\*)\.([\w*]+)$/,
   V1_MAP: Record<string, string> = { read: "rs", write: "cud", "*": "cruds" },
   VALID_PERMS = new Set<ScopePermission>(["c", "r", "u", "d", "s"]),

   normalizePermissions = (raw: string): Set<ScopePermission> => {
      const
         normalized = V1_MAP[raw] ?? raw,
         perms = new Set<ScopePermission>()
      for (const char of normalized)
         if (VALID_PERMS.has(char as ScopePermission))
            perms.add(char as ScopePermission)
      return perms
   },

   PERM_TO_ACTIONS: Record<ScopePermission, ToolAction[]> = {
      c: ["create"],
      r: ["read"],
      u: ["update", "patch"],
      d: ["delete"],
      s: ["search"],
   },

   ALL_ACTIONS: Set<ToolAction> = new Set(["search", "read", "create", "update", "patch", "delete"])
