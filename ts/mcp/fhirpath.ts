import fhirpath from "fhirpath"
import fhirpath_r4_model from "fhirpath/fhir-context/r4/index.js"

export const extractFhirPath = (args: Record<string, unknown>): string | undefined => {
   const raw = args["fhirpath"]
   delete args["fhirpath"]
   return typeof raw === "string" && raw.trim() ? raw.trim() : undefined
}

export const applyFhirPath = (
   result: unknown, expression: string,
): { nodes: unknown[] } | { error: string } => {
   try {
      return { nodes: fhirpath.evaluate(result, expression, undefined, fhirpath_r4_model) as unknown[] }
   } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
   }
}
