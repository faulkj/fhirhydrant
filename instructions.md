# fhirHydrant

fhirHydrant's tools expose FHIR R4 endpoints over MCP.

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

Each tool maps to one FHIR resource type from `definitions.json`. Use `_id` for
direct reads when supported, or provide search parameters for FHIR search.

Tool results are returned as raw FHIR JSON and may include Bundles for searches
or resources for direct reads.

Search results are FHIR Bundles that may contain a `link` array. If a `link`
entry has `relation: "next"`, more results are available. Call `fhir_fetch_page`
with that entry's `url` to fetch the next page. Repeat until no `next` link is
present. Never construct pagination URLs manually — only use URLs returned by
the FHIR server.
