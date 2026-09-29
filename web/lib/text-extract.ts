import { unzipSync, strFromU8 } from "fflate"

export type ExtractionOutcome =
  | { status: "done"; text: string }
  | { status: "unsupported" }
  | { status: "failed"; reason: string }

/**
 * 파일 확장자로 추출 전략을 고른다. LLM 컨텍스트 주입용이므로 레이아웃이 아니라
 * 본문 텍스트만 확보하는 것이 목표다. 목업 단계에서는 외부 의존성 없이 처리할 수
 * 있는 형식(txt/md, DOCX, HWPX)만 지원하고, PDF·이미지는 서버/OCR가 필요하므로
 * unsupported로 표시한다.
 */
const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? ""

/** ZIP 내부 특정 XML들에서 텍스트 노드만 모아 공백 정규화된 문자열로 만든다. */
function textFromZipEntries(bytes: Uint8Array, matcher: (path: string) => boolean, tag: string) {
  const entries = unzipSync(bytes)
  const paths = Object.keys(entries).filter(matcher).sort()
  const chunks: string[] = []
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g")
  for (const path of paths) {
    const xml = strFromU8(entries[path])
    let match: RegExpExecArray | null
    while ((match = pattern.exec(xml)) !== null) {
      // XML 태그를 제거하고 엔티티를 최소한으로 복원한다.
      const text = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      if (text.trim()) chunks.push(text)
    }
  }
  return chunks.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** DOCX(OOXML): word/document.xml의 <w:t> 텍스트 런을 이어붙인다. */
function extractDocx(bytes: Uint8Array) {
  return textFromZipEntries(bytes, (path) => path === "word/document.xml", "w:t")
}

/** HWPX: Contents/section*.xml의 <hp:t> 텍스트 노드를 이어붙인다. */
function extractHwpx(bytes: Uint8Array) {
  return textFromZipEntries(bytes, (path) => /^Contents\/section\d*\.xml$/i.test(path), "hp:t")
}

export async function extractTextFromBlob(name: string, blob: Blob): Promise<ExtractionOutcome> {
  const extension = extensionOf(name)
  try {
    if (["txt", "md", "csv"].includes(extension)) {
      const text = (await blob.text()).trim()
      return { status: "done", text }
    }
    if (extension === "docx") {
      const text = extractDocx(new Uint8Array(await blob.arrayBuffer()))
      return text ? { status: "done", text } : { status: "failed", reason: "본문 텍스트를 찾지 못했습니다." }
    }
    if (extension === "hwpx") {
      const text = extractHwpx(new Uint8Array(await blob.arrayBuffer()))
      return text ? { status: "done", text } : { status: "failed", reason: "본문 텍스트를 찾지 못했습니다." }
    }
    // PDF, 이미지(OCR), 레거시 DOC 등은 목업 단계에서 클라이언트 추출을 지원하지 않는다.
    return { status: "unsupported" }
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "추출 중 오류가 발생했습니다." }
  }
}
