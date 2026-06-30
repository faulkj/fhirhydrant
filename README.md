# fhirHydrant

A modern, fully configurable, open-source Node.js MCP server for R4+ FHIR APIs. It
connects MCP-compatible clients to clinical data over SMART on FHIR v2 Backend
Services using signed JWT client credentials.

fhirHydrant turns FHIR resources, named operations, terminology lookups, and
pagination into MCP tools. The default resources and operations are starting
points: resources, operations, search controls, instructions, and messages can
be expanded, trimmed, or replaced through config files without source changes.

- SMART Backend Services auth with JWKS hosting, key rotation, token refresh,
  and dynamic scopes
- Configurable resource tools for search, direct read, vread, history, and
  optional metadata-gated CRUD
- Config-driven named operations for clinical data, terminology, IPS, patient
  matching, validation, and custom workflows
- CapabilityStatement-aware tools, search controls, operation gating, and
  runtime scope checks
- Token economy features: compact responses, FHIRPath filtering, byte limits,
  `_count` shaping, and oversized Bundle retry
- Optional terminology tools, PHI-free audit events, and stdio or Streamable
  HTTP transport

> **Note:** FHIR data returned through MCP tool calls may contain PHI.
> Make sure your MCP client's transcript storage and logging behavior match
> your compliance requirements.

## Contents

