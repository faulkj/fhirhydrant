import messages from "../../config/messages.json" with { type: "json" }

/** Checks whether an error is transient and eligible for retry. */
export const retryable = (err: unknown): boolean => {
   if (err instanceof Error) {
      const msg = err.message.toLowerCase()
      return (
         msg.includes("econnreset") ||
         msg.includes("epipe") ||
         msg.includes("etimedout") ||
         msg.includes("socket hang up") ||
         msg.includes("forcibly closed") ||
         msg.includes("network") ||
         msg.includes("fetch failed")
      )
   }
   return false
}

/** Returns true when an error was caused by an AbortSignal timeout. */
const isTimeout = (err: unknown): boolean =>
   err instanceof DOMException && err.name === "TimeoutError"
   || err instanceof Error && err.name === "AbortError"

/** Retries an async operation with exponential backoff on transient errors.
 *  When `timeoutMs` is given each attempt gets its own AbortSignal.timeout(). */
export const withRetry = async <T>(
   label: string,
   fn: (signal?: AbortSignal) => Promise<T>,
   attempts = 3,
   timeoutMs?: number,
): Promise<T> => {
   for (let i = 0; i < attempts; i++) {
      try {
         const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
         return await fn(signal)
      } catch (err) {
         const timedOut = isTimeout(err)
         if (i + 1 >= attempts || (!timedOut && !retryable(err))) throw err
         const delay = 1000 * 2 ** i
         console.warn(`🔥 ${label} — ${timedOut ? "timed out" : "transient error"}, retrying in ${delay}ms (${i + 1}/${attempts})`)
         await new Promise((r) => setTimeout(r, delay))
      }
   }
   throw new Error("unreachable")
}

/** Extracts a clean error message from fhirclient HttpError or generic errors.
 *  - Log line: short status + first OperationOutcome issue text (for console)
 *  - Client message: status + all issue texts (no URL, no raw JSON) */
export const formatFhirError = (err: unknown): { log: string, client: string } => {
   const raw = err instanceof Error ? err.message : String(err)
   if (!err || typeof err !== "object" || !("statusCode" in err)) return { log: raw, client: raw }
   const
      status = `${(err as Record<string, unknown>).statusCode} ${(err as Record<string, unknown>).statusText ?? ""}`.trim(),
      jsonMatch = raw.match(/\n\n(\{[\s\S]+\})$/),
      body = jsonMatch ? (() => { try { return JSON.parse(jsonMatch[1]) } catch { return null } })() : null
   if (!body || body.resourceType !== "OperationOutcome" || !Array.isArray(body.issue))
      return { log: status, client: status }
   const issues = (body.issue as Array<Record<string, unknown>>)
      .map((i) => [
         typeof i.severity === "string" ? i.severity : undefined,
         (i.details as Record<string, unknown>)?.text ?? i.diagnostics ?? undefined,
      ].filter(Boolean).join(": "))
      .filter(Boolean)
   return issues.length
      ? { log: `${status} — ${issues[0]}`, client: `${status}\n${issues.join("\n")}` }
      : { log: status, client: status }
}

/** Returns the text unchanged or an error payload when it exceeds the byte limit. */
export const enforceByteLimit = (text: string, limit: number): { text: string, isError?: true } => {
   const bytes = Buffer.byteLength(text, "utf8")
   return bytes <= limit ? { text } : {
      text: messages.responseTooLarge
         .replace("{bytes}", bytes.toString())
         .replace("{limit}", limit.toString()),
      isError: true,
   }
}
