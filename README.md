# fhirHydrant

A Node.js MCP server written in TypeScript for connecting healthcare AI clients to FHIR APIs.

Authenticates via SMART Backend Services, exposes configurable resource tools
with FHIR Bundle pagination, and supports both Streamable HTTP and stdio
transports.

> **PHI note:** FHIR data returned through MCP tool calls contains PHI. Ensure
> your MCP client's transcript storage meets your compliance requirements.

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

Edit [config/definitions.json](config/definitions.json) to customize the default FHIR resource set. See [Definitions](#definitions).

**From source:** copy `.env.example` to `.env`, fill in values, run `npm run dev`.

## Environment

See [.env.example](.env.example) for all variables.

### Required

| Variable           | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `FHIR_BASE_URL`    | FHIR server base — `/api/FHIR/R4` and `/oauth2/token` are derived from this |
| `FHIR_CLIENT_ID`   | Client ID registered with your FHIR auth server                             |
| `FHIR_PRIVATE_KEY` | Comma-separated PEM file paths — kid derived from filename `private-<kid>.pem`; keep keys outside the repo (`.gitignore` excludes `*.pem`/`*.key`) |
| `FHIR_ACTIVE_KEY`  | Which derived `kid` to use for signing JWT assertions                        |

### Commonly required

| Variable        | Description                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `FHIR_JWKS_URL` | External JWKS URL registered with your FHIR auth server. Omit to enable the built-in `/jwks` endpoint instead (no private material exposed). Behind Azure EasyAuth, add `/jwks` to `excludedPaths`. |

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
| `ALLOWED_HOSTS`           | —                     | Comma-separated hostnames for DNS rebinding protection — set when exposing HTTP on a public network |
| `DEBUG`                   | `false`               | Enable verbose FHIR request logging — **logs URLs that may contain PHI** (patient names, identifiers, dates). Treat all production logs as PHI-sensitive |
| `FHIR_METADATA_MODE`      | `strict`              | `/metadata` mismatch handling: `strict` blocks unadvertised params, `warn` allows with warning, `off` disables checks. Both `strict` and `warn` skip entirely absent resource types |
| `FHIR_DEFAULT_COUNT`      | `20`                  | Default `_count` injected into searches when the resource advertises `_count` in `/metadata` |
| `FHIR_MAX_COUNT`          | `100`                 | Maximum `_count` allowed — higher values from callers are capped to this |
| `FHIR_MAX_RESPONSE_BYTES` | `65536`               | Universal byte-limit on tool responses — returns an error instead of the payload when exceeded |
| `FHIR_AUDIT_SINK`          | —                     | Comma-separated audit sinks: `console`, `file`, or both. Off when unset/empty |
| `FHIR_AUDIT_FILE`          | `./audit.jsonl`       | JSONL audit log path (parent directory must exist) — used when `file` sink is active |
| `FHIR_PAGINATION_PATHS`     | —                     | Comma-separated path prefixes allowed in pagination URLs — the configured FHIR server path is always allowed; add aliases when the server returns next links with a different proxy prefix (e.g. `/FHIRProxy/api/FHIR/R4/`) |
| `FHIR_AUDIT_USER_HEADER`   | —                     | HTTP request header whose value is recorded as `user` in audit events (see [Audit user identity](#audit-user-identity)) |

When both a derived URL and an explicit override are available, the explicit
override takes precedence.

### Audit

fhirHydrant can emit structured, PHI-free audit events for every FHIR operation.
Set `FHIR_AUDIT_SINK` to enable one or both sinks:

- **`console`** — writes `[audit] { … }` JSON lines to stdout (stderr in stdio mode)
- **`file`** — appends JSONL to `FHIR_AUDIT_FILE` (default `./audit.jsonl`)

Each event includes timestamp, tool name, operation type, status, duration,
response size, and pagination metadata — but never FHIR resource content.

#### Audit user identity

When fhirHydrant runs behind an authenticating reverse proxy (Azure EasyAuth,
OAuth2 Proxy, etc.), set `FHIR_AUDIT_USER_HEADER` to the header your proxy
injects with the authenticated user's identity. The header value is recorded as
`user` in every audit event for that request.

Common values:

| Proxy | Header |
| --- | --- |
| Azure EasyAuth | `X-MS-CLIENT-PRINCIPAL-NAME` |
| OAuth2 Proxy | `X-Auth-Request-Email` |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` |

> **Trust boundary:** This header is only meaningful when an upstream proxy
> strips or overwrites it. Do not set this for unauthenticated deployments —
> clients could spoof arbitrary values.

### Response shaping

fhirHydrant shapes search responses to manage token economy and limit PHI exposure:

- **`_count` default/cap** — Injects `FHIR_DEFAULT_COUNT` when omitted, caps to
  `FHIR_MAX_COUNT`. Behavior follows `FHIR_METADATA_MODE`: `strict` only
  touches resources that advertise `_count`; `warn` injects with a warning;
  `off` applies to all searches. Direct reads and pagination are exempt.

- **Byte limit with auto-retry** — `FHIR_MAX_RESPONSE_BYTES` caps every tool
  response. When a search Bundle exceeds the limit, the server automatically
  retries with `_count` halved (repeatedly, down to `_count=1`). If even a
  single entry exceeds the limit, the original "too large" error is returned.
  Auto-retry applies only to search Bundles — direct reads and pagination are
  exempt. A note is prepended when a retry succeeds (e.g. `_count` reduced
  from 20 to 5).

- **FHIRPath response filtering** — The optional `fhirpath` parameter accepts a
  standard [FHIRPath](http://hl7.org/fhirpath/) expression that is evaluated
  locally against the FHIR response after it arrives from the server. Matching
  nodes are returned as a JSON array. Use this for client-side projection when
  `_elements` or `_summary` are unavailable or insufficient. The expression
  never reaches the FHIR server. If evaluation fails, the raw response is
  withheld to respect the caller's filter intent. The `fhirpath` parameter is
  also available on the `paginate` tool. Powered by HL7's
  [`fhirpath`](https://github.com/nicktobey/fhirpath.js) reference
  implementation with the R4 model context for full choice-type resolution.

## Customization

Everything in `config/` is yours to edit — no source changes needed:

| File | Purpose |
|---|---|
| [`definitions.json`](config/definitions.json) | FHIR resource → MCP tool mappings, search params, and search-control descriptions (see [Definitions](#definitions) below) |
| [`instructions.md`](config/instructions.md) | System prompt sent to the AI client — controls how the model uses FHIR tools |
| [`messages.json`](config/messages.json) | Every user-facing message, error, and note the server can return |
| [`core-tools.json`](config/core-tools.json) | Built-in tool definitions (`paginate`, `capabilities`) — descriptions and param hints |

Changes take effect on restart. In development, `definitions.json` also
hot-reloads (see [Hot-reload](#hot-reload-dev-mode)).

## Definitions

fhirHydrant uses [config/definitions.json](config/definitions.json) to map FHIR
resource types to MCP tools. Edit that file directly when customizing resources.

### Definitions schema

[config/definitions.json](config/definitions.json) is an object with two top-level keys:

| Key                    | Type                     | Description                                                                                          |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `searchControls`  | `Record<string, string>` | User-editable descriptions for FHIR search-control parameters and local response controls. Server-side controls (`_count`, `_sort`, `_summary`, `_elements`, `_include`, `_revinclude`) are injected into a tool's schema only when the FHIR server's `/metadata` advertises them. Local controls (`fhirpath`) are always injected regardless of metadata. Omit a key to suppress injection. |
| `resources`            | `array`                  | Array of resource definitions (see below)                                                            |

#### Resource entry fields

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
Use a reverse proxy to terminate TLS when exposing HTTP beyond localhost.
`GET /health` returns `{"status":"ok"}` for liveness probes (no auth, no PHI).

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
See the [Quick start](#quick-start) JSON block for a full stdio config example.

Prefer stdio for local desktop clients, HTTP for remote/networked clients.

## Tools

### Resource tools

Defined in [config/definitions.json](config/definitions.json). The default set:

| Tool          | Resource    | Direct read |
| ------------- | ----------- | ----------- |
| `patient`     | Patient     | Yes         |
| `observation` | Observation | Yes         |
| `condition`   | Condition   | Yes         |
| `encounter`   | Encounter   | Yes         |

### Built-in tools

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `paginate`        | Fetch a single page of FHIR Bundle results using a pagination URL (validated against the FHIR server origin) |
| `capabilities`    | Return the cached FHIR server CapabilityStatement summary, including which resource types and search parameters are advertised, and which tools were skipped due to metadata mismatches |

Search results are FHIR Bundles that may include pagination links. When a Bundle
contains a `link` with `relation: "next"`, call `paginate` with that
link's `url` to fetch the next page. Repeat until no `next` link is present.

## Dev

```sh
npm run dev
```

Watches `ts/server.ts` with native Node TS stripping. Definitions are watched
live — see [Hot-reload](#hot-reload-dev-mode).

## Build & run

```sh
npm run build
npm start
```

Output goes to `bin/server.js`.