- [Quick Start](#quick-start)
- [Tools](#tools)
- [Metadata And Scope Gating](#metadata-and-scope-gating)
- [Token Economy And Response Shaping](#token-economy-and-response-shaping)
- [Audit Events](#audit-events)
- [SMART Backend Auth And Keys](#smart-backend-auth-and-keys)
- [Environment Variables](#environment-variables)
- [FHIR Version Support](#fhir-version-support)
- [Customizing Tools And Messages](#customizing-tools-and-messages)
- [Transports](#transports)
- [Deployment Examples](#deployment-examples)
- [Development](#development)

## Quick Start

### Requirements

- Node.js >= 24
- A supported FHIR server with SMART Backend Services support
- A SMART Backend Services client registration
- An RSA-2048 private key whose public key is available through JWKS

The stdio transport usually needs an externally hosted JWKS URL. The built-in
`/jwks` endpoint is available only when fhirHydrant runs over HTTP.

### Install

```sh
# install globally
npm install -g fhirhydrant

# or run without installing
npx fhirhydrant
```

Run from source:

```sh
git clone https://github.com/faulkj/fhirhydrant.git
cd fhirhydrant
npm install
npm run build
```

### MCP Client Config

For desktop MCP clients, stdio is usually the simplest transport:

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
            "FHIR_ACTIVE_KEY": "LS0tLS1CRUdJTi...base64-of-your-pem...",
            "FHIR_JWKS_URL": "https://example.org/.well-known/jwks.json"
         }
      }
   }
}
```

`FHIR_ACTIVE_KEY` is your RSA PKCS#8 private key, base64-encoded. The `kid` is
derived automatically at startup via a truncated JWK Thumbprint and logged to
the console.

## Tools

fhirHydrant registers tools from configuration and runtime capability checks.
The exact list depends on `config/resources.json`, granted SMART scopes,
`/metadata`, write settings, operation settings, and terminology settings.

| Tool or family | Available when | Purpose |
| --- | --- | --- |
| Resource tools | Resource is configured and allowed by metadata/scopes | Search, direct-read, vread, history, and optionally CRUD FHIR resources |
| `system_history` | Server advertises system `history` interaction and scopes allow it | Retrieve system-level change history across all resource types |
| `capabilities` | Always registered | Inspect CapabilityStatement summary, registered tools, skipped tools, search params, operations, and metadata notes |
| `paginate` | Always registered | Fetch the next page of a FHIR Bundle using a server-returned `next` URL |
| `operate` | At least one named operation passes gating | Invoke configured FHIR named operations for clinical data, terminology, IPS, matching, validation, or custom workflows |
| `bundle` | `FHIR_BUNDLE_CAPABILITIES` is set | Submit a FHIR batch or transaction Bundle; writes require additional opt-in |
| `terminology_lookup` | `FHIR_TERMINOLOGY_BASE_URL` is set | Look up one LOINC or SNOMED CT code |
| `code_search` | `FHIR_TERMINOLOGY_BASE_URL` is set | Search LOINC or SNOMED CT codes by text |

### Resource Tools

Resource tools are generated from [config/resources.json](config/resources.json).
The shipped config covers common clinical, administrative, medication,
practitioner, organization, and document resources. You can expand, trim, or
replace the resource set without source changes.

Each resource tool supports configured search params, optional direct reads
with `_id`, `fhirpath`, and, unless compact-locked, `responseMode`. Direct read
only happens when `_id` is the only non-empty argument; `_id` plus other params
stays a search so caller intent is not silently discarded.

Resource tools are search/read by default. Set `FHIR_WRITE_CAPABILITIES` to
enable metadata-gated CRUD actions:

```sh
FHIR_WRITE_CAPABILITIES=create,update,patch,delete
```

| Action | Required params | FHIR call |
| --- | --- | --- |
| `vread` | `_id`, `_vid` | `GET /ResourceType/{id}/_history/{vid}` |
| `history` | `_id` (instance) or none (type) | `GET /ResourceType/{id}/_history` or `GET /ResourceType/_history` |
| `create` | `body` | `POST /ResourceType` |
| `update` | `_id`, `body` | `PUT /ResourceType/{id}` |
| `patch` | `_id`, `body` | `PATCH /ResourceType/{id}` with JSON Patch |
| `delete` | `_id` | `DELETE /ResourceType/{id}` |

`vread` is available when the resource has `supportsDirectRead` and the server
advertises the `vread` interaction. `history` is available when the server
advertises `history-instance` or `history-type`. Both require the SMART `r`
permission. Optional `_since` and `_at` parameters filter history results.
History responses are Bundles and support compact mode, FHIRPath, and
coalescing.

Write bodies are validated before the FHIR call: `body.resourceType` must match
the tool resource, `body.id` must match `_id` for update when present, and patch
requires a JSON Patch array. Scopes are derived from enabled capabilities:
read/search uses `system/Patient.rs`, create/read/search uses
`system/Patient.crs`, and full write support uses `system/Patient.cruds`.
SMART v2 has no separate patch letter, so patch maps to `u`.

### Core Tools

`capabilities` returns the cached CapabilityStatement summary, registered and
skipped tools, search params, operations, and metadata notes. 

`paginate` fetches one Bundle page using a server-returned `next` URL validated 
against the FHIR origin and allowed path prefixes. When compact mode is active
and the fetched page has more results, paginate automatically coalesces
multiple upstream pages into one compact response (same behavior as resource
search tools). Pass `prefetch=false` to disable coalescing and get a single
page.

### Named Operations

The `operate` tool invokes FHIR named operations from `config/operations.json`.
The shipped operation catalog covers clinical aggregation, validation, document
lookup, terminology operations, IPS generation, and patient matching. You can
expand, trim, replace, or disable the operation catalog without source changes.

### Terminology Tools

Set `FHIR_TERMINOLOGY_BASE_URL` to enable:

| Tool | Description |
| --- | --- |
| `terminology_lookup` | Looks up one LOINC or SNOMED CT code |
| `code_search` | Searches codes by text filter with paging support |

These tools call the configured terminology server directly. They do not use
the clinical FHIR server credentials. Use a terminology endpoint that matches
your selected FHIR release, such as `https://tx.fhir.org/r4`.

### Bundle Execution

Set `FHIR_BUNDLE_CAPABILITIES=batch` (or `batch,transaction`) to enable
`bundle`. This tool submits a FHIR batch or transaction Bundle and
returns the server's response through the standard response pipeline.

**Safety model:**
- Read-only batch Bundles (all GET entries) are allowed with just
  `FHIR_BUNDLE_CAPABILITIES=batch`.
- Write entries (POST, PUT, PATCH, DELETE) additionally require
  `FHIR_BUNDLE_WRITES_ENABLED=true` and the corresponding action in
  `FHIR_WRITE_CAPABILITIES`.
- Transaction Bundles require explicit `FHIR_BUNDLE_CAPABILITIES=transaction`.
- Every entry is preflighted against configured resources, SMART scopes, and
  metadata interactions. If any single entry fails, the entire Bundle is
  rejected before submission.

**V1 exclusions:** Conditional requests, system-level `_history`, absolute URLs,
and `$operation` URLs inside Bundle entries are not supported.

**History in Bundles:** `vread` (`Resource/id/_history/vid`), instance history
(`Resource/id/_history`), and type history (`Resource/_history`) entries are
allowed in Bundles when the server advertises the corresponding interaction and
scopes permit it. These count as read entries.

## Metadata And Scope Gating

Unless `FHIR_METADATA_MODE=off`, fhirHydrant fetches the FHIR server's
CapabilityStatement at startup. In `strict` mode:

- Resource tools are registered only when the resource type is present in
  `/metadata`
- Server-side search controls such as `_count`, `_sort`, `_summary`,
  `_elements`, `_include`, and `_revinclude` are exposed only when advertised
- Search params are blocked when the server does not advertise them
- Write actions require both `FHIR_WRITE_CAPABILITIES` and matching
  CapabilityStatement interactions
- Named operations require the target resource type to exist, the granted
  SMART scope to allow the resource, and the operation itself to be advertised
  in the resource's CapabilityStatement entry

In `warn` mode, unadvertised params are allowed with a warning, but absent
resource types are still skipped. SMART scopes are also checked at runtime, so a
tool can exist in the schema and still be blocked by the granted token scope.

## Token Economy And Response Shaping

FHIR responses are often much larger than an MCP client needs. fhirHydrant
shapes responses for token economy after retrieval, using server-side controls
when the FHIR server advertises them.

| Feature | Behavior |
| --- | --- |
| `_count` default/cap | No `_count` injected by default (server decides page size). Set `FHIR_DEFAULT_COUNT` to inject one; `FHIR_MAX_COUNT` caps explicit caller values (0 = no cap) |
| Page coalescing | When compact mode is active, the server fetches multiple upstream pages sequentially, compacts each immediately, and returns one consolidated Bundle. Controlled by `maxResults`, `prefetch`, and `FHIR_PREFETCH_*` env vars |
| Byte limit | `FHIR_MAX_RESPONSE_BYTES` limits every tool response; oversized Bundles are chunked transparently |
| Auto-retry | Oversized search Bundles attempt local chunking first, then retry with smaller `_count` as a fallback |
| FHIRPath | `fhirpath` filters the returned FHIR JSON locally and returns matching nodes as an array |
| Compact mode | `responseMode=compact` strips common FHIR envelope noise and simplifies datatypes |
| Full mode | `responseMode=full` returns raw FHIR JSON |
| Locked compact | `FHIR_RESPONSE_MODE=compact-locked` hides `responseMode` from the tool schema |

Compact output is AI-oriented JSON, not canonical FHIR. It drops or simplifies
FHIR noise and common datatypes such as `meta`, narrative, extensions,
`CodeableConcept`, `Reference`, `Quantity`, and newer datatypes such as
`CodeableReference`.
FHIRPath runs locally; the FHIR server never sees the expression. If evaluation
fails, the raw response is withheld and an error is returned.

### Page Coalescing

When compact mode is active for a search (resource tools or paginate), the
server fetches multiple upstream FHIR pages sequentially, compacts each page
immediately, and returns one consolidated compact Bundle. This reduces MCP
round-trips from many "next page" calls down to one.

- `maxResults` sets a target — the server stops fetching once this threshold
  is crossed (may slightly exceed since whole pages are appended)
- `prefetch=false` disables coalescing for one call
- `_count` still controls the upstream FHIR page size
- Coalescing stops at configurable page, entry, byte, and time limits
- The Bundle's `link[next]` URL points to where the server stopped; call
  `paginate` with `responseMode=compact` to continue
- FHIRPath-filtered requests stay single-page (no coalescing)
- `responseMode=full` always returns a single upstream page

## Audit Events

Set `FHIR_AUDIT_SINK` to any combination of `console`, `file`, and `http`.

The `http` sink POSTs each audit event to an external collector, SIEM, or FHIR
audit repository (not the FHIR server itself). Set `FHIR_AUDIT_HTTP_URL` to the
destination and `FHIR_AUDIT_HTTP_FORMAT` to either `raw` (the internal
PHI-light audit JSON, for generic collectors such as Splunk HEC or Datadog) or
`fhir-auditevent` (a minimal FHIR R4 `AuditEvent` resource, suitable for
ATNA-style and FHIR-native audit repositories). The `fhir-auditevent` mapping is
intentionally lightweight — it is not a full ATNA/BALP compliance profile. An
optional `FHIR_AUDIT_HTTP_AUTH` value is sent verbatim as the `Authorization`
header. Delivery is fire-and-forget with a 5s timeout; transport failures are
logged and never affect tool responses.

Audit events include timestamp, tool, resource type when applicable, operation,
status, duration, response size, pagination summary, request ID, and optional
proxy-authenticated user. They do not include FHIR resource content by default.

When running behind an authenticating proxy, set `FHIR_AUDIT_USER_HEADER` to
the trusted identity header injected by that proxy:

Common headers: Azure EasyAuth `X-MS-CLIENT-PRINCIPAL-NAME`, OAuth2 Proxy
`X-Auth-Request-Email`, Cloudflare Access
`Cf-Access-Authenticated-User-Email`.

Only use this when the proxy strips or overwrites inbound copies of that
header. Otherwise clients can spoof arbitrary audit users.

## SMART Backend Auth And Keys

fhirHydrant uses SMART Backend Services: client credentials plus a signed JWT
assertion. This is backend FHIR access, not browser-based SMART standalone
launch; there is no interactive redirect/login flow in the MCP path.

`FHIR_ACTIVE_KEY` holds the raw RSA PKCS#8 signing key. In HTTP mode, the
built-in `/jwks` endpoint exposes public keys for the active key plus any
retired keys when `FHIR_JWKS_URL` is unset. The `kid` for each key is derived
automatically via a truncated RFC 7638 JWK Thumbprint (first 12 base64url chars
of SHA-256 over canonical RSA public JWK members) and logged at startup.

Key rotation workflow:
1. Generate a new RSA key.
2. Add the new PEM to `FHIR_RETIRED_KEYS` and redeploy so JWKS includes both.
3. Register the new kid (logged at startup) with your auth server.
4. Move the new PEM to `FHIR_ACTIVE_KEY` and move the old PEM to
   `FHIR_RETIRED_KEYS`. Redeploy.
5. After auth-server caches expire, remove the old key from `FHIR_RETIRED_KEYS`.

If using external JWKS, publish the new public key before switching
`FHIR_ACTIVE_KEY`.

## Environment Variables

See [.env.example](.env.example) for a complete sample.

### Required

| Variable | Description |
| --- | --- |
| `FHIR_BASE_URL` | Base URL used to derive the FHIR server URL and token URL |
| `FHIR_CLIENT_ID` | SMART Backend Services client ID |
| `FHIR_ACTIVE_KEY` | Base64-encoded RSA PKCS#8 PEM signing key |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `FHIR_RETIRED_KEYS` | unset | Comma-separated base64-encoded PEMs for JWKS rotation |
| `FHIR_VERSION` | `R4` | Active R4+ FHIR release; controls derived URL, FHIRPath model, and compact model metadata |
| `FHIR_SERVER_URL` | `<base>/api/FHIR/<FHIR_VERSION>` | Explicit FHIR API URL override |
| `FHIR_TOKEN_URL` | `<base>/oauth2/token` | Explicit token endpoint override |
| `FHIR_JWKS_URL` | unset | External JWKS URL. Omit in HTTP mode to enable built-in `/jwks` |
| `MCP_TRANSPORT` | `http` | `http` or `stdio` |
| `PORT` | `5000` | HTTP listener port |
| `BIND_HOST` | `0.0.0.0` (or `127.0.0.1` with `--dev` flag) | HTTP bind address |
| `ALLOWED_HOSTS` | unset | Comma-separated hostnames for DNS rebinding protection |
| `FHIR_METADATA_MODE` | `strict` | `strict`, `warn`, or `off` for `/metadata` validation |
| `FHIR_DEFAULT_COUNT` | `0` | Default `_count` injected into searches when allowed; 0 = server decides |
| `FHIR_MAX_COUNT` | `0` | Cap on explicit caller `_count` values; 0 = no cap |
| `FHIR_MAX_RESPONSE_BYTES` | `262144` | Byte limit for tool responses; oversized Bundles are chunked |
| `FHIR_REQUEST_TIMEOUT_MS` | `30000` | Per-attempt timeout for outgoing FHIR requests |
| `MCP_JSON_LIMIT` | `4mb` | Max accepted MCP request body size (Express json limit string); raise if large write/bundle payloads are rejected |
| `FHIR_RESPONSE_MODE` | unset | `compact`, `full`, or `compact-locked`; unset means search defaults compact and direct reads default full |
| `FHIR_WRITE_CAPABILITIES` | unset | Comma-separated write actions: `create`, `update`, `patch`, `delete` |
| `FHIR_VALIDATE_WRITES` | `local` | `off`, `local` (client-side structural checks), or `server` (local + server `$validate` preflight for create/update) |
| `FHIR_WRITE_DRY_RUN` | `false` | Set to `true` to validate and log writes without executing them against the FHIR server |
| `FHIR_BUNDLE_CAPABILITIES` | unset | Comma-separated Bundle types: `batch`, `transaction`; enables `bundle` tool |
| `FHIR_BUNDLE_WRITES_ENABLED` | `false` | Set to `true` to allow write entries inside Bundles (also requires `FHIR_WRITE_CAPABILITIES`) |
| `FHIR_OPERATIONS` | unset | Comma-separated operation keys; `none` disables all catalog operations. Default catalog: `everything`, `lastn`, `validate`, `docref`, `expand`, `lookup`, `translate`, `summary`, `match` |
| `FHIR_TERMINOLOGY_BASE_URL` | unset | Enables terminology tools, e.g. `https://tx.fhir.org/r4` |
| `FHIR_PAGINATION_PATHS` | unset | Extra allowed path prefixes for pagination links, e.g. `FHIRProxy` |
| `FHIR_PREFETCH_MAX_PAGES` | `5` | Max upstream pages fetched per coalesced compact search |
| `FHIR_PREFETCH_MAX_ENTRIES` | `5000` | Max upstream entries accumulated before stopping |
| `FHIR_PREFETCH_MAX_BYTES` | `2097152` | Max raw bytes fetched before stopping |
| `FHIR_PREFETCH_TIMEOUT_MS` | `25000` | Wall-clock budget for the coalescing loop |
| `FHIR_AUDIT_SINK` | unset | Any combination of `console`, `file`, `http` |
| `FHIR_AUDIT_FILE` | `./audit.jsonl` | JSONL file used when the `file` audit sink is enabled |
| `FHIR_AUDIT_HTTP_URL` | unset | Destination URL for the `http` audit sink; required when `http` is enabled |
| `FHIR_AUDIT_HTTP_FORMAT` | `raw` | `raw` (internal AuditEvent JSON) or `fhir-auditevent` (FHIR R4 AuditEvent) |
| `FHIR_AUDIT_HTTP_AUTH` | unset | Authorization header value sent verbatim by the `http` sink |
| `FHIR_AUDIT_USER_HEADER` | unset | Proxy-authenticated user header copied into audit events |
| `LOG_LEVEL` | `info` | Log verbosity: `error`, `warn`, `info`, or `debug` |

Explicit `FHIR_SERVER_URL` and `FHIR_TOKEN_URL` values always win over derived
URLs.

## FHIR Version Support

Set `FHIR_VERSION` to select the active R4+ FHIR release. It controls the
derived FHIR API URL, FHIRPath model context, and compact response model
metadata. Some releases may use the nearest compatible FHIRPath model. For
terminology, use an endpoint that matches the selected FHIR release. Startup
logs hint when explicit FHIR or terminology URLs appear to reference a
different version.

## Customizing Tools And Messages

Everything in `config/` is editable without source changes.

| File | Purpose |
| --- | --- |
| `resources.json` | FHIR resource tools, search params, direct-read behavior, and `requireOneOf` rules |
| `operations.json` | Named operation catalog for `operate` |
| `search-controls.json` | Descriptions for `_count`, `_sort`, `_summary`, `_elements`, `_include`, `_revinclude`, `fhirpath`, `responseMode`, `maxResults`, and `prefetch` |
| `instructions/manifest.json` | Ordered list of instruction fragments to compose, each with an optional `when` gate (`terminology`, `writes`, `operations`, `bundle`). Custom builds reorder, add, or remove sections by editing this file. |
| `instructions/*.md` | Instruction fragments referenced by the manifest. Gated sections are included only when their feature is enabled; the `{{OPERATIONS_LIST}}` token is replaced with the live operation catalog. |
| `messages/*.json` | User-facing messages, errors, and response notes (split by domain: core, write, operations, terminology, bundle) |
| `core-tools.json` | Built-in tool descriptions and param hints |

### Resource Definition Schema

`config/resources.json` is an array of resource definitions:

| Field | Type | Description |
| --- | --- | --- |
| `resource` | `string` | FHIR resource type |
| `toolName` | `string` | MCP tool name; must be unique |
| `description` | `string` | Tool description |
| `supportsDirectRead` | `boolean` | Enables `GET /ResourceType/{id}` via `_id` |
| `searchParams` | `Record<string,string>` | FHIR search params and descriptions |
| `requireOneOf` | `string[]` | At least one listed param is required for search calls |

`searchParams` values are descriptions, not a full FHIR capability model.
Server-specific search behavior can still apply.

### Hot Reload

In development (`NODE_ENV` is not `production`), `resources.json`,
`search-controls.json`, and `operations.json` are watched. Invalid JSON keeps
the last valid snapshot, scope changes restart auth, and behavioral changes are
picked up on later tool calls. Adding/removing tools, operation schema changes,
and visible param-name changes still require restart because MCP tool
registration happens at startup. Production reads config once at startup.

## Transports

### Stdio

Set `MCP_TRANSPORT=stdio`. stdout is reserved for the MCP protocol; logs are
redirected to stderr. Use an external `FHIR_JWKS_URL` for stdio deployments.

### Streamable HTTP

HTTP transport is stateless and exposes MCP at:

```http
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

`GET /health` returns a no-PHI readiness snapshot:

```json
{
   "status": "ok",
   "mcp": true,
   "metadata": true,
   "tools": 22,
   "auth": true,
   "tokenExpiresIn": 287
}
```

Use a reverse proxy for TLS and user authentication when exposing HTTP beyond
localhost. Set `ALLOWED_HOSTS` when binding to a public interface.

## Deployment Examples

The [`examples/`](examples/) directory has standalone deployment examples for
Docker Compose, reverse proxy (Caddy), Azure Container Apps, Azure App Service,
and Kubernetes. Each includes a Dockerfile that installs from npm and a
`config/` overlay demonstrating how to override different config files.

## Development

```sh
# dev server
npm run dev

# type-check
npm run check

# build and run
npm run build
npm start
```

Build output goes to `bin/server.js`.
