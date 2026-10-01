"use client"

/* Supabase returns untyped JSON until generated database types are added. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createSupabaseBrowserClient } from "./client"
import type { AppState, ApplicationStatus, ChatSession, Essay, EvidenceFile, Project } from "../domain"
import { createInlineDiff } from "../essay-diff"
import { validateEvidenceFile } from "../file-policy"

type Row = Record<string, any>
const client = createSupabaseBrowserClient()
const listeners = new Set<() => void>()
const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const emptyState = (): AppState => ({
  version: 3,
  user: null,
  profile: { school: "", major: "", graduation: "", experiences: "", awards: "" },
  files: [], projects: [], essays: {}, chats: {}, reports: [], contributions: [], transactions: [],
  creditBalance: 0, creditMonth: new Date().toISOString().slice(0, 7),
})
let state = emptyState()
let initialized = false
let contributionDraft: { company: string; role: string; questions: Array<{ question: string; answer: string }> } | null = null

function emit() { listeners.forEach((listener) => listener()) }
function setState(next: AppState) { state = next; emit() }
function patch(recipe: (current: AppState) => AppState) { setState(recipe(state)) }
function fileFromRow(row: Row): EvidenceFile {
  return { id: row.id, name: row.original_name, size: Number(row.byte_size), type: row.detected_mime_type ?? row.mime_type, createdAt: row.created_at, extractedText: row.extracted_text ?? undefined, extractionStatus: row.extraction_status, extractionError: row.extraction_error ?? undefined }
}
function projectFromRow(row: Row, links: Row[]): Project {
  return { id: row.id, title: row.title, company: row.company, role: row.role, deadline: row.deadline, status: row.status, resultRewarded: row.result_rewarded, createdAt: row.created_at, fileIds: links.filter((link) => link.project_id === row.id).map((link) => link.file_id) }
}
function essayFromRow(row: Row): Essay { return { id: row.id, projectId: row.project_id, title: row.title, question: row.question, answer: row.answer, order: row.position, version: row.version, updatedAt: row.updated_at } }

async function requireUser() {
  const { data: { user } } = await client.auth.getUser()
  if (!user) throw new Error("로그인이 필요합니다.")
  return user
}

async function refresh() {
  const { data: { user } } = await client.auth.getUser()
  if (!user) { setState(emptyState()); return }
  await client.rpc("ensure_monthly_credits", { p_user_id: user.id })
  const [profileRes, projectsRes, linksRes, filesRes, essaysRes, sessionsRes, messagesRes, reportsRes, contributionsRes, questionsRes, transactionsRes, balanceRes] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    client.from("projects").select("*").is("archived_at", null).order("created_at", { ascending: false }),
    client.from("project_files").select("*"),
    client.from("evidence_files").select("*").neq("file_state", "deleted").order("created_at", { ascending: false }),
    client.from("essays").select("*").order("position"),
    client.from("chat_sessions").select("*").order("updated_at", { ascending: false }),
    client.from("chat_messages").select("*").order("created_at"),
    client.from("analysis_reports").select("*").order("created_at", { ascending: false }),
    client.from("contributions").select("*").order("created_at", { ascending: false }),
    client.from("contribution_questions").select("*"),
    client.from("credit_transactions").select("*").order("created_at", { ascending: false }),
    client.rpc("credit_balance_detail", { p_user_id: user.id }),
  ])
  const fail = [profileRes, projectsRes, linksRes, filesRes, essaysRes, sessionsRes, messagesRes, reportsRes, contributionsRes, questionsRes, transactionsRes, balanceRes].find((result) => result.error)?.error
  if (fail) throw fail
  const links = linksRes.data ?? []
  const essays = (essaysRes.data ?? []).reduce<Record<string, Essay[]>>((acc, row) => { (acc[row.project_id] ??= []).push(essayFromRow(row)); return acc }, {})
  const chats = (sessionsRes.data ?? []).reduce<Record<string, ChatSession[]>>((acc, session) => {
    const mapped: ChatSession = { id: session.id, title: session.title, createdAt: session.created_at, updatedAt: session.updated_at, messages: (messagesRes.data ?? []).filter((message) => message.session_id === session.id).map((message) => ({ id: message.id, role: message.role, content: message.content, reasoning: message.reasoning ?? [], references: message.reference_items ?? [], suggestions: message.suggestions ?? [], createdAt: message.created_at })) }
    ;(acc[session.project_id] ??= []).push(mapped); return acc
  }, {})
  const questions = questionsRes.data ?? []
  const balance = Array.isArray(balanceRes.data) ? balanceRes.data[0] : balanceRes.data
  setState({
    version: 3,
    user: { id: user.id, name: profileRes.data?.name || user.user_metadata.full_name || user.email || "사용자", email: user.email ?? "" },
    profile: { school: profileRes.data?.school ?? "", major: profileRes.data?.major ?? "", graduation: profileRes.data?.graduation ?? "", experiences: profileRes.data?.experiences ?? "", awards: profileRes.data?.awards ?? "" },
    files: (filesRes.data ?? []).map(fileFromRow), projects: (projectsRes.data ?? []).map((row) => projectFromRow(row, links)), essays, chats,
    reports: (reportsRes.data ?? []).map((row) => ({ id: row.id, projectId: row.project_id, cacheKey: row.cache_key, score: Number(row.score), summary: row.summary ?? "", strengths: row.strengths ?? [], weaknesses: row.weaknesses ?? [], suggestions: row.suggestions ?? [], passedMatches: row.passed_matches, failedMatches: row.failed_matches, createdAt: row.created_at })),
    contributions: (contributionsRes.data ?? []).map((row) => ({ id: row.id, company: row.company, role: row.role, applicationPeriod: row.application_period, result: row.result, questions: questions.filter((q) => q.contribution_id === row.id).sort((a, b) => a.position - b.position).map((q) => ({ question: q.question, answer: q.answer })), createdAt: row.created_at })),
    transactions: (transactionsRes.data ?? []).map((row) => ({ id: row.id, amount: row.amount, reason: row.reason, referenceId: row.reference_id, createdAt: row.created_at })),
    creditBalance: balance?.total ?? 0, creditMonth: new Date().toISOString().slice(0, 7),
  })
}

async function persistProfile(profile: AppState["profile"]) { const { error } = await client.from("profiles").update(profile).eq("id", (await requireUser()).id); if (error) throw error }
async function persistProject(project: Project) { const { error } = await client.from("projects").upsert({ id: project.id, user_id: (await requireUser()).id, title: project.title, company: project.company, role: project.role, deadline: project.deadline, status: project.status, result_rewarded: project.resultRewarded }); if (error) throw error }

export const supabaseServices = {
  async init() {
    if (initialized) return
    initialized = true
    client.auth.onAuthStateChange(() => { void refresh().catch(console.error) })
    await refresh()
  },
  getState: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
  refresh,
  auth: {
    async signIn() { const redirectTo = `${window.location.origin}/auth/callback`; const { error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }); if (error) throw error },
    async signOut() { const { error } = await client.auth.signOut(); if (error) throw error; setState(emptyState()) },
  },
  updateProfile(profile: Partial<AppState["profile"]>) { patch((current) => ({ ...current, profile: { ...current.profile, ...profile } })); void persistProfile({ ...state.profile, ...profile }).catch(() => void refresh()) },
  projects: {
    create(input: Omit<Project, "id" | "createdAt" | "status" | "resultRewarded">) {
      const project: Project = { ...input, id: id(), status: "pending", resultRewarded: false, createdAt: now() }
      patch((current) => ({ ...current, projects: [project, ...current.projects], essays: { ...current.essays, [project.id]: [] } }))
      void persistProject(project).catch(() => void refresh())
      return project
    },
    update(projectId: string, input: Pick<Project, "company" | "role" | "title" | "deadline">) { patch((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, ...input } : project) })); const project = state.projects.find((item) => item.id === projectId); if (project) void persistProject(project).catch(() => void refresh()) },
    setFiles(projectId: string, fileIds: string[]) { patch((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, fileIds: [...new Set(fileIds)] } : project) })); void (async () => { await client.from("project_files").delete().eq("project_id", projectId); const rows = [...new Set(fileIds)].map((fileId) => ({ project_id: projectId, file_id: fileId })); if (rows.length) { const { error } = await client.from("project_files").insert(rows); if (error) throw error } })().catch(() => void refresh()) },
    updateStatus(projectId: string, status: ApplicationStatus) { patch((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, status } : project) })); void client.from("projects").update({ status }).eq("id", projectId).then(({ error }) => { if (error) void refresh() }) },
    archive(projectId: string) { patch((current) => ({ ...current, projects: current.projects.filter((project) => project.id !== projectId) })); void client.from("projects").update({ archived_at: now() }).eq("id", projectId).then(({ error }) => { if (error) void refresh() }) },
  },
  files: {
    async add(file: File, projectId?: string) {
      const validationError = validateEvidenceFile(file.name, file.size)
      if (validationError) throw new Error(validationError)
      const user = await requireUser(); const fileId = id(); const path = `${user.id}/quarantine/${fileId}/${file.name}`
      const { error: uploadError } = await client.storage.from("evidence-files").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" }); if (uploadError) throw uploadError
      const { data, error } = await client.from("evidence_files").insert({ id: fileId, user_id: user.id, original_name: file.name, storage_path: path, byte_size: file.size, mime_type: file.type || "application/octet-stream", extraction_status: "pending", file_state: "quarantined" }).select().single()
      if (error) { await client.storage.from("evidence-files").remove([path]); throw error }
      const record = fileFromRow(data); patch((current) => ({ ...current, files: [record, ...current.files], projects: projectId ? current.projects.map((project) => project.id === projectId ? { ...project, fileIds: [...project.fileIds, record.id] } : project) : current.projects }))
      if (projectId) await client.from("project_files").insert({ project_id: projectId, file_id: fileId })
      void client.functions.invoke("process-evidence", { body: { fileId } }).catch(() => undefined)
      return record
    },
    async retry(file: EvidenceFile) {
      const { error } = await client.functions.invoke("process-evidence", { body: { fileId: file.id } })
      if (error) {
        const payload = await (error as any).context?.json?.().catch(() => null)
        const { data } = await client.from("evidence_files").select("extraction_error").eq("id", file.id).maybeSingle()
        throw new Error(data?.extraction_error || payload?.error || "파일 처리에 실패했습니다. 잠시 후 다시 시도해주세요.")
      }
      await refresh()
    },
    async download(file: EvidenceFile) { const row = await fileRowForOwner(file); const { data, error } = await client.storage.from("evidence-files").createSignedUrl(row.storage_path, 60); if (error) throw error; const anchor = document.createElement("a"); anchor.href = data.signedUrl; anchor.download = file.name; anchor.click() },
    async open(file: EvidenceFile) { const row = await fileRowForOwner(file); const { data, error } = await client.storage.from("evidence-files").createSignedUrl(row.storage_path, 60); if (error) throw error; return data.signedUrl },
    async remove(file: EvidenceFile) { const row = await client.from("evidence_files").select("storage_path").eq("id", file.id).single(); if (row.error) throw row.error; await client.storage.from("evidence-files").remove([row.data.storage_path]); const { error } = await client.from("evidence_files").delete().eq("id", file.id); if (error) throw error; patch((current) => ({ ...current, files: current.files.filter((item) => item.id !== file.id), projects: current.projects.map((project) => ({ ...project, fileIds: project.fileIds.filter((fileId) => fileId !== file.id) })) })) },
    async extractText(file: EvidenceFile) { const { data, error } = await client.from("evidence_files").select("extracted_text,extraction_status").eq("id", file.id).single(); if (error) throw error; if (data.extraction_status === "done") return data.extracted_text ?? ""; return "" },
  },
  essays: {
    create(projectId: string) { const next = state.essays[projectId] ?? []; const essay: Essay = { id: id(), projectId, title: `문항 ${next.length + 1}`, question: "", answer: "", order: next.length, updatedAt: now() }; patch((current) => ({ ...current, essays: { ...current.essays, [projectId]: [...(current.essays[projectId] ?? []), essay] } })); void client.from("essays").insert({ id: essay.id, project_id: projectId, title: essay.title, question: "", answer: "", position: essay.order }).then(({ error }) => { if (error) void refresh() }); return essay },
    save(projectId: string, essayId: string, input: Partial<Pick<Essay, "title" | "question" | "answer">>) { const existing = state.essays[projectId]?.find((essay) => essay.id === essayId); if (!existing) return; const updated = { ...existing, ...input, updatedAt: now(), version: (existing.version ?? 1) + 1 }; patch((current) => ({ ...current, essays: { ...current.essays, [projectId]: (current.essays[projectId] ?? []).map((essay) => essay.id === essayId ? updated : essay) } })); void client.from("essays").update({ title: updated.title, question: updated.question, answer: updated.answer }).eq("id", essayId).eq("version", existing.version ?? 1).select().maybeSingle().then(({ data, error }) => { if (error || !data) void refresh() }) },
    remove(projectId: string, essayId: string) { patch((current) => ({ ...current, essays: { ...current.essays, [projectId]: (current.essays[projectId] ?? []).filter((essay) => essay.id !== essayId).map((essay, index) => ({ ...essay, order: index })) } })); void client.from("essays").delete().eq("id", essayId).then(({ error }) => { if (error) void refresh() }) },
  },
  credits: { spend: () => false, reward: () => false, charge: () => undefined },
  startChat(projectId: string) { const session: ChatSession = { id: id(), title: "새 대화", messages: [], createdAt: now(), updatedAt: now() }; patch((current) => ({ ...current, chats: { ...current.chats, [projectId]: [session, ...(current.chats[projectId] ?? [])] } })); void requireUser().then((user) => client.from("chat_sessions").insert({ id: session.id, project_id: projectId, user_id: user.id, title: session.title })).then(({ error }) => { if (error) void refresh() }); return session },
  async sendChat(projectId: string, sessionId: string, prompt: string, contextIds: string[] = []) { const { data, error } = await client.functions.invoke("ai-chat", { body: { projectId, sessionId, prompt, contextIds, requestId: id() } }); if (error) { const fn = await describeFunctionError(error); return { ok: false, error: fn.message, insufficientCredits: fn.insufficientCredits } } await refresh(); return { ok: true, preview: data?.preview } },
  acceptSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number) { return applySuggestionDecision(projectId, sessionId, messageId, suggestionId, changeIndex, "accepted") },
  rejectSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number) { return applySuggestionDecision(projectId, sessionId, messageId, suggestionId, changeIndex, "rejected") },
  async runAnalysis(projectId: string) { const { data, error } = await client.functions.invoke("analyze-project", { body: { projectId, requestId: id() } }); if (error) { const fn = await describeFunctionError(error); return { ok: false, error: fn.message, insufficientCredits: fn.insufficientCredits } } await refresh(); return { ok: true, cached: Boolean(data?.cached) } },
  async contribute(input: any) { const { data, error } = await client.functions.invoke("index-contribution", { body: { ...input, consentVersion: "2026-10-v1" } }); if (error) throw error; await refresh(); return data },
  setContributionDraft(draft: typeof contributionDraft) { contributionDraft = draft },
  takeContributionDraft() { const draft = contributionDraft; contributionDraft = null; return draft },
}

// Edge Function 오류를 사용자 친화적으로 해석한다. supabase-js의 FunctionsHttpError는
// 원본 Response를 error.context에 담아둔다. 여기서 상태 코드(402=크레딧 부족)와
// 응답 본문의 error 메시지를 꺼내, 호출부가 "에러"가 아니라 "크레딧 부족 안내"로
// 구분해 다룰 수 있게 한다.
async function describeFunctionError(error: any): Promise<{ message: string; insufficientCredits: boolean }> {
  const context = error?.context
  const status: number | undefined = typeof context?.status === "number" ? context.status : undefined
  let bodyMessage: string | undefined
  if (context && typeof context.json === "function") {
    try { const body = await context.clone().json(); bodyMessage = typeof body?.error === "string" ? body.error : undefined }
    catch { /* 본문이 JSON이 아니면 무시 */ }
  }
  const insufficientCredits = status === 402 || (bodyMessage?.includes("크레딧이 부족") ?? false)
  return { message: bodyMessage ?? error?.message ?? "요청을 처리하지 못했습니다.", insufficientCredits }
}

