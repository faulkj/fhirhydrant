# Deployment Examples

Each folder is a standalone deployment example with its own Dockerfile that
installs fhirHydrant from npm. Pass your SMART Backend Services credentials as
environment variables at runtime — never bake secrets into the image.

## Examples

### [azure-app-service](azure-app-service/)

Azure App Service via `az webapp create` with a custom container. Good when you
want deployment slots, built-in auth, or VNet integration. Uses port 8080
(Azure default). Overrides `search-controls.json` with trimmed descriptions.

### [azure-container-app](azure-container-app/)

Azure Container Apps via `az containerapp up --source .`. Azure builds the
image, provides HTTPS and a public URL, and scales to zero when idle. Uses port
8080 (Azure default). Overrides `instructions/manifest.json` with a custom
fragment list, replacing the default composed instructions.

### [compose](compose/)

Docker Compose with a `.env` file. Copy `.env.example` to `.env`, fill in your
values, then `docker compose up --build`. Good for local development or
single-server deployments. Replaces the `resources/` folder with a minimal
catalog — its Dockerfile wipes the packaged `config/resources/` before copying,
since the additive `COPY` alone would leave the default resource files in place.

### [kubernetes](kubernetes/)

Kubernetes Deployment + Service manifests. Build and push the image to your
registry, create a Secret with your SMART credentials, then `kubectl apply`.
Uses liveness and readiness probes against `/health`. Overrides
`core-tools.json` with simplified tool descriptions.

### [reverse-proxy](reverse-proxy/)

Compose + Caddy for automatic HTTPS. Caddy handles TLS certificates so the
FHIR server can reach `/jwks` over a public HTTPS URL without extra setup.
Update the `Caddyfile` with your domain, copy `.env.example` to `.env`, then
`docker compose up --build`. Overrides `operations.json` with a trimmed catalog.

## Custom Config

fhirHydrant ships with default config files for resources, operations, search
controls, instructions, and messages. You can override any of them by placing
your version in the example's `config/` folder — the Dockerfile copies it over
the package defaults at build time.

Each example demonstrates a different override. Add only the files you want to
change - anything not overridden keeps the package default.
