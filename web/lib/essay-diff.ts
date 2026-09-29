export type InlineDiffPart = { kind: "equal"; text: string } | { kind: "change"; before: string; after: string }

/**
 * 문장 단위 LCS로 동일한 문장은 본문 흐름에 남기고, 달라진 구간만 변경 블록으로
 * 분리한다. UI와 저장소가 같은 결과를 사용하므로 특정 변경만 승인해도 정확한
 * 위치에 적용되며, 이후 원격 AI가 before/after를 반환해도 이 로직을 재사용한다.
 */
export function createInlineDiff(before: string, after: string): InlineDiffPart[] {
  const split = (value: string) => value.match(/[^.!?\n]+[.!?]+(?:[ \t]+|(?=\n|$))|[^.!?\n]+(?:[ \t]+|(?=\n|$))|\n+/g) ?? []
  const left = split(before)
  const right = split(after)
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i -= 1) for (let j = right.length - 1; j >= 0; j -= 1) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])

  const operations: Array<{ kind: "equal" | "delete" | "insert"; text: string }> = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      operations.push({ kind: "equal", text: left[i++] })
      j += 1
    } else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) {
      operations.push({ kind: "delete", text: left[i++] })
    } else {
      operations.push({ kind: "insert", text: right[j++] })
    }
  }

  const parts: InlineDiffPart[] = []
  for (let index = 0; index < operations.length;) {
    if (operations[index].kind === "equal") {
      let text = ""
      while (operations[index]?.kind === "equal") text += operations[index++].text
      parts.push({ kind: "equal", text })
      continue
    }
    let removed = ""
    let added = ""
    while (operations[index] && operations[index].kind !== "equal") {
      const operation = operations[index++]
      if (operation.kind === "delete") removed += operation.text
      if (operation.kind === "insert") added += operation.text
    }
    parts.push({ kind: "change", before: removed, after: added })
  }
  return parts.length ? parts : [{ kind: "change", before, after }]
}
