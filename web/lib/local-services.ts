"use client"

import type {
  AnalysisReport,
  AppState,
  AuthService,
  ChatMessage,
  ChatSession,
  CreditService,
  Essay,
  EssayRepository,
  EvidenceFile,
  FileRepository,
  Project,
  ProjectRepository,
} from "./domain"
import { createInlineDiff } from "./essay-diff"
import { createSyntheticEssays } from "./synthetic-data"

const STORAGE_KEY = "coverletteride:v1"
const DB_NAME = "coverletteride-files"
const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const monthKey = () => new Date().toISOString().slice(0, 7)

const seedState = (): AppState => {
  const projectId = "demo-project"
  return {
    version: 3,
    user: null,
    profile: {
      school: "한국대학교",
      major: "경영학과 · 컴퓨터공학과 복수전공",
      graduation: "2027년 2월 졸업 예정",
      experiences: "교내 데이터 분석 학회 DAON 회장\n스타트업 서비스 운영 인턴 6개월",
      awards: "2025 대학생 비즈니스 아이디어 경진대회 우수상",
    },
    files: [],
    projects: [
      {
        id: projectId,
        title: "핀테크 서비스 기획 인턴",
        company: "넥스트파이낸스",
        role: "서비스 기획",
        deadline: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10),
        status: "pending",
        fileIds: [],
        resultRewarded: false,
        createdAt: now(),
      },
    ],
    essays: {
      [projectId]: [{
        id: "demo-essay-1",
        projectId,
        title: "문항 1",
        question: "지원 동기와 직무 역량을 경험 중심으로 작성해 주세요.",
        answer:
          "사용자의 문제를 데이터로 정의하고, 팀과 함께 해결하는 서비스 기획자가 되고 싶습니다.\n\n교내 데이터 분석 학회에서 신입 회원 이탈률이 높다는 문제를 발견했습니다. 설문과 참여 로그를 분석해 온보딩 과정을 개선했고, 정기 세션 참석률을 높일 수 있었습니다. 이 경험을 바탕으로 고객의 행동을 세심하게 관찰하고 실행 가능한 제품 개선안으로 연결하겠습니다.",
        order: 0,
        updatedAt: now(),
      }],
    },
    chats: {},
    reports: [],
    contributions: [],
    transactions: [
      { id: id(), amount: 1000, reason: "9월 기본 크레딧", referenceId: monthKey(), createdAt: now() },
    ],
    creditBalance: 1000,
    creditMonth: monthKey(),
  }
}

/**
 * v1의 단일 본문과 v2의 단일 채팅 목록을 최신 구조로 변환한다. 저장 데이터를
 * 지우지 않고 스키마만 승격하므로 기존 작성 내용과 AI 대화를 그대로 이어갈 수 있다.
 */
function migrateState(value: unknown): AppState {
  const saved = value as Partial<Omit<AppState, "version" | "essays" | "chats" | "contributions">> & {
    version?: number
    essays?: Record<string, Essay[] | { projectId: string; content: string; updatedAt: string }>
    chats?: Record<string, ChatMessage[] | ChatSession[]>
    contributions?: Array<Record<string, unknown>>
  }
  if (saved.version === 3) return saved as unknown as AppState
  const fallback = seedState()
  const migratedEssays = Object.fromEntries(
    Object.entries(saved.essays ?? {}).map(([projectId, essay]) => {
      if (Array.isArray(essay)) return [projectId, essay]
      const legacy = essay as { content?: string; updatedAt?: string }
      return [projectId, [{ id: `migrated-${projectId}`, projectId, title: "문항 1", question: "자기소개서 문항", answer: legacy.content ?? "", order: 0, updatedAt: legacy.updatedAt ?? now() }]]
    }),
  )
  const legacyContributions = (saved.contributions ?? []) as unknown as Array<Record<string, unknown>>
  const contributions = legacyContributions.map((item) => ({
    ...item,
    applicationPeriod: typeof item.applicationPeriod === "string" ? item.applicationPeriod : "",
    questions: Array.isArray(item.questions) ? item.questions : [{ question: "자기소개서 문항", answer: String(item.content ?? "") }],
  })) as AppState["contributions"]
  const chats = Object.fromEntries(Object.entries(saved.chats ?? {}).map(([projectId, items]) => {
    if (!items.length) return [projectId, []]
    if ("messages" in items[0]) return [projectId, items as ChatSession[]]
    const messages = items as ChatMessage[]
    return [projectId, [{ id: `migrated-chat-${projectId}`, title: "이전 대화", messages, createdAt: messages[0]?.createdAt ?? now(), updatedAt: messages[messages.length - 1]?.createdAt ?? now() }]]
  }))
  return { ...fallback, ...saved, version: 3, essays: migratedEssays, contributions, chats }
}

