import { createPrivateKey, createPublicKey } from "node:crypto"
import type { PublicKeyInput } from "node:crypto"
import { config } from "../../config/index.ts"

const jwksJson: string = JSON.stringify({
   keys: [config.fhirActiveKey, ...config.fhirRetiredKeys].map(({ kid, privateKey }) => {
      const
         keyObject = createPublicKey(createPrivateKey(privateKey) as unknown as PublicKeyInput),
         { kty, n, e } = keyObject.export({ format: "jwk" }) as Record<string, unknown>
      return { kty, n, e, kid, alg: "RS384", use: "sig" }
   }),
})

/** Express GET handler that serves the cached JWKS document. */
export const jwksHandler = (_req: Req, res: Res): void => {
   res.set("Cache-Control", "public, max-age=3600").type("application/json").send(jwksJson)
}
