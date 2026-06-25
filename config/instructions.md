# fhirHydrant

fhirHydrant's tools expose FHIR endpoints over MCP.

Use these tools to search for or read clinical resources from the configured
FHIR server.

Call `capabilities` when you need to discover or confirm which resource types,
interactions, search parameters, or named operations the server supports. If the
needed tool and parameters are already known from the current tool schema, you
may query directly.

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

If a response header includes `⚠️ MORE PAGES`, additional data exists beyond
this page. Call `paginate` with the URL from the `Next:` line in that same
header to continue. Whether to continue depends on whether the retrieved data
already covers the requested range — see Retrieval Discipline rule 5.

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

## Retrieval Discipline

When analyzing or summarizing patient data, establish retrieval completeness
before interpretation.

1. **Resolve the patient first.** Confirm the intended patient using identifiers,
   name, DOB, or other demographics. Use the resolved Patient.id for all
   downstream queries.

2. **Resolve clinical concepts before coded queries.** After resolving the
   patient, if the user's target concept is not already a code and the next
   query uses a coded parameter such as `code`, `category`, `type`,
   `reason-code`, `vaccine-code`, or `service-type`, use `code_search` (if
   available) before querying that resource. Broad category or type filters are
   fallbacks, not substitutes for concept/code resolution. Do not assume
   resource text will contain the user's exact wording.

3. **Prefer structured resources for quantitative analysis.** For values over
   time, query Observation, MedicationRequest, MedicationAdministration, or
   other structured resources first. Use DocumentReference only when structured
   data is unavailable or the user explicitly asks for narrative.

4. **Use efficient retrieval for high-volume data.** For multi-day, longitudinal,
   or high-frequency requests, use compact mode, FHIRPath projection, and set
   `maxResults` high enough to cover the requested range.

5. **Exhaust pagination before concluding.** If a response contains a `next`
   link, the result is incomplete. Continue with `paginate` until no `next` link
   remains, the requested date range is covered, or the user explicitly asked
   for a sample. Never summarize or interpret partial results as complete.

6. **Report completeness before interpreting.** Before analysis, verify the
   resource and code queried, the requested vs. actual date range, the total
   count retrieved, and whether pagination was exhausted.

7. **Do not infer absence prematurely.** A first page, capped result, text
   mismatch, or missing document is not evidence of absence. Absence requires
   correct patient, correct resource type, resolved code, checked date range,
   and exhausted pagination.

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

## Bundle Execution

Use `bundle` to submit a FHIR batch or transaction Bundle when you
need to perform multiple related reads or writes in a single round trip. Provide
a complete FHIR Bundle JSON as the `body` parameter with `resourceType: "Bundle"`,
`type` set to `batch` or `transaction`, and an `entry` array of request objects.

Prefer batch reads over multiple individual tool calls when you need several
related resources simultaneously and already know their IDs or search criteria.

Before submitting any Bundle that contains write entries (POST, PUT, PATCH,
DELETE) or any transaction Bundle, you must:
1. Summarize the exact resources and actions that will be submitted.
2. State whether the operation is atomic (transaction) or independent (batch).
3. Ask the user for explicit permission before proceeding.

Do not infer permission from earlier context. Server-side capability gates
(`FHIR_BUNDLE_WRITES_ENABLED`, `FHIR_WRITE_CAPABILITIES`) are administrative
controls, not user consent.
