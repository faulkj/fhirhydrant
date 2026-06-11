# fhirHydrant

An MCP server for connecting AI clients to FHIR APIs.

Authenticates via SMART Backend Services, exposes configurable resource tools
with FHIR Bundle pagination, and supports both Streamable HTTP and stdio
transports.

## Requirements

- Node.js ≥ 24
- A FHIR R4 server with SMART Backend Services (client credentials) support
- An RSA-2048 private key (JWKS can be self-hosted via the built-in `/jwks` endpoint or externally)

## Install

### npm / npx (recommended)

```sh
npm install -g fhirhydrant
# or run directly:
npx fhirhydrant
```

### From source

```sh
git clone https://github.com/faulkj/fhirhydrant.git
cd fhirhydrant
npm install
npm run build
```

## Quick start

The fastest way to get running with a desktop MCP client (Copilot, Claude, Cursor, etc.):

**1. Get your credentials**

- A FHIR R4 server URL, client ID, and RSA-2048 private key registered for SMART Backend Services
- A publicly hosted JWKS — use the built-in `/jwks` endpoint (omit `FHIR_JWKS_URL`) or host one externally (e.g. a GitHub Gist)

**2. Add to your MCP client config**

```json
{
   "mcpServers": {
      "fhirhydrant": {
         "command": "npx",
         "args": ["-y", "fhirhydrant"],
         "env": {
            "MCP_TRANSPORT": "stdio",
            "FHIR_BASE_URL": "https://fhir.example.org",
            "FHIR_CLIENT_ID": "your-client-id",
            "FHIR_PRIVATE_KEY": "private-20260610.pem",
            "FHIR_ACTIVE_KEY": "20260610",
            "FHIR_JWKS_URL": "https://example.org/.well-known/jwks.json"
         }
      }
   }
}
```

`FHIR_PRIVATE_KEY` is a comma-separated list of PEM file paths. The `kid` for each key is derived from its filename: `private-<kid>.pem`. Place PEM files in the directory you run your MCP client from, or use absolute paths.

**3. Customize resources** *(optional)*

