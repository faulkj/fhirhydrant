/**
 * Scans a raw FHIR response for OperationOutcome issues (warning/info/error) and
 * builds a one-line note. Detects standalone OperationOutcome resources and Bundle
 * entries (including `search.mode: "outcome"`). PHI-light: emits severity counts plus
 * the first short server diagnostic, which may carry specifics. Returns undefined when
 * there is nothing to surface.
 */
export const outcomeNote = (result: unknown): string | undefined => {
   if (!result || typeof result !== "object") return undefined
   const
      r = result as Record<string, unknown>,
      issues: Record<string, unknown>[] = []

   r.resourceType === "OperationOutcome" && collect(r, issues)
   r.resourceType === "Bundle" && Array.isArray(r.entry) &&
      (r.entry as Record<string, unknown>[]).forEach((e) => {
         const res = e?.resource as Record<string, unknown> | undefined
         res?.resourceType === "OperationOutcome" && collect(res, issues)
      })

   if (!issues.length) return undefined
   const
      counts: Record<string, number> = {},
      first = issues.find((i) => typeof i.diagnostics === "string" || typeof i.details === "object")
   for (const i of issues) {
      const sev = typeof i.severity === "string" ? i.severity : "issue"
      counts[sev] = (counts[sev] ?? 0) + 1
   }
   const
      summary = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`).join(", "),
      text = firstText(first)
   return `OperationOutcome: ${summary}${text ? ` — ${text}` : ""}`
}

const collect = (oo: Record<string, unknown>, into: Record<string, unknown>[]): void => {
   Array.isArray(oo.issue) &&
      (oo.issue as Record<string, unknown>[]).forEach((i) => i && typeof i === "object" && into.push(i))
}

const firstText = (issue: Record<string, unknown> | undefined): string | undefined => {
   if (!issue) return undefined
   const
      diag = typeof issue.diagnostics === "string" ? issue.diagnostics : undefined,
      details = issue.details as Record<string, unknown> | undefined,
      detailText = typeof details?.text === "string" ? details.text : undefined,
      text = (diag ?? detailText)?.trim()
   return text ? (text.length > 160 ? `${text.slice(0, 157)}...` : text) : undefined
}