let state: AppState = seedState()
let initialized = false
const listeners = new Set<() => void>()

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  listeners.forEach((listener) => listener())
}

function ensureMonthlyCredits() {
  if (state.creditMonth === monthKey()) return
  state = {
    ...state,
    creditMonth: monthKey(),
    creditBalance: 1000,
    transactions: [
      ...state.transactions,
      { id: id(), amount: 1000, reason: "월 기본 크레딧 갱신", referenceId: monthKey(), createdAt: now() },
    ],
  }
  persist()
}

function init() {
  if (initialized || typeof window === "undefined") return
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      state = migrateState(JSON.parse(saved))
    } catch {
      state = seedState()
    }
  }
  initialized = true
  ensureMonthlyCredits()
}

function update(recipe: (current: AppState) => AppState) {
  init()
  state = recipe(state)
  persist()
}

function hash(value: string) {
  let result = 5381
  for (const char of value) result = (result * 33) ^ char.charCodeAt(0)
  return (result >>> 0).toString(36)
}

/** 사용자의 표현에서 핵심 수정 목표를 골라 모의 AI 답변도 제안의 이유를 설명하게 한다. */
function describeReviewPurpose(prompt: string, role: string) {
  const purposes: string[] = []
  if (/수치|성과|정량|결과/.test(prompt)) purposes.push("성과의 전후 변화가 보이도록 수치와 결과를 구체화하고")
  if (/직무|지원|회사|연결|동기/.test(prompt)) purposes.push(`경험이 ${role} 직무에서 발휘할 역량으로 자연스럽게 이어지게 하고`)
  if (/어조|톤|통일|문체/.test(prompt)) purposes.push("문장마다 달랐던 어조와 호흡을 일관되게 맞추고")
  if (/구체|경험|행동|STAR/.test(prompt)) purposes.push("문제 상황과 본인의 행동이 선명하게 드러나게 하는 데 초점을 맞췄습니다")
  if (!purposes.length) return `핵심 경험이 문제·행동·결과 순서로 읽히고 ${role} 직무와의 연결이 분명해지도록 다듬었습니다.`
  const last = purposes.pop()
  return `${purposes.length ? `${purposes.join(", ")} ` : ""}${last?.replace(/하고$/, "하는 데 초점을 맞췄습니다")}`
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("files")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function putBlob(key: string, blob: Blob) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite")
    tx.objectStore("files").put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function getBlob(key: string) {
  const db = await openDb()
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(key)
    request.onsuccess = () => resolve(request.result as Blob | undefined)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return blob
}

/**
 * 모든 UI는 아래 서비스 객체만 사용한다. 지금은 브라우저 저장소에 기록하지만,
 * Supabase 전환 시 이 구현만 Postgres/Storage/RPC 호출로 바꾸면 화면 코드는 유지된다.
 */
export const localServices = {
  init,
  getState: () => {
    init()
    return state
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  auth: {
    signIn() {
      update((s) => ({ ...s, user: { id: "demo-user", name: "김커리어", email: "career@example.com" } }))
    },
    signOut() {
      update((s) => ({ ...s, user: null }))
    },
  } satisfies AuthService,
  updateProfile(profile: Partial<AppState["profile"]>) {
    update((s) => ({ ...s, profile: { ...s.profile, ...profile } }))
  },
  projects: {
    create(input) {
      const project: Project = { ...input, id: id(), status: "pending", resultRewarded: false, createdAt: now() }
      update((s) => ({
        ...s,
        projects: [...s.projects, project],
        essays: { ...s.essays, [project.id]: [{ id: id(), projectId: project.id, title: "문항 1", question: "", answer: "", order: 0, updatedAt: now() }] },
      }))
      return project
    },
    update(projectId, input) {
      update((s) => ({ ...s, projects: s.projects.map((project) => project.id === projectId ? { ...project, ...input } : project) }))
    },
    setFiles(projectId, fileIds) {
      update((s) => ({ ...s, projects: s.projects.map((project) => project.id === projectId ? { ...project, fileIds: [...new Set(fileIds)] } : project) }))
    },
    updateStatus(projectId, status) {
      const project = state.projects.find((item) => item.id === projectId)
      if (!project) return
      const shouldReward = status !== "pending" && !project.resultRewarded
      update((s) => ({
        ...s,
        projects: s.projects.map((item) =>
          item.id === projectId ? { ...item, status, resultRewarded: item.resultRewarded || shouldReward } : item,
        ),
        creditBalance: s.creditBalance + (shouldReward ? 500 : 0),
        transactions: shouldReward
          ? [...s.transactions, { id: id(), amount: 500, reason: "지원 결과 기여", referenceId: projectId, createdAt: now() }]
          : s.transactions,
      }))
    },
  } satisfies ProjectRepository,
  files: {
    async add(file: File, projectId?: string) {
      const extension = file.name.split(".").pop()?.toLowerCase()
      if (!extension || !["pdf", "jpg", "jpeg", "png", "doc", "docx", "hwpx"].includes(extension)) {
        throw new Error("지원하지 않는 파일 형식입니다.")
      }
      const record: EvidenceFile = { id: id(), name: file.name, size: file.size, type: file.type, createdAt: now() }
      // 메타데이터와 원본 Blob을 분리한다. 이는 Supabase의 DB 행과 Storage 객체 구조에 대응한다.
      await putBlob(record.id, file)
      update((s) => ({
        ...s,
        files: [...s.files, record],
        projects: projectId
          ? s.projects.map((project) =>
              project.id === projectId ? { ...project, fileIds: [...project.fileIds, record.id] } : project,
            )
          : s.projects,
      }))
      return record
    },
    async download(file) {
      const blob = await getBlob(file.id)
      if (!blob) throw new Error("파일 원본을 찾을 수 없습니다.")
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = file.name
      anchor.click()
      URL.revokeObjectURL(url)
    },
  } satisfies FileRepository,
  essays: {
    create(projectId) {
      const essays = state.essays[projectId] ?? []
      const essay: Essay = { id: id(), projectId, title: `문항 ${essays.length + 1}`, question: "", answer: "", order: essays.length, updatedAt: now() }
      update((s) => ({ ...s, essays: { ...s.essays, [projectId]: [...(s.essays[projectId] ?? []), essay] } }))
      return essay
    },
    save(projectId, essayId, input) {
      update((s) => ({
        ...s,
        essays: { ...s.essays, [projectId]: (s.essays[projectId] ?? []).map((essay) => essay.id === essayId ? { ...essay, ...input, updatedAt: now() } : essay) },
      }))
    },
  } satisfies EssayRepository,
  credits: {
    spend(amount, reason, referenceId) {
      if (state.creditBalance < amount) return false
      update((s) => ({
        ...s,
        creditBalance: s.creditBalance - amount,
        transactions: [...s.transactions, { id: id(), amount: -amount, reason, referenceId, createdAt: now() }],
      }))
      return true
    },
    reward(amount, reason, referenceId) {
      // referenceId는 서버 전환 시 idempotency key가 된다. 같은 행위의 중복 보상을 차단한다.
      if (state.transactions.some((item) => item.amount > 0 && item.referenceId === referenceId)) return false
      update((s) => ({
        ...s,
        creditBalance: s.creditBalance + amount,
        transactions: [...s.transactions, { id: id(), amount, reason, referenceId, createdAt: now() }],
      }))
      return true
    },
  } satisfies CreditService,
  startChat(projectId: string) {
    const session: ChatSession = { id: id(), title: "새 대화", messages: [], createdAt: now(), updatedAt: now() }
    update((s) => ({ ...s, chats: { ...s.chats, [projectId]: [session, ...(s.chats[projectId] ?? [])] } }))
    return session
  },
  sendChat(projectId: string, sessionId: string, prompt: string, contextIds: string[] = []) {
    if (!localServices.credits.spend(10, "AI 코치 사용", id())) return { ok: false, error: "크레딧이 부족합니다." }
    const projectEssays = state.essays[projectId] ?? []
    const referencedEssayIds = contextIds.filter((value) => value.startsWith("essay:")).map((value) => value.slice(6))
    const targets = projectEssays.filter((essay) => referencedEssayIds.includes(essay.id))
    const selectedTargets = targets.length ? targets : projectEssays.slice(0, 1)
    const referenceNames = contextIds.map((value) => {
      const [type, referenceId] = value.split(":")
      if (type === "essay") return projectEssays.find((essay) => essay.id === referenceId)?.title
      return state.files.find((file) => file.id === referenceId)?.name
    }).filter((value): value is string => Boolean(value))
    const role = state.projects.find((item) => item.id === projectId)?.role ?? "지원 직무"
    const suggestions = selectedTargets.map((essay) => {
      const before = essay.answer
      // 서로 떨어진 문장을 수정해 실제 에이전트가 여러 위치를 편집하는 모습을 재현한다.
      const clarified = before.replace("사용자의 문제를 데이터로 정의하고, 팀과 함께 해결하는 서비스 기획자가 되고 싶습니다.", "사용자 행동 데이터를 바탕으로 문제를 정의하고, 팀과 함께 실행 가능한 개선안을 만드는 서비스 기획자가 되겠습니다.")
      const quantified = clarified.replace(/높일 수 있었습니다/g, "18%에서 31%로 높였습니다")
      const after = quantified
        ? `${quantified}\n\n이 경험을 통해 데이터를 실행 가능한 개선안으로 연결하는 역량을 길렀으며, 이를 ${role} 업무에서도 발휘하겠습니다.`
        : "문제 상황을 구체적으로 설명하고, 내가 취한 행동과 수치로 확인한 결과를 차례로 작성해 보세요."
      const changeCount = createInlineDiff(before, after).filter((part) => part.kind === "change").length
      return { id: id(), essayId: essay.id, essayTitle: essay.title, before, after, summary: "여러 문장의 표현과 근거를 다듬었습니다.", status: "pending" as const, changeStatuses: Array.from({ length: changeCount }, () => "pending" as const) }
    })
    const response = suggestions.length
      ? `${describeReviewPurpose(prompt, role)} 원문의 의미는 유지하면서 수정 지점을 나눴으니, 필요한 변경만 골라 반영해 주세요.`
      : "수정할 자소서 문항을 찾지 못했습니다. @로 문항 파일을 선택해 주세요."
    const userMessage = { id: id(), role: "user" as const, content: prompt, createdAt: now() }
    const assistantMessage = {
      id: id(), role: "assistant" as const, content: response,
      reasoning: ["요청한 수정 방향과 태그된 자료를 확인했습니다.", "답변에서 구체성이 부족한 성과와 직무 연결 문장을 찾았습니다.", "원문을 보존한 상태로 적용 가능한 수정안을 생성했습니다."],
      references: referenceNames,
      suggestions,
      createdAt: now(),
    }
    update((s) => ({
      ...s,
      chats: {
        ...s.chats,
        [projectId]: (s.chats[projectId] ?? []).map((session) => session.id === sessionId ? {
          ...session,
          title: session.messages.length ? session.title : prompt.slice(0, 28),
          messages: [...session.messages, userMessage, assistantMessage],
          updatedAt: now(),
        } : session),
      },
    }))
    return { ok: true, preview: suggestions[0] ? { messageId: assistantMessage.id, suggestionId: suggestions[0].id, essayId: suggestions[0].essayId } : undefined }
  },
  acceptSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number) {
    const session = state.chats[projectId]?.find((item) => item.id === sessionId)
    const message = session?.messages.find((item) => item.id === messageId)
    const suggestion = message?.suggestions?.find((item) => item.id === suggestionId)
    if (!suggestion) return
    const parts = createInlineDiff(suggestion.before, suggestion.after)
    const count = parts.filter((part) => part.kind === "change").length
    const fallback = suggestion.status === "accepted" || suggestion.status === "rejected" ? suggestion.status : "pending"
    const decisions = Array.from({ length: count }, (_, index) => suggestion.changeStatuses?.[index] ?? fallback)
    if (!decisions[changeIndex] || decisions[changeIndex] === "accepted") return
    decisions[changeIndex] = "accepted"
    let cursor = 0
    const answer = parts.map((part) => part.kind === "equal" ? part.text : decisions[cursor++] === "accepted" ? part.after : part.before).join("")
    const status = decisions.every((item) => item === "accepted") ? "accepted" : "partial"
    update((s) => ({
      ...s,
      essays: {
        ...s.essays,
        [projectId]: (s.essays[projectId] ?? []).map((essay) => essay.id === suggestion.essayId ? { ...essay, answer, updatedAt: now() } : essay),
      },
      chats: {
        ...s.chats,
        [projectId]: (s.chats[projectId] ?? []).map((chat) => chat.id === sessionId ? {
          ...chat,
          messages: chat.messages.map((item) => item.id === messageId ? { ...item, suggestions: item.suggestions?.map((proposal) => proposal.id === suggestionId ? { ...proposal, status, changeStatuses: decisions } : proposal) } : item),
          updatedAt: now(),
        } : chat),
      },
    }))
    return answer
  },
  rejectSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number) {
    const session = state.chats[projectId]?.find((item) => item.id === sessionId)
    const message = session?.messages.find((item) => item.id === messageId)
    const suggestion = message?.suggestions?.find((item) => item.id === suggestionId)
    if (!suggestion) return
    const parts = createInlineDiff(suggestion.before, suggestion.after)
    const count = parts.filter((part) => part.kind === "change").length
    const fallback = suggestion.status === "accepted" || suggestion.status === "rejected" ? suggestion.status : "pending"
    const decisions = Array.from({ length: count }, (_, index) => suggestion.changeStatuses?.[index] ?? fallback)
    if (!decisions[changeIndex] || decisions[changeIndex] === "rejected") return
    decisions[changeIndex] = "rejected"
    let cursor = 0
    const answer = parts.map((part) => part.kind === "equal" ? part.text : decisions[cursor++] === "accepted" ? part.after : part.before).join("")
    const status = decisions.every((item) => item === "rejected") ? "rejected" : "partial"
    update((s) => ({
      ...s,
      essays: {
        ...s.essays,
        [projectId]: (s.essays[projectId] ?? []).map((essay) => essay.id === suggestion.essayId ? { ...essay, answer, updatedAt: now() } : essay),
      },
      chats: {
        ...s.chats,
        [projectId]: (s.chats[projectId] ?? []).map((chat) => chat.id === sessionId ? {
          ...chat,
          messages: chat.messages.map((item) => item.id === messageId ? { ...item, suggestions: item.suggestions?.map((proposal) => proposal.id === suggestionId ? { ...proposal, status, changeStatuses: decisions } : proposal) } : item),
          updatedAt: now(),
        } : chat),
      },
    }))
    return answer
  },
  runAnalysis(projectId: string) {
    const project = state.projects.find((item) => item.id === projectId)
    const essay = (state.essays[projectId] ?? []).map((item) => `${item.question}\n${item.answer}`).join("\n\n")
    if (!project) return { ok: false, error: "프로젝트를 찾을 수 없습니다." }
    // 프로필이나 본문이 바뀌면 키도 달라져 과거 분석이 자연스럽게 무효화된다.
    const cacheKey = hash(JSON.stringify({ profile: state.profile, essay, project: [project.company, project.role] }))
    if (state.reports.some((report) => report.cacheKey === cacheKey)) return { ok: true, cached: true }
    if (!localServices.credits.spend(100, "AI 분석 리포트", projectId + cacheKey)) {
      return { ok: false, error: "분석에 필요한 100 크레딧이 부족합니다." }
    }
    const score = Math.min(92, 42 + Math.floor(essay.length / 12) + (state.profile.experiences ? 8 : 0))
    const topTwenty = createSyntheticEssays().sort((a, b) => b.similarity - a.similarity).slice(0, 20)
    const passedMatches = topTwenty.filter((item) => item.result === "passed").slice(0, 5).length
    const failedMatches = topTwenty.filter((item) => item.result === "failed").slice(0, 5).length
    const report: AnalysisReport = {
      id: id(), projectId, cacheKey, score,
      strengths: ["문제 발견부터 개선까지 경험의 흐름이 명확합니다.", "지원 직무와 연결되는 협업 경험이 드러납니다."],
      weaknesses: ["성과를 입증할 구체적인 수치가 부족합니다.", "회사와 서비스에 대한 지원 동기가 다소 일반적입니다."],
      suggestions: ["참석률 개선 전후 수치를 한 문장으로 추가하세요.", `${project.company}의 실제 서비스 문제와 경험을 직접 연결하세요.`, "마지막 문장을 입사 후 실행 계획으로 바꾸세요."],
      passedMatches, failedMatches, createdAt: now(),
    }
    update((s) => ({ ...s, reports: [...s.reports, report] }))
    return { ok: true, cached: false }
  },
  contribute(input: Omit<AppState["contributions"][number], "id" | "createdAt">) {
    const contribution = { ...input, id: id(), createdAt: now() }
    update((s) => ({ ...s, contributions: [...s.contributions, contribution] }))
    localServices.credits.reward(500, "자소서 데이터 기여", contribution.id)
  },
}