Drop a `definitions.json` in your working directory to override the default FHIR resource set. See [Definitions](#definitions).



Generate a private key if you don't have one:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
```

Host the corresponding public JWKS somewhere reachable by your FHIR auth server
(e.g. a GitHub Gist), and register it along with your `FHIR_CLIENT_ID`.

**From source:** copy `.env.example` to `.env` and fill in your values — `npm run dev` loads it automatically.

**npm / npx (HTTP mode):** set env vars in your shell or process manager before running.

**stdio mode:** pass env vars via the MCP client config's `env` block (see [Stdio](#stdio) below).

## Environment

See [.env.example](.env.example) for all variables.

### Required

| Variable           | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `FHIR_BASE_URL`    | FHIR server base — `/api/FHIR/R4` and `/oauth2/token` are derived from this |
| `FHIR_CLIENT_ID`   | Client ID registered with your FHIR auth server                             |
| `FHIR_PRIVATE_KEY` | Comma-separated PEM file paths — kid derived from filename `private-<kid>.pem` |
| `FHIR_ACTIVE_KEY`  | Which derived `kid` to use for signing JWT assertions                        |

### Commonly required

| Variable        | Description                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `FHIR_JWKS_URL` | External JWKS URL registered with your FHIR auth server. Omit to enable the built-in `/jwks` endpoint instead. |

### Key rotation

`FHIR_PRIVATE_KEY` lists all private keys the app knows about.
`FHIR_ACTIVE_KEY` selects which one signs JWT assertions. The built-in `/jwks`
endpoint (or your externally hosted JWKS) should contain public keys for all
listed PEM files so the FHIR auth server can verify any of them by `kid`.
To rotate:

1. Generate a new key: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private-20260715.pem`
2. Add the new PEM to `FHIR_PRIVATE_KEY`: `private-20260610.pem,private-20260715.pem`
3. Redeploy — the `/jwks` endpoint automatically includes all keys
4. Set `FHIR_ACTIVE_KEY=20260715` and redeploy
5. After auth-server caches expire and old deployments are retired, remove the
   old PEM from `FHIR_PRIVATE_KEY`

> If using an external JWKS (`FHIR_JWKS_URL`), manually add the new public key
> to that JWKS before step 3.

### Optional

| Variable                  | Default               | Description                                                       |
| ------------------------- | --------------------- | ----------------------------------------------------------------- |
| `FHIR_SERVER_URL`         | `<base>/api/FHIR/R4`  | Override the derived FHIR API URL for non-standard server layouts |
| `FHIR_TOKEN_URL`          | `<base>/oauth2/token` | Override the derived token endpoint URL                           |
| `MCP_TRANSPORT`           | `http`                | `http` for Streamable HTTP, `stdio` for stdio                     |
| `PORT`                    | `5000`                | HTTP listener port (1–65535)                                      |
| `BIND_HOST`               | `127.0.0.1`           | Bind address for HTTP listener — set to `0.0.0.0` for container/LAN access |
| `ALLOWED_HOSTS`           | —                     | Comma-separated hostnames for DNS rebinding protection            |
| `DEBUG`                   | `false`               | Enable verbose FHIR request logging (**may log PHI** — see below) |
| `FHIR_METADATA_MODE`      | `strict`              | How to handle `/metadata` mismatches: `strict` blocks calls to unadvertised params; `warn` logs warnings but allows calls with unadvertised params; both modes skip tools whose resource type is entirely absent from `/metadata`; `off` disables all metadata checks |

When both a derived URL and an explicit override are available, the explicit
override takes precedence.

## Definitions

fhirHydrant uses a `definitions.json` file to map FHIR resource types to MCP
tools. The resolution order is:

1. `./definitions.json` in the current working directory (if it exists)
2. Packaged default definitions

Edit `definitions.json` directly when customizing resources.

### Definitions schema

| Field                | Type                     | Description                                                                                     |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `resourceType`       | `string`                 | FHIR resource type (e.g. `AllergyIntolerance`)                                                  |
| `toolName`           | `string`                 | MCP tool name — must be unique across all entries                                               |
| `description`        | `string`                 | Human-readable tool description shown to the AI client                                          |
| `supportsDirectRead` | `boolean`                | Enable `/ResourceType/{id}` reads when `_id` is provided alone                                  |
| `searchParams`       | `Record<string, string>` | Key = FHIR search param, value = parameter description (optional if supportsDirectRead is true) |
| `requireOneOf`       | `string[]` (optional)    | At least one of these search params must be provided for non-direct-read calls |

### Direct read behavior

When `supportsDirectRead` is `true` and the caller supplies `_id` as the
**only** non-empty argument, fhirHydrant performs a direct
`GET /ResourceType/{id}` read instead of a search. If `_id` is combined with
other parameters, a search is performed so intent is not silently discarded.

If `supportsDirectRead` is `true` but `_id` is not listed in `searchParams`, it
is auto-injected into the tool's input schema.

### Hot-reload (dev mode)

In development (`NODE_ENV` is not `production`), fhirHydrant watches the active
definitions file for changes:

- Invalid JSON keeps the last valid snapshot
- When scopes change, auth restarts automatically
- Behavioral changes (`requireOneOf`, `supportsDirectRead`, `searchParams`) are
  picked up live on the next tool call
- Adding or removing tools, or changing tool names or param names visible to the
  MCP client, requires a server restart — those are baked into MCP tool
  registration at startup

In production, definitions are read once at startup.

### Safe onboarding checklist

1. Update `definitions.json` with your resources
2. Confirm generated SMART scopes match your intended access
3. Update/re-register your backend client with the FHIR authorization server if
   required scopes changed
4. Test with least-privilege access
5. Deploy

### Limitations

- All `searchParams` values are string-only — no type enforcement or enums
- `requireOneOf` enforces "at least one of" — it does not cover complex
  conditional requirements or exact-one-of constraints
- No full FHIR capability negotiation — `searchParams` are tool input hints, not
  a FHIR capability model
- Vendor-specific search rules may still apply

## Transport

### HTTP (default)

Stateless Streamable HTTP — no session management required.

```
POST http://localhost:5000/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
```

MCP client config:

```json
{
   "mcpServers": {
      "fhirhydrant": {
         "url": "http://localhost:5000/mcp"
      }
   }
}
```

### Stdio

Set `MCP_TRANSPORT=stdio` to use stdio transport. In stdio mode, stdout is
reserved for the MCP protocol — all logging is redirected to stderr.

MCP client config:

```json
{
   "mcpServers": {
      "fhirhydrant": {
         "command": "npx",
         "args": ["fhirhydrant"],
         "env": {
            "MCP_TRANSPORT": "stdio",
            "FHIR_BASE_URL": "https://fhir.example.org",
            "FHIR_CLIENT_ID": "your-client-id",
            "FHIR_PRIVATE_KEY": "private-20260610.pem",
            "FHIR_ACTIVE_KEY": "20260610",
            "FHIR_JWKS_URL": "https://example.org/.well-known/jwks.json"
         }
      }
   }
}
```

Prefer stdio for local desktop clients, HTTP for remote/networked clients.

## Tools

### Resource tools

Defined in [definitions.json](definitions.json). The default set:

| Tool          | Resource    | Direct read |
| ------------- | ----------- | ----------- |
| `patient`     | Patient     | Yes         |
| `observation` | Observation | Yes         |
| `condition`   | Condition   | Yes         |
| `encounter`   | Encounter   | Yes         |

### Built-in tools

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `paginate`        | Fetch a single page of FHIR Bundle results using a pagination URL |
| `capabilities`    | Return the cached FHIR server CapabilityStatement summary, including which resource types and search parameters are advertised, and which tools were skipped due to metadata mismatches |

Search results are FHIR Bundles that may include pagination links. When a Bundle
contains a `link` with `relation: "next"`, call `paginate` with that
link's `url` to fetch the next page. Repeat until no `next` link is present.

## Dev

```sh
npm run dev
```

Watches `ts/server.ts` with native Node TS stripping. The active definitions
file is watched live — behavioral changes (`requireOneOf`, `supportsDirectRead`,
`searchParams`) take effect on the next tool call; scope changes restart auth
automatically. Adding or removing tools requires a restart.

## Build & run

```sh
npm run build
npm start
```

Output goes to `bin/server.js`.

## Security notes

- **TLS:** Use a reverse proxy (nginx, Caddy) to terminate TLS for HTTP mode
- **ALLOWED_HOSTS:** Set this when exposing HTTP mode on a public network
- **Private keys:** Keep keys outside the package/project repo — `.gitignore`
  already excludes `*.pem` and `*.key`
- **PHI in logs:** Default logging does not include FHIR query parameters.
  Setting `DEBUG=true` enables verbose URLs which **may contain
  PHI** (patient names, identifiers, dates). Treat all logs as PHI-sensitive in
  production environments.
- **Pagination URL validation:** The `paginate` tool validates that URLs
   match the configured FHIR server origin before fetching.
- **PHI in tool responses:** FHIR resource data returned through MCP tool calls
  contains PHI. Ensure your MCP client’s transcript storage and retention
  policies meet your compliance requirements.
- **Health endpoint:** `GET /health` returns `{"status":"ok"}` for liveness
  probes. No authentication, no PHI.
- **JWKS endpoint:** `GET /jwks` serves public keys derived from
  `FHIR_PRIVATE_KEY` when `FHIR_JWKS_URL` is not set. No private key material
  is exposed. When deploying behind Azure Container Apps EasyAuth, add `/jwks`
  to the `excludedPaths` list so the FHIR authorization server can fetch it
  unauthenticated.
