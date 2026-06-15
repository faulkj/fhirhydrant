import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { compact } from "./compact.ts"
// Fixture exercises NOISE stripping with a synthetic (non-real) resource type
const RESOURCE: Record<string, unknown> = {
   resourceType: "TestResource",
   id: "r-1",
   meta: { versionId: "1", lastUpdated: "2024-01-01T00:00:00Z" },
   text: { status: "generated", div: "<div>narrative</div>" },
   extension: [{ url: "http://example.com/ext", valueString: "noise" }],
   _implicitRules: "noise",
   active: true,
}

const BUNDLE: Record<string, unknown> = {
   resourceType: "Bundle",
   type: "searchset",
   total: 1,
   link: [{ relation: "self", url: "https://fhir.example.org/r?_count=1" }],
   entry: [{ resource: RESOURCE }],
}

describe("compact — output validity", () => {
   const result = compact(RESOURCE) as Record<string, unknown>
   it("returns a plain object", () => assert.equal(typeof result, "object"))
   it("is valid JSON", () => assert.doesNotThrow(() => JSON.parse(JSON.stringify(result))))
   it("is smaller than input (JSON bytes)", () =>
      assert.ok(
         JSON.stringify(result).length < JSON.stringify(RESOURCE).length,
         `compact (${JSON.stringify(result).length}B) should be < input (${JSON.stringify(RESOURCE).length}B)`,
      ))
})

describe("compact — preserves identity fields", () => {
   const result = compact(RESOURCE) as Record<string, unknown>
   it("preserves resourceType", () => assert.equal(result.resourceType, RESOURCE.resourceType))
   it("preserves id on root resource", () => assert.equal(result.id, RESOURCE.id))
   it("preserves primitives", () => assert.equal(result.active, RESOURCE.active))
})

describe("compact — NOISE stripping", () => {
   const result = compact(RESOURCE) as Record<string, unknown>
   it("strips meta", () => assert.equal(result.meta, undefined))
   it("strips text (narrative)", () => assert.equal(result.text, undefined))
   it("strips extension", () => assert.equal(result.extension, undefined))
   it("strips _ -prefixed keys", () => assert.equal(result._implicitRules, undefined))
})

describe("compact — Bundle shape", () => {
   const result = compact(BUNDLE) as Record<string, unknown>
   it("preserves resourceType", () => assert.equal(result.resourceType, BUNDLE.resourceType))
   it("preserves total", () => assert.equal(result.total, BUNDLE.total))
   it("preserves link for pagination", () => assert.ok(Array.isArray(result.link)))
   it("has entry array", () => assert.ok(Array.isArray(result.entry)))
   it("compacts entry resources (meta stripped)", () => {
      const resource = ((result.entry as Record<string, unknown>[])[0])?.resource as Record<string, unknown>
      assert.equal(resource?.meta, undefined)
   })
   it("is smaller than input (JSON bytes)", () =>
      assert.ok(
         JSON.stringify(result).length < JSON.stringify(BUNDLE).length,
         `compact (${JSON.stringify(result).length}B) should be < input (${JSON.stringify(BUNDLE).length}B)`,
      ))
})
