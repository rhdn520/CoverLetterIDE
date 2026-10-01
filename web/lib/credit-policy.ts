export type CreditBucket = { kind: "monthly" | "earned"; remaining: number }

/** Monthly credit is deliberately consumed before non-expiring contribution credit. */
export function allocateCreditSpend(buckets: CreditBucket[], amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Credit amount must be a positive integer")
  const ordered = [...buckets].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "monthly" ? -1 : 1))
  let remaining = amount
  const allocations: Array<{ kind: CreditBucket["kind"]; amount: number }> = []
  for (const bucket of ordered) {
    const used = Math.min(bucket.remaining, remaining)
    if (used) allocations.push({ kind: bucket.kind, amount: used })
    remaining -= used
    if (!remaining) return allocations
  }
  throw new Error("Insufficient credits")
}
