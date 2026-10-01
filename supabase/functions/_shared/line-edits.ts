// 라인 번호 기반 자소서 편집 적용기 (순수 함수, Deno/Node 공용).
//
// LLM 코치는 자소서 본문을 "원문 재현"하지 않고 "몇 번째 줄을 어떻게"만 지정한다.
// 이 모듈이 그 지시(edits)를 원본 라인 배열에 결정론적으로 적용해 수정본(after)을
// 만든다. 모든 라인 번호는 "원본(1-base) 기준"이며, 적용 중 번호가 밀리지 않도록
// 원본 인덱스를 순회하며 한 번에 재조립한다.

export type LineEditOp = "replace" | "insert_after" | "delete"

export interface LineEdit {
  op: LineEditOp
  /** 원본 1-base 라인 번호. insert_after의 경우 "이 줄 다음"에 삽입한다. */
  line: number
  /** replace/insert_after에서 넣을 텍스트. 여러 줄이면 \n 포함 가능. */
  text?: string
  /**
   * 선택: 모델이 지목한 라인의 실제 앞부분(검증용). 주어지면 원본 라인과 대조해
   * 접두사(trim 후)가 일치하지 않으면 해당 edit을 건너뛴다. 환각/오프셋 방지.
   */
  expected?: string
}

export interface SkippedEdit {
  edit: LineEdit
  reason: "out_of_range" | "expected_mismatch" | "invalid_op" | "missing_text"
}

export interface ApplyResult {
  /** 편집이 적용된 최종 본문. */
  after: string
  /** 실제로 반영된 편집. */
  applied: LineEdit[]
  /** 범위 밖·검증 실패 등으로 건너뛴 편집. */
  skipped: SkippedEdit[]
  /** 적용 후 본문이 원본과 달라졌는지. */
  changed: boolean
}

const EXPECTED_PREFIX_LEN = 12

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

/** 모델이 돌려준 edits가 유효한 형태인지 느슨하게 검사하고 정규화한다. */
export function coerceLineEdits(raw: unknown): LineEdit[] {
  if (!Array.isArray(raw)) return []
  const edits: LineEdit[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const candidate = item as Record<string, unknown>
    const op = candidate.op
    const line = Number(candidate.line)
    if (op !== "replace" && op !== "insert_after" && op !== "delete") continue
    if (!Number.isInteger(line)) continue
    const edit: LineEdit = { op, line }
    if (typeof candidate.text === "string") edit.text = candidate.text
    if (typeof candidate.expected === "string") edit.expected = candidate.expected
    edits.push(edit)
  }
  return edits
}

/**
 * edits를 answer에 적용한다. 라인 번호는 원본 기준이므로, 여러 edit이 와도
 * 원본 인덱스별로 모아 한 번에 재조립해 번호 밀림을 원천 차단한다.
 */
export function applyLineEdits(answer: string, rawEdits: LineEdit[]): ApplyResult {
  const lines = answer.split("\n")
  const total = lines.length
  const applied: LineEdit[] = []
  const skipped: SkippedEdit[] = []

  // 원본 라인 인덱스(0-base) -> 그 라인에 적용할 연산들.
  // replace/delete는 라인 자체를 치환/제거, insert_after는 라인 뒤에 덧붙인다.
  const replaceAt = new Map<number, string>()
  const deleteAt = new Set<number>()
  const insertAfter = new Map<number, string[]>()

  const matchesExpected = (index: number, expected?: string) => {
    if (expected === undefined) return true
    const actual = normalize(lines[index] ?? "")
    const want = normalize(expected)
    if (!want) return true
    // 모델 expected는 라인 앞부분만 담는 경우가 많아 접두사 비교를 허용한다.
    const probe = want.slice(0, Math.max(EXPECTED_PREFIX_LEN, 0))
    return actual.startsWith(probe) || actual.includes(probe)
  }

  for (const edit of rawEdits) {
    const index = edit.line - 1 // 1-base -> 0-base
    if (!Number.isInteger(index) || index < 0 || index >= total) {
      skipped.push({ edit, reason: "out_of_range" })
      continue
    }
    if ((edit.op === "replace" || edit.op === "insert_after") && typeof edit.text !== "string") {
      skipped.push({ edit, reason: "missing_text" })
      continue
    }
    if (!matchesExpected(index, edit.expected)) {
      skipped.push({ edit, reason: "expected_mismatch" })
      continue
    }
    if (edit.op === "replace") {
      if (deleteAt.has(index)) { skipped.push({ edit, reason: "invalid_op" }); continue }
      replaceAt.set(index, edit.text as string)
    } else if (edit.op === "delete") {
      replaceAt.delete(index)
      deleteAt.add(index)
    } else {
      // insert_after: 같은 라인에 여러 삽입이 오면 순서대로 누적.
      const bucket = insertAfter.get(index) ?? []
      bucket.push(edit.text as string)
      insertAfter.set(index, bucket)
    }
    applied.push(edit)
  }

  const out: string[] = []
  for (let i = 0; i < total; i += 1) {
    if (deleteAt.has(i)) {
      // 삭제된 라인이라도 insert_after는 유효하게 처리한다.
    } else if (replaceAt.has(i)) {
      out.push(replaceAt.get(i) as string)
    } else {
      out.push(lines[i])
    }
    const inserts = insertAfter.get(i)
    if (inserts) for (const text of inserts) out.push(text)
  }

  const after = out.join("\n")
  return { after, applied, skipped, changed: after !== answer }
}

/** 자소서 본문을 모델에게 줄 때 쓰는 "L1: ..." 번호 매김 형식으로 변환한다. */
export function numberLines(answer: string): string {
  const lines = answer.split("\n")
  return lines.map((line, index) => `L${index + 1}: ${line}`).join("\n")
}
