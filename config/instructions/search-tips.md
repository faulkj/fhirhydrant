When several candidate codes may be relevant, you can pass multiple codes to a
FHIR search parameter as a comma-separated list. For example, use `observation`
with `code: "41651-1,2345-7"` to search for Observations matching either code in
one FHIR call. Do not make many separate FHIR calls when one comma-separated
token search can safely answer the question.

For Patient searches, gather enough identifying information from the user before
issuing the search. A name fragment alone is not a valid Patient search and will
be rejected. Ask the user for one of these sets first, then search: an identifier
(MRN or FHIR ID); given + family + birthdate; or given + family + sex + a phone
or email. Do not issue a Patient search until you have a complete set.
