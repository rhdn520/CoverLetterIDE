export const SUPPORTED_FILE_EXTENSIONS = ["docx", "hwpx", "pdf", "jpg", "jpeg", "png", "txt", "md"] as const
export const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024

export function validateEvidenceFile(name: string, size: number) {
  const extension = name.split(".").pop()?.toLowerCase()
  if (!extension || !SUPPORTED_FILE_EXTENSIONS.includes(extension as typeof SUPPORTED_FILE_EXTENSIONS[number])) return "DOCX, HWPX, PDF, JPG, JPEG, PNG, TXT, MD 파일만 업로드할 수 있습니다."
  if (size > MAX_EVIDENCE_FILE_BYTES) return "파일 크기는 25MB 이하여야 합니다."
  return null
}
