import assert from "node:assert/strict"
import test from "node:test"
import { MAX_EVIDENCE_FILE_BYTES, validateEvidenceFile } from "../lib/file-policy.ts"

test("allows only the declared production formats", () => {
  assert.equal(validateEvidenceFile("resume.docx", 1), null)
  assert.equal(validateEvidenceFile("portfolio.HWPX", 1), null)
  assert.match(validateEvidenceFile("legacy.doc", 1) ?? "", /DOCX/)
  assert.match(validateEvidenceFile("archive.zip", 1) ?? "", /DOCX/)
})

test("rejects files larger than 25MB", () => {
  assert.match(validateEvidenceFile("essay.pdf", MAX_EVIDENCE_FILE_BYTES + 1) ?? "", /25MB/)
})
