import FHIRStarter from "fhirstarterjs"
import { config } from "../../config.ts"
import { getRequestedScopes } from "../model/definitions.ts"

/** Builds the JWKS document dynamically from all configured private keys. */
const buildJwks = async (): Promise<string> => {
   const keys = await Promise.all(
      config.fhirKeys.map(async ({ kid, privateKey }) => {
         const
            starter = new FHIRStarter({
               clientId: config.fhirClientId,
               privateKey,
               tokenEndpointUrl: config.fhirTokenEndpoint,
               scopes: getRequestedScopes(),
               keyId: kid,
            }),
            jwks = await starter.getJwks()
         return jwks.keys[0]
      }),
   )
   return JSON.stringify({ keys })
}

/** Express GET handler that dynamically serves the JWKS document. */
export const jwksHandler = async (_req: Req, res: Res): Promise<void> => {
   try {
      res.type("application/json").send(await buildJwks())
   } catch (err) {
      console.error("🔑 Failed to build JWKS:", err instanceof Error ? err.message : err)
      res.status(500).json({ error: "Failed to build JWKS" })
   }
}
