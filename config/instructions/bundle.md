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

Do not infer permission from earlier context. Server-side capability gates are
administrative controls, not user consent.
