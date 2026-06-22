import { createPrivateKey, createPublicKey } from "node:crypto"
import { config } from "../../config.ts"

/** Cached JWKS JSON built once at module load from all configured keys. */
const jwksJson: string = JSON.stringify({
   keys: [config.fhirActiveKey, ...config.fhirRetiredKeys].map(({ kid, privateKey }) => {
      const pub = createPublicKey(createPrivateKey(privateKey)).export({ format: "jwk" }) as Record<string, unknown>
      return { ...pub, kid, alg: "RS384", use: "sig" }
   }),
})

/** Express GET handler that serves the cached JWKS document. */
export const jwksHandler = (_req: Req, res: Res): void => {
   res.set("Cache-Control", "public, max-age=3600").type("application/json").send(jwksJson)
}
