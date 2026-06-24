# fhirHydrant

fhirHydrant's tools expose FHIR endpoints over MCP.

Use these tools to search for or read clinical resources from the configured
FHIR server.

Call `capabilities` before making clinical queries to understand which resource
types, interactions, and search parameters the server supports. This helps you
choose the right tool and parameters for each request and avoids calls the
server cannot handle.

Prefer search first when the user describes a patient, encounter, condition,
observation, or other clinical concept without a known FHIR resource ID. Use
search results to identify the relevant resource IDs, then use those IDs for
direct reads when a tool supports `_id`.

Each tool maps to one FHIR resource type from `config/resources.json`. Use `_id` for
direct reads when supported, or provide search parameters for FHIR search.
Common search-control parameters like `_count`, `_sort`, `_summary`, `_elements`,
`_include`, and `_revinclude` appear in a tool's schema only when the FHIR
server's `/metadata` advertises them for that resource type. Use `_count` as the
primary lever for managing oversized responses. Tool schemas are built at startup
from `/metadata` — restart the server to pick up metadata changes.

FHIR query results include a short plain-text header followed by unmodified FHIR
JSON. The JSON may be a Bundle for searches and pagination, or a resource for
direct reads. The header identifies the resource type and payload size. For
Bundles, it also includes the entry count, total (when known), and next-page URL
when present. The header may also note when the server allowed a vendor-specific
or unadvertised search behavior.

Search responses are shaped to avoid overly broad clinical data retrieval. If a
tool returns `Response too large`, retry with narrower search parameters such as
patient, encounter, category, code, date, status, or a lower `_count` when that
parameter is available. Do not treat an oversized response error as evidence
that no matching clinical data exists.

Search results are FHIR Bundles that may contain a `link` array. If a `link`
entry has `relation: "next"`, more results are available. Call `paginate`
with that entry's `url` to fetch the next page. Repeat until no `next` link is
present. Never construct pagination URLs manually — only use URLs returned by
the FHIR server.

In compact mode, the server automatically fetches multiple upstream FHIR pages
and returns one consolidated compact Bundle. This means a single search or
paginate call may already contain multiple upstream pages of entries. If the response includes
a `next` link, call `paginate` with `responseMode=compact` to continue from
where the server stopped. You do not need to repeatedly paginate through small
pages — the server handles that internally. Use `maxResults` to set a target
for how many compact entries you want back. Pass `prefetch=false` if you need
single-page control for debugging.

When the FHIR server does not support `_elements` or `_summary`, or when you
need projection beyond what those controls offer, use the `fhirpath` parameter
for client-side filtering. The expression is a standard FHIRPath expression
evaluated locally against the full FHIR response — the FHIR server never sees
it. For search Bundles, write expressions against the Bundle structure (e.g.
`Bundle.entry.resource.name`). For direct reads, write expressions against the
single resource (e.g. `Patient.name.given`). Prefer `_elements` or `_summary`
when available — they reduce data at the source and save bandwidth.

Search results default to compact mode, which strips FHIR noise (meta,
extensions, narrative, contained resources) and simplifies data types for
token efficiency while preserving clinical meaning. Compact responses keep
native Bundle keys (`entry`, `link`) so pagination works normally. Use
`responseMode=full` when you need raw FHIR structure — extensions,
provenance, narrative, or full coding systems. Direct reads default to
full. If `responseMode` is absent from the tool schema, compact is
server-enforced.

When several candidate codes may be relevant, you can pass multiple codes to a
FHIR search parameter as a comma-separated list. For example, use `observation`
with `code: "41651-1,2345-7"` to search for Observations matching either code in
one FHIR call. Do not make many separate FHIR calls when one comma-separated
token search can safely answer the question.

## Write Operations

Some tools may include an `action` parameter when write operations are enabled.
The `action` enum only lists operations the server actually supports for that
resource — check the tool's schema. Omitting `action` preserves normal
search/read behavior. Each tool's description explains its available write
actions and required parameters.

Always confirm destructive operations (update, patch, delete) with the user
before executing. For create, verify the user has provided all required fields
for the resource type.

## FHIR Named Operations

Use the `operate` tool to invoke FHIR named operations like `$everything`,
`$lastn`, `$validate`, and `$docref`. These go beyond simple search/read — they
execute server-side logic and return specialized results.

Call `capabilities` to see the currently enabled operation catalog, including
required parameters and levels. The `operation` parameter accepts catalog keys
(e.g. `everything`, `lastn`) — a leading `$` is optional.

- **$everything** — Patient instance-level GET. Returns the patient's full
  clinical record as a Bundle. Requires `id`.
- **$lastn** — Observation type-level GET. Returns the last N observations
  grouped by code. Requires `patient` or `subject` AND `category` or `code`.
- **$validate** — Any resource type-level POST. Validates a FHIR resource.
  Requires `resourceType` and `body` (FHIR JSON).
- **$docref** — DocumentReference type-level GET. Finds document references for a
  patient. Requires `patient`.

Use resource tools for standard search/read/write. Use `operate` when you need
server-side aggregation, validation, or specialized queries that go beyond CRUD.
