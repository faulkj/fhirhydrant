# fhirHydrant

An MCP server for connecting AI clients to FHIR APIs.

Authenticates via SMART Backend Services, exposes configurable resource tools
with FHIR Bundle pagination, and supports both Streamable HTTP and stdio
transports.

## Requirements

- Node.js ≥ 24
- A FHIR R4 server with SMART Backend Services (client credentials) support
- An RSA-2048 private key and a publicly hosted JWKS

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

### Docker

```sh
docker build -t fhirhydrant .
docker run \
   -v /host/path/key.pem:/run/secrets/fhir-key.pem:ro \
   -e FHIR_BASE_URL=https://fhir.example.org \
   -e FHIR_CLIENT_ID=your-client-id \
   -e FHIR_PRIVATE_KEY=/run/secrets/fhir-key.pem \
   -p 5000:5000 \
   fhirhydrant
```

> **Docker key mounting:** `FHIR_PRIVATE_KEY=./private.pem` will not resolve
> inside the container. Mount the key file and use the container path as shown.

## Setup

Copy the example env file and fill in your values:

**Unix / macOS:**

```sh
cp .env.example .env
```

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

Generate a private key if you don't have one:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private-1.pem
```

Host the corresponding public JWKS somewhere reachable by your FHIR auth server
(e.g. a GitHub Gist), and register it along with your `FHIR_CLIENT_ID`.

## Environment

See [.env.example](.env.example) for all variables.

### Required

| Variable           | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `FHIR_BASE_URL`    | FHIR server base — `/api/FHIR/R4` and `/oauth2/token` are derived from this |
| `FHIR_CLIENT_ID`   | Client ID registered with your FHIR auth server                             |
| `FHIR_PRIVATE_KEY` | Path to your RSA private key PEM file (relative to cwd or absolute)         |

### Commonly required

| Variable        | Description                                           |
| --------------- | ----------------------------------------------------- |
| `FHIR_JWKS_URL` | Public JWKS URL registered with your FHIR auth server |
| `FHIR_KEY_ID`   | `kid` value in your JWKS matching the private key     |

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
- New tools are available on the next MCP request

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
            "FHIR_PRIVATE_KEY": "/path/to/private-1.pem",
            "FHIR_JWKS_URL": "https://example.org/.well-known/jwks.json",
            "FHIR_KEY_ID": "key-1"
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
| `fhir_fetch_page` | Fetch a single page of FHIR Bundle results using a pagination URL |

Search results are FHIR Bundles that may include pagination links. When a Bundle
contains a `link` with `relation: "next"`, call `fhir_fetch_page` with that
link's `url` to fetch the next page. Repeat until no `next` link is present.

## Dev

```sh
npm run dev
```

Watches `ts/server.ts` with native Node TS stripping. Edits to the active
definitions file are picked up live without restart; if scopes change, auth
restarts automatically.

## Build & run

```sh
npm run build
npm start
```

Output goes to `.out/server.js`.

## Security notes

- **TLS:** Use a reverse proxy (nginx, Caddy) to terminate TLS for HTTP mode
- **ALLOWED_HOSTS:** Set this when exposing HTTP mode on a public network
- **Private keys:** Keep keys outside the package/project repo — `.gitignore`
  already excludes `*.pem` and `*.key`
- **PHI in logs:** Default logging does not include FHIR query parameters.
  Setting `DEBUG=true` enables verbose URLs which **may contain
  PHI** (patient names, identifiers, dates). Treat all logs as PHI-sensitive in
  production environments.
- **Stdio vs HTTP:** Prefer stdio for local desktop clients where the MCP host
  manages the process lifecycle. Use HTTP for remote/networked clients behind
  TLS.
- **Pagination URL validation:** The `fhir_fetch_page` tool validates that URLs
   match the configured FHIR server origin before fetching.
- **PHI in tool responses:** FHIR resource data returned through MCP tool calls
  contains PHI. Ensure your MCP client’s transcript storage and retention
  policies meet your compliance requirements.
- **Health endpoint:** `GET /health` returns `{"status":"ok"}` for liveness
  probes. No authentication, no PHI.
