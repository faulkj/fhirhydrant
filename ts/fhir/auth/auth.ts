import fhirStarter from "fhirstarterjs"
import { config } from "../../config.ts"
import { getRequestedScopes } from "../model/definitions.ts"

let starter!: InstanceType<typeof fhirStarter>

/** Initialises fhirStarter and acquires the first access token. Call once at startup. */
export const startAuth = async (): Promise<void> => {
   starter = new fhirStarter({
      clientId: config.fhirClientId,
      privateKey: config.fhirActiveKey.privateKey,
      tokenEndpointUrl: config.fhirTokenEndpoint,
      scopes: getRequestedScopes(),
      keyId: config.fhirActiveKey.kid,
      ...(config.fhirJwksUrl && { jwksUrl: config.fhirJwksUrl }),
   })
   await starter.start()

   const initialScope = starter.tokenResponse().scope ?? ""
   starter.onRefresh(() => {
      const refreshedScope = starter.tokenResponse().scope ?? ""
      if (refreshedScope !== initialScope)
         console.warn(`🔑 Granted scopes changed after token refresh — registered tools may be stale`)
   })
}

/** Stops the proactive token-refresh loop. Call during graceful shutdown. */
export const stopAuth = (): void => {
   starter?.stop()
}

/** Stops then restarts fhirStarter with the current scopes. Use when definitions change the derived scope set. */
export const restartAuth = async (): Promise<void> => {
   stopAuth()
   await startAuth()
}

/** Returns the getter-backed token response object. Always reflects the current valid token. */
export const getTokenResponse = (): TokenResponse => starter.tokenResponse()
