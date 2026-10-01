import assert from "node:assert/strict"
import test from "node:test"
import { applyLineEdits, coerceLineEdits, numberLines } from "../../supabase/functions/_shared/line-edits.ts"

const essay = ["첫째 줄입니다.", "둘째 줄입니다.", "셋째 줄입니다."].join("\n")

test("replace swaps a single line in place", () => {
  const result = applyLineEdits(essay, [{ op: "replace", line: 2, text: "둘째 줄을 수정했습니다." }])
  assert.equal(result.after, ["첫째 줄입니다.", "둘째 줄을 수정했습니다.", "셋째 줄입니다."].join("\n"))
  assert.equal(result.applied.length, 1)
  assert.equal(result.skipped.length, 0)
  assert.equal(result.changed, true)
})

test("insert_after adds a new line without shifting original indices", () => {
  const result = applyLineEdits(essay, [{ op: "insert_after", line: 1, text: "새로 끼운 줄." }])
  assert.equal(result.after, ["첫째 줄입니다.", "새로 끼운 줄.", "둘째 줄입니다.", "셋째 줄입니다."].join("\n"))
})

test("delete removes the targeted line", () => {
  const result = applyLineEdits(essay, [{ op: "delete", line: 3 }])
  assert.equal(result.after, ["첫째 줄입니다.", "둘째 줄입니다."].join("\n"))
})

test("multiple edits use original line numbers (no shift drift)", () => {
  // 원본 기준: L1 교체, L2 삭제, L3 뒤에 삽입이 모두 '원본 번호'로 해석되어야 한다.
  const result = applyLineEdits(essay, [
    { op: "replace", line: 1, text: "A" },
    { op: "delete", line: 2 },
    { op: "insert_after", line: 3, text: "D" },
  ])
  assert.equal(result.after, ["A", "셋째 줄입니다.", "D"].join("\n"))
  assert.equal(result.applied.length, 3)
})

test("out-of-range line is skipped, valid edits still apply", () => {
  const result = applyLineEdits(essay, [
    { op: "replace", line: 99, text: "없는 줄" },
    { op: "replace", line: 1, text: "유효 수정" },
  ])
  assert.equal(result.applied.length, 1)
  assert.equal(result.skipped.length, 1)
  assert.equal(result.skipped[0].reason, "out_of_range")
  assert.equal(result.after.split("\n")[0], "유효 수정")
})

test("expected mismatch skips that edit", () => {
  const result = applyLineEdits(essay, [
    { op: "replace", line: 2, text: "바뀐 내용", expected: "전혀 다른 원문" },
  ])
  assert.equal(result.applied.length, 0)
  assert.equal(result.skipped[0].reason, "expected_mismatch")
  assert.equal(result.changed, false)
})

test("expected prefix match (partial) is accepted", () => {
  const result = applyLineEdits(essay, [
    { op: "replace", line: 2, text: "확정 수정", expected: "둘째 줄" },
  ])
  assert.equal(result.applied.length, 1)
  assert.equal(result.after.split("\n")[1], "확정 수정")
})

test("replace missing text is skipped", () => {
  const result = applyLineEdits(essay, [{ op: "replace", line: 1 } as unknown as { op: "replace"; line: number }])
  assert.equal(result.applied.length, 0)
  assert.equal(result.skipped[0].reason, "missing_text")
})

test("numberLines prefixes each line with L<n>:", () => {
  assert.equal(numberLines("a\nb"), "L1: a\nL2: b")
})

test("coerceLineEdits filters invalid ops and non-integer lines", () => {
  const edits = coerceLineEdits([
    { op: "replace", line: 1, text: "ok" },
    { op: "frobnicate", line: 2 },
    { op: "delete", line: "x" },
    { op: "insert_after", line: 3, text: "add", expected: "셋째" },
    null,
    "nope",
  ])
  assert.equal(edits.length, 2)
  assert.equal(edits[0].op, "replace")
  assert.equal(edits[1].op, "insert_after")
  assert.equal(edits[1].expected, "셋째")
})
