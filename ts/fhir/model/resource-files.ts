import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Reads every `*.json` file in `<configDir>/resources`, sorted by filename for
 * deterministic order, and returns the parsed objects as an array suitable for
 * validateResources. Each file must contain a single resource object. Throws
 * with the offending filename on any read or JSON parse error.
 */
export const loadResourceFiles = (configDir: string): unknown[] => {
   const
      dir = join(configDir, "resources"),
      files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort()

   return files.map((file) => {
      try {
         return JSON.parse(readFileSync(join(dir, file), "utf8"))
      } catch (err) {
         throw new Error(`config/resources/${file}: ${err instanceof Error ? err.message : err}`)
      }
   })
}
