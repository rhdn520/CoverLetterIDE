import assert from "node:assert/strict"
import test from "node:test"
import { allocateCreditSpend } from "../lib/credit-policy.ts"

test("uses expiring monthly credit before earned credit", () => {
  assert.deepEqual(allocateCreditSpend([{ kind: "earned", remaining: 500 }, { kind: "monthly", remaining: 1000 }], 1200), [{ kind: "monthly", amount: 1000 }, { kind: "earned", amount: 200 }])
})

test("does not permit overspending", () => {
  assert.throws(() => allocateCreditSpend([{ kind: "monthly", remaining: 10 }], 11), /Insufficient/)
})
