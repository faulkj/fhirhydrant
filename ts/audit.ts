import { appendFile } from "node:fs/promises"

let sinks: AuditSinkFn[] = []

/** Initializes audit sinks from config. Call once at startup before any tool dispatch. */
export const initAuditSinks = (names: AuditSinkName[], filePath: string): void => {
   sinks = []
   for (const name of names) {
      if (name === "console")
         sinks.push((e) => console.log(`[audit] ${JSON.stringify(e)}`))
      else if (name === "file")
         sinks.push((e) =>
            void appendFile(filePath, JSON.stringify(e) + "\n", "utf8")
               .catch((err) => console.error(`[audit] File write failed: ${err instanceof Error ? err.message : err}`)),
         )
   }
   sinks.length && console.log(`[audit] Active sinks: ${names.join(", ")}`)
}

/** Dispatches a structured audit event to all active sinks. */
export const emitAudit = (event: AuditEvent): void => {
   for (const sink of sinks) sink(event)
}

/** Returns elapsed milliseconds since `start`. */
export const auditTime = (start: number): number => Date.now() - start

/** Extracts an HTTP status code from common error shapes, or undefined. */
export const errorStatus = (err: unknown): number | undefined => {
   if (!err || typeof err !== "object") return undefined
   const e = err as Record<string, unknown>
   const s = typeof e.status === "number" ? e.status
      : typeof e.statusCode === "number" ? e.statusCode
      : e.response && typeof e.response === "object" && typeof (e.response as Record<string, unknown>).status === "number"
         ? (e.response as Record<string, unknown>).status as number
      : undefined
   return s && s >= 100 && s < 600 ? s : undefined
}
