import messages from "../config/messages.json" with { type: "json" }

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

/** Retries an async operation with exponential backoff on transient errors. */
export const withRetry = async <T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> => {
   for (let i = 0; i < attempts; i++) {
      try {
         return await fn()
      } catch (err) {
         if (i + 1 >= attempts || !retryable(err)) throw err
         const delay = 1000 * 2 ** i
         console.warn(`🔥 ${label} transient error, retrying in ${delay}ms (${i + 1}/${attempts})`)
         await new Promise((r) => setTimeout(r, delay))
      }
   }
   throw new Error("unreachable")
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
