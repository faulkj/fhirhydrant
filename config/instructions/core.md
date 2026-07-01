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

Each tool maps to one FHIR resource type. Use `_id` for
direct reads when supported, or provide search parameters for FHIR search.
Common search-control parameters like `_count`, `_sort`, `_summary`, `_elements`,
`_include`, and `_revinclude` appear in a tool's schema only when the FHIR
server's `/metadata` advertises them for that resource type. Use `_count` as the
primary lever for managing oversized responses.