async function fileRowForOwner(file: EvidenceFile) {
  const { data: row, error } = await client.from("evidence_files").select("storage_path").eq("id", file.id).single()
  if (error || !row) throw error ?? new Error("파일을 찾을 수 없습니다.")
  return row
}

function applySuggestionDecision(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number, decision: "accepted" | "rejected") {
  const session = state.chats[projectId]?.find((item) => item.id === sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  const suggestion = message?.suggestions?.find((item) => item.id === suggestionId)
  if (!session || !message || !suggestion) return undefined
  const parts = createInlineDiff(suggestion.before, suggestion.after)
  const changes = parts.filter((part) => part.kind === "change")
  const decisions = Array.from({ length: changes.length }, (_, index) => suggestion.changeStatuses?.[index] ?? "pending")
  if (decisions[changeIndex] !== "pending") return undefined
  decisions[changeIndex] = decision
  let cursor = 0
  const answer = parts.map((part) => part.kind === "equal" ? part.text : decisions[cursor++] === "accepted" ? part.after : part.before).join("")
  const status = decisions.every((item) => item === "accepted") ? "accepted" : decisions.every((item) => item === "rejected") ? "rejected" : "partial"
  const nextSuggestions = message.suggestions?.map((item) => item.id === suggestionId ? { ...item, status, changeStatuses: decisions } : item) ?? []
  patch((current) => ({ ...current, essays: { ...current.essays, [projectId]: (current.essays[projectId] ?? []).map((essay) => essay.id === suggestion.essayId ? { ...essay, answer, updatedAt: now() } : essay) }, chats: { ...current.chats, [projectId]: (current.chats[projectId] ?? []).map((chat) => chat.id === sessionId ? { ...chat, messages: chat.messages.map((item) => item.id === messageId ? { ...item, suggestions: nextSuggestions } : item), updatedAt: now() } : chat) } }))
  const essay = state.essays[projectId]?.find((item) => item.id === suggestion.essayId)
  void Promise.all([
    client.from("chat_messages").update({ suggestions: nextSuggestions }).eq("id", messageId),
    essay ? client.from("essays").update({ answer }).eq("id", essay.id).eq("version", essay.version ?? 1) : Promise.resolve({ error: null }),
  ]).then((results: any[]) => { if (results.some((result) => result.error)) void refresh() })
  return answer
}
