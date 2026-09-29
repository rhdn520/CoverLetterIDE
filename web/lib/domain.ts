export type ApplicationStatus = "pending" | "passed" | "failed"

export interface User {
  id: string
  name: string
  email: string
}

export interface Profile {
  school: string
  major: string
  graduation: string
  experiences: string
  awards: string
}

export interface EvidenceFile {
  id: string
  name: string
  size: number
  type: string
  createdAt: string
}

export interface Project {
  id: string
  title: string
  company: string
  role: string
  deadline: string
  status: ApplicationStatus
  fileIds: string[]
  resultRewarded: boolean
  createdAt: string
}

export interface ProjectFile {
  projectId: string
  fileId: string
}

export interface Essay {
  id: string
  projectId: string
  title: string
  question: string
  answer: string
  order: number
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  reasoning?: string[]
  references?: string[]
  suggestions?: EssaySuggestion[]
  createdAt: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface EssaySuggestion {
  id: string
  essayId: string
  essayTitle: string
  before: string
  after: string
  summary: string
  status: "pending" | "accepted" | "rejected" | "partial"
  changeStatuses?: Array<"pending" | "accepted" | "rejected">
}

export interface AnalysisReport {
  id: string
  projectId: string
  cacheKey: string
  score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  passedMatches: number
  failedMatches: number
  createdAt: string
}

export interface Contribution {
  id: string
  company: string
  role: string
  applicationPeriod: string
  result: Exclude<ApplicationStatus, "pending">
  questions: Array<{ question: string; answer: string }>
  createdAt: string
}

export interface CreditTransaction {
  id: string
  amount: number
  reason: string
  referenceId: string
  createdAt: string
}

export interface AppState {
  version: 3
  user: User | null
  profile: Profile
  files: EvidenceFile[]
  projects: Project[]
  essays: Record<string, Essay[]>
  chats: Record<string, ChatSession[]>
  reports: AnalysisReport[]
  contributions: Contribution[]
  transactions: CreditTransaction[]
  creditBalance: number
  creditMonth: string
}

export interface AuthService {
  signIn(): void
  signOut(): void
}

export interface ProjectRepository {
  create(input: Omit<Project, "id" | "createdAt" | "status" | "resultRewarded">): Project
  update(id: string, input: Pick<Project, "company" | "role" | "title" | "deadline">): void
  setFiles(id: string, fileIds: string[]): void
  updateStatus(id: string, status: ApplicationStatus): void
}

export interface FileRepository {
  add(file: File, projectId?: string): Promise<EvidenceFile>
  download(file: EvidenceFile): Promise<void>
}

export interface EssayRepository {
  create(projectId: string): Essay
  save(projectId: string, essayId: string, input: Partial<Pick<Essay, "title" | "question" | "answer">>): void
}

export interface AiService {
  chat(projectId: string, sessionId: string, prompt: string, contextIds?: string[]): { ok: boolean; error?: string; preview?: { messageId: string; suggestionId: string; essayId: string } }
  acceptSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number): string | undefined
  rejectSuggestion(projectId: string, sessionId: string, messageId: string, suggestionId: string, changeIndex: number): string | undefined
  analyze(projectId: string): { ok: boolean; cached?: boolean; error?: string }
}

export interface CreditService {
  spend(amount: number, reason: string, referenceId: string): boolean
  reward(amount: number, reason: string, referenceId: string): boolean
}
