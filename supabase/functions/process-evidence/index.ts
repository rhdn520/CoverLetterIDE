import { authenticatedUser, clients, openAI, options, response } from "../_shared/core.ts"
import JSZip from "https://esm.sh/jszip@3.10.1"

const allowed = new Set(["pdf", "jpg", "jpeg", "png", "docx", "hwpx", "txt", "md"])

function extension(name: string) { return name.split(".").pop()?.toLowerCase() ?? "" }
function hasMagicBytes(bytes: Uint8Array, ext: string) {
  const text = new TextDecoder().decode(bytes.slice(0, 8))
  if (["jpg", "jpeg"].includes(ext)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (ext === "png") return text.startsWith("\u0089PNG")
  if (ext === "pdf") return text.startsWith("%PDF-")
  if (["docx", "hwpx"].includes(ext)) return bytes[0] === 0x50 && bytes[1] === 0x4b
  return true
}

async function base64(file: Blob) {
  // `String.fromCharCode(...bytes)` overflows the call stack for larger, valid
  // uploads. Convert in bounded chunks so the 25 MB policy remains usable.
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function ocr(file: Blob, mime: string, filename: string) {
  const encoded = await base64(file)
  const isPdf = mime === "application/pdf" || filename.toLowerCase().endsWith(".pdf")
  const content = isPdf
    ? [{ type: "input_text", text: "Extract only readable Korean or English text from this PDF. Preserve headings and paragraphs." }, { type: "input_file", filename, file_data: `data:application/pdf;base64,${encoded}` }]
    : [{ type: "input_text", text: "Extract only readable Korean or English text from this image. Preserve headings and paragraphs." }, { type: "input_image", image_url: `data:${mime};base64,${encoded}` }]
  const result: any = await openAI("/responses", { model: Deno.env.get("OPENAI_OCR_MODEL") ?? "gpt-4.1-mini", input: [{ role: "user", content }] })
  return result.output_text ?? result.output?.flatMap((item: any) => item.content ?? []).filter((item: any) => item.type === "output_text").map((item: any) => item.text).join("\n") ?? ""
}

function plainXml(xml: string) {
  return xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
}

async function extractOfficeText(file: Blob, ext: string) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => ext === "docx" ? name === "word/document.xml" : /^Contents\/section\d+\.xml$/i.test(name))
  const chunks = await Promise.all(names.map(async (name) => plainXml(await zip.files[name].async("string"))))
  return chunks.join("\n").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim()
}

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  let fileId: string | undefined
  let service: ReturnType<typeof clients>["service"] | undefined
  try {
    const body = await request.json(); fileId = body.fileId; if (!fileId) return response({ error: "fileId is required" }, 400)
    const { currentUser } = await authenticatedUser(request); service = clients(request).service
    const { data: fileRow, error } = await service.from("evidence_files").select("*").eq("id", fileId).eq("user_id", currentUser.id).single(); if (error) throw error
    const ext = extension(fileRow.original_name)
    if (!allowed.has(ext) || fileRow.byte_size > 25 * 1024 * 1024) { await service.from("evidence_files").update({ file_state: "rejected", extraction_status: "failed", extraction_error: "Unsupported file type or size" }).eq("id", fileId); return response({ error: "Unsupported file" }, 400) }
    const { data: downloaded, error: downloadError } = await service.storage.from("evidence-files").download(fileRow.storage_path); if (downloadError || !downloaded) throw downloadError ?? new Error("File not found")
    const prefix = new Uint8Array(await downloaded.slice(0, 16).arrayBuffer())
    if (!hasMagicBytes(prefix, ext)) { await service.from("evidence_files").update({ file_state: "rejected", extraction_status: "failed", extraction_error: "File signature mismatch" }).eq("id", fileId); return response({ error: "File signature mismatch" }, 400) }
    // File availability and AI text extraction are deliberately independent.
    // A user must always be able to open their validated private original even
    // when OCR is unavailable, misconfigured, or rejects a particular PDF.
    const readyPath = `${currentUser.id}/ready/${fileRow.id}/${fileRow.original_name}`
    if (fileRow.storage_path !== readyPath) {
      const { error: copyError } = await service.storage.from("evidence-files").copy(fileRow.storage_path, readyPath)
      if (copyError) throw copyError
      await service.storage.from("evidence-files").remove([fileRow.storage_path])
    }
    let extracted = ""; let extractionStatus = "done"; let extractionError: string | null = null
    try {
      if (["txt", "md"].includes(ext)) extracted = await downloaded.text()
      else if (["pdf", "jpg", "jpeg", "png"].includes(ext)) extracted = await ocr(downloaded, fileRow.mime_type, fileRow.original_name)
      else if (["docx", "hwpx"].includes(ext)) extracted = await extractOfficeText(downloaded, ext)
    } catch (error) {
      extractionStatus = "failed"
      extractionError = error instanceof Error ? error.message : "Text extraction failed"
      console.error(JSON.stringify({ event: "evidence_text_extraction_failed", fileId, message: extractionError }))
    }
    await service.from("evidence_files").update({ storage_path: readyPath, file_state: "ready", detected_mime_type: downloaded.type || fileRow.mime_type, extracted_text: extracted || null, extraction_status: extractionStatus, processed_at: new Date().toISOString(), extraction_error: extractionError }).eq("id", fileId)
    return response({ ok: true, extractionStatus })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed"
    console.error(JSON.stringify({ event: "process_evidence_failed", fileId, message }))
    if (fileId && service) await service.from("evidence_files").update({ file_state: "failed", extraction_status: "failed", extraction_error: message, processed_at: new Date().toISOString() }).eq("id", fileId)
    return response({ error: message }, 500)
  }
})
