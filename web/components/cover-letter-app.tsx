"use client"

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeft, Award, BarChart3, BriefcaseBusiness, CalendarDays, Check, ChevronRight,
  Coins, CreditCard, Download, Eye, FilePlus2, FileText, FolderOpen, GraduationCap, LayoutDashboard,
  History, LogOut, MessageSquareText, Paperclip, Pencil, Plus, Redo2, Send, Sparkles, Trash2, Undo2, Upload, X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Toaster } from "@/components/ui/sonner"
import { useAppState } from "@/hooks/use-app-state"
import { createInlineDiff } from "@/lib/essay-diff"
import { supabaseServices as localServices } from "@/lib/supabase/services"
import type { AppState, ApplicationStatus, ChatSession, Essay, EssaySuggestion, EvidenceFile, Project } from "@/lib/domain"

const statusLabel: Record<ApplicationStatus, string> = { pending: "대기중", passed: "합격", failed: "불합격" }
type ProposalRef = { sessionId: string; messageId: string; suggestionId: string }
const daysLeft = (date: string) => Math.ceil((new Date(date + "T23:59:59").getTime() - Date.now()) / 86400000)
const formatBytes = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`

function Logo() {
  return <div className="flex items-center gap-2.5"><div className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950/20"><FileText className="size-5" /></div><span className="text-lg font-bold tracking-[-0.03em]">CoverLetter<span className="text-blue-500">IDE</span></span></div>
}

function AppHeader({ state }: { state: AppState }) {
  const router = useRouter()
  return <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8"><button onClick={() => router.push("/hub")}><Logo /></button><nav className="hidden items-center gap-1 md:flex" aria-label="주요 메뉴"><NavButton icon={FolderOpen} label="프로젝트 허브" onClick={() => router.push("/hub")} /><NavButton icon={FilePlus2} label="자소서 기여" onClick={() => router.push("/contribute")} /></nav><div className="flex items-center gap-3"><button title="크레딧 충전" onClick={() => router.push("/credits")} className="credit-pill transition hover:bg-amber-100"><Coins className="size-4" /><strong>{state.creditBalance.toLocaleString()}</strong><span className="hidden sm:inline">크레딧</span></button><button title="로그아웃" onClick={() => { localServices.auth.signOut(); router.push("/login") }} className="icon-button"><LogOut className="size-4" /></button></div></header>
}

function NavButton({ icon: Icon, label, onClick }: { icon: typeof FolderOpen; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Icon className="size-4" />{label}</button>
}

export function CoverLetterApp() {
  const state = useAppState()
  const pathname = usePathname()
  const router = useRouter()
  const isWorkspace = /^\/projects\/[^/]+\/workspace$/.test(pathname)
  useEffect(() => { if (state && !state.user && pathname !== "/login" && pathname !== "/") router.replace("/login") }, [state, pathname, router])
  if (!state) return <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">워크스페이스를 불러오는 중…</div>
  if (!state.user || pathname === "/login" || pathname === "/") return <RealLoginPage />
  const workspace = pathname.match(/^\/projects\/([^/]+)\/workspace$/)
  const dashboard = pathname.match(/^\/projects\/([^/]+)\/dashboard$/)
  let page = <HubPage state={state} />
  if (pathname === "/contribute") page = <RealContributePage state={state} />
  if (pathname === "/contributions") page = <ContributionHistoryPage state={state} />
  if (pathname === "/credits") page = <RealCreditPage state={state} />
  if (workspace) page = <WorkspacePage state={state} projectId={workspace[1]} />
  if (dashboard) page = <LegacyDashboardRoute state={state} projectId={dashboard[1]} />
  return <div className="min-h-screen bg-slate-50 text-slate-950">{!isWorkspace && <AppHeader state={state} />}{page}<Toaster position="bottom-right" /></div>
}

function RealLoginPage() {
  const [loading, setLoading] = useState(false)
  const startGoogleLogin = async () => {
    setLoading(true)
    try { await localServices.auth.signIn() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Google 로그인을 시작하지 못했습니다."); setLoading(false) }
  }
  return <main className="login-shell"><div className="login-aside"><Logo /><div className="relative z-10 max-w-lg"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1.5 text-sm font-semibold text-blue-200"><Sparkles className="size-4" />취업 준비를 한 곳에서</div><h1 className="text-4xl font-bold leading-[1.15] tracking-[-0.04em] text-white sm:text-6xl">흩어진 경험을 모아<br />설득력 있는 이야기로.</h1><p className="mt-6 max-w-md text-lg leading-8 text-slate-300">자료 관리부터 기업별 자소서 작성, AI 피드백과 지원 결과 기록까지 하나의 워크스페이스에서 이어가세요.</p></div></div><section className="grid min-h-[50vh] place-items-center bg-white p-6 sm:p-12"><div className="w-full max-w-sm"><p className="text-sm font-bold text-blue-600">COVERLETTERIDE</p><h2 className="mt-3 text-3xl font-bold tracking-tight">Google 계정으로 시작하세요</h2><p className="mt-2 text-slate-500">작성한 자료는 본인만 열람할 수 있도록 보호됩니다.</p><Button disabled={loading} className="mt-8 h-12 w-full bg-blue-600 text-base hover:bg-blue-700" onClick={() => void startGoogleLogin()}>{loading ? "Google로 이동하는 중…" : "Google로 계속하기"} <ChevronRight /></Button><p className="mt-5 text-center text-xs leading-5 text-slate-400">로그인하면 서비스 이용 및 기여 데이터 처리에 필요한 세션이 생성됩니다.</p></div></section></main>
}

function RealContributePage({ state }: { state: AppState }) {
  const router = useRouter()
  const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [applicationPeriod, setPeriod] = useState(""); const [result, setResult] = useState<"passed" | "failed">("passed")
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [consented, setConsented] = useState(false); const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!company.trim() || !role.trim() || !applicationPeriod || !question.trim() || answer.trim().length < 100 || !consented) { toast.error("회사·직무·시기·문항·100자 이상 답변과 데이터 활용 동의가 필요합니다."); return }
    setSaving(true)
    try { await localServices.contribute({ company, role, applicationPeriod, result, questions: [{ question, answer }] }); toast.success("기여가 검증되어 500 크레딧을 지급했습니다."); router.push("/contributions") }
    catch (error) { toast.error(error instanceof Error ? error.message : "기여를 저장하지 못했습니다.") }
    finally { setSaving(false) }
  }
  return <main className="page-wrap max-w-3xl"><section className="mb-8"><p className="eyebrow">DATA CONTRIBUTION</p><h1 className="page-title">과거 자소서 기여</h1><p className="page-subtitle">검증된 기여는 익명화되어 유사 사례 분석에만 사용되며, 500 보상 크레딧을 지급합니다.</p></section><form onSubmit={submit} className="surface-card space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><label><span className="form-label">회사명</span><input className="text-input" value={company} onChange={(event) => setCompany(event.target.value)} /></label><label><span className="form-label">지원 직무</span><input className="text-input" value={role} onChange={(event) => setRole(event.target.value)} /></label><label><span className="form-label">지원 시기</span><input className="text-input" type="month" value={applicationPeriod} onChange={(event) => setPeriod(event.target.value)} /></label><label><span className="form-label">지원 결과</span><select className="text-input" value={result} onChange={(event) => setResult(event.target.value as "passed" | "failed")}><option value="passed">합격</option><option value="failed">불합격</option></select></label></div><label><span className="form-label">자소서 문항</span><textarea className="question-editor" value={question} onChange={(event) => setQuestion(event.target.value)} /></label><label><span className="form-label">답변</span><textarea className="contribution-editor" value={answer} onChange={(event) => setAnswer(event.target.value)} /><span className="mt-1 block text-right text-xs text-slate-400">{answer.trim().length} / 최소 100자</span></label><label className="flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600"><input className="mt-1" type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /> <span><strong className="text-slate-900">[v1 초안] 익명화 및 AI 분석 활용에 동의합니다.</strong><br />이름·이메일·전화번호 등 식별 정보는 제거한 뒤 유사 사례 검색과 AI 분석에만 사용됩니다. 정식 공개 전 법률 검토가 필요한 초안입니다.</span></label><Button disabled={saving} type="submit" className="h-12 w-full bg-blue-600 text-base hover:bg-blue-700">{saving ? "검증·저장 중…" : "제출하고 500 크레딧 받기"}</Button></form><p className="mt-5 text-sm text-slate-500">현재 보유 크레딧: {state.creditBalance.toLocaleString()} · <button type="button" className="font-bold text-blue-600" onClick={() => router.push("/credits")}>거래 내역 보기</button></p></main>
}

function RealCreditPage({ state }: { state: AppState }) {
  const router = useRouter()
  return <main className="page-wrap max-w-4xl"><button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />돌아가기</button><section className="mb-8"><p className="eyebrow">CREDIT</p><h1 className="page-title">크레딧</h1><p className="page-subtitle">기본 크레딧은 매월 1일 초기화되고, 기여 보상 크레딧은 유지됩니다.</p></section><div className="surface-card p-6"><div className="rounded-2xl bg-slate-950 p-6 text-white"><Coins className="size-8 text-amber-400" /><p className="mt-4 text-sm text-slate-400">현재 사용 가능 크레딧</p><p className="mt-1 text-4xl font-bold">{state.creditBalance.toLocaleString()}</p><p className="mt-4 text-sm text-slate-400">AI 코치 10 · AI 분석 100 크레딧</p></div><h2 className="mt-7 font-bold">거래 내역</h2><div className="mt-3 divide-y divide-slate-100">{state.transactions.length ? state.transactions.map((item) => <div key={item.id} className="flex items-center justify-between py-3 text-sm"><span>{item.reason}</span><strong className={item.amount > 0 ? "text-emerald-600" : "text-slate-900"}>{item.amount > 0 ? "+" : ""}{item.amount.toLocaleString()}</strong></div>) : <p className="py-8 text-center text-sm text-slate-400">거래 내역이 없습니다.</p>}</div><div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">결제 충전은 아직 준비 중입니다. 과거 자소서를 기여하면 검증 후 500 크레딧을 받을 수 있습니다.</div><Button variant="outline" className="mt-4" onClick={() => router.push("/contribute")}><FilePlus2 />자소서 기여하기</Button></div></main>
}

function LoginPage() {
  const router = useRouter()
  return <main className="login-shell"><div className="login-aside"><Logo /><div className="relative z-10 max-w-lg"><div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-400/10 px-3 py-1.5 text-sm font-semibold text-blue-200"><Sparkles className="size-4" />취업 준비를 한 곳에서</div><h1 className="text-4xl font-bold leading-[1.15] tracking-[-0.04em] text-white sm:text-6xl">흩어진 경험을 모아<br />설득력 있는 이야기로.</h1><p className="mt-6 max-w-md text-lg leading-8 text-slate-300">자료 관리부터 기업별 자소서 작성, AI 피드백과 지원 결과 기록까지 하나의 워크스페이스에서 이어가세요.</p></div><div className="relative z-10 flex flex-wrap gap-6 text-sm text-slate-400"><span>파일과 이력 통합 관리</span><span>맥락을 이해하는 AI 코치</span></div></div><section className="grid min-h-[50vh] place-items-center bg-white p-6 sm:p-12"><div className="w-full max-w-sm"><p className="text-sm font-bold text-blue-600">DEMO WORKSPACE</p><h2 className="mt-3 text-3xl font-bold tracking-tight">다시 만나서 반가워요</h2><p className="mt-2 text-slate-500">체험 계정으로 모든 목업 기능을 사용할 수 있습니다.</p><div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-full bg-blue-100 font-bold text-blue-700">김</div><div><strong className="block">김커리어</strong><span className="text-sm text-slate-500">career@example.com</span></div></div></div><Button className="mt-4 h-12 w-full bg-blue-600 text-base hover:bg-blue-700" onClick={() => { localServices.auth.signIn(); router.push("/hub") }}>체험 계정으로 시작하기 <ChevronRight /></Button><p className="mt-5 text-center text-xs leading-5 text-slate-400">입력한 내용은 현재 브라우저에만 저장됩니다.<br />실제 AI 또는 채용 서비스로 전송되지 않습니다.</p></div></section></main>
}

function HubPage({ state }: { state: AppState }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const router = useRouter()
  return <main className="page-wrap"><section className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">PROJECT HUB</p><h1 className="page-title">안녕하세요, {state.user?.name}님</h1><p className="page-subtitle">지원 현황과 나의 자료를 한눈에 관리하세요.</p></div><Button onClick={() => setDialogOpen(true)} className="h-11 bg-blue-600 px-5 hover:bg-blue-700"><Plus />새 프로젝트</Button></section><div className="grid gap-5 lg:grid-cols-[1.05fr_1.4fr]"><section className="surface-card overflow-hidden"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="section-title">내 프로필</h2><p className="section-help">AI가 지원자 맥락을 이해하는 기준이에요.</p></div><button onClick={() => setProfileOpen(!profileOpen)} className="text-sm font-bold text-blue-600">{profileOpen ? "완료" : "수정"}</button></div><div className="grid gap-4 p-5 sm:grid-cols-2"><ProfileField icon={GraduationCap} label="학교·전공" value={`${state.profile.school}\n${state.profile.major}`} editing={profileOpen} onChange={(value) => { const [school, ...major] = value.split("\n"); localServices.updateProfile({ school, major: major.join("\n") }) }} /><ProfileField icon={CalendarDays} label="졸업" value={state.profile.graduation} editing={profileOpen} onChange={(graduation) => localServices.updateProfile({ graduation })} /><ProfileField icon={BriefcaseBusiness} label="주요 경험" value={state.profile.experiences} editing={profileOpen} onChange={(experiences) => localServices.updateProfile({ experiences })} /><ProfileField icon={Award} label="수상" value={state.profile.awards} editing={profileOpen} onChange={(awards) => localServices.updateProfile({ awards })} /></div></section><EvidenceSection state={state} /></div><section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><h2 className="section-title text-xl">지원 프로젝트</h2><p className="section-help">마감이 가까운 순서로 확인하세요.</p></div><span className="text-sm font-semibold text-slate-500">{state.projects.length}개</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{state.projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => router.push(`/projects/${project.id}/workspace`)} onEdit={() => setEditingProject(project)} />)}<button onClick={() => setDialogOpen(true)} className="grid min-h-52 place-items-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/50 text-slate-500 transition hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700"><span className="flex flex-col items-center gap-2 font-bold"><Plus className="size-6" />새 지원 프로젝트</span></button></div></section><ProjectDialog key={editingProject?.id ?? "new"} open={dialogOpen || Boolean(editingProject)} onOpenChange={(open) => { if (!open) { setDialogOpen(false); setEditingProject(null) } }} state={state} project={editingProject ?? undefined} /></main>
}

function ProfileField({ icon: Icon, label, value, editing, onChange }: { icon: typeof Award; label: string; value: string; editing: boolean; onChange: (value: string) => void }) {
  return <div className="rounded-xl bg-slate-50 p-4"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-500"><Icon className="size-4 text-blue-600" />{label}</div>{editing ? <textarea className="field-textarea" value={value} onChange={(event) => onChange(event.target.value)} /> : <p className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-800">{value || "아직 입력하지 않았어요."}</p>}</div>
}

function EvidenceSection({ state }: { state: AppState }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<EvidenceFile | null>(null)
  const upload = async (files: FileList | null) => { for (const file of Array.from(files ?? [])) { try { await localServices.files.add(file); toast.success(`${file.name} 업로드 완료`) } catch (error) { toast.error(error instanceof Error ? error.message : "업로드에 실패했습니다.") } } }
  return <section className="surface-card overflow-hidden"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="section-title">첨부 자료</h2><p className="section-help">파일을 클릭하면 바로 열람할 수 있어요.</p></div><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload />업로드</Button><input ref={inputRef} className="hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.hwpx,.txt,.md" onChange={(event) => upload(event.target.files)} /></div><div className="p-3">{state.files.length ? state.files.map((file) => <FileRow key={file.id} file={file} onOpen={() => setPreview(file)} onDelete={() => { if (preview?.id === file.id) setPreview(null) }} />) : <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400"><div><Paperclip className="mx-auto mb-2 size-6" /><p>아직 업로드한 자료가 없어요.</p><p className="mt-1 text-xs">PDF, 이미지, DOCX, HWPX, TXT, MD 지원</p></div></div>}</div>{preview && <FilePreviewDialog file={preview} onOpenChange={(open) => { if (!open) setPreview(null) }} />}</section>
}

function FileRow({ file, onOpen, onDelete }: { file: EvidenceFile; onOpen: () => void; onDelete: () => void }) {
  const remove = async () => {
    if (!window.confirm(`'${file.name}' 파일을 삭제할까요? 이 자료를 사용하는 모든 프로젝트에서도 제거됩니다.`)) return
    try {
      await localServices.files.remove(file)
      onDelete()
      toast.success(`${file.name}을 삭제했어요.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.")
    }
  }
  return <div className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"><button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="자료 열람"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600"><FileText className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="text-xs text-slate-400">{formatBytes(file.size)}</p></div></button><button className="icon-button opacity-60 group-hover:opacity-100" title="열람" onClick={onOpen}><Eye className="size-4" /></button><button className="icon-button opacity-60 group-hover:opacity-100" title="다운로드" onClick={async () => { try { await localServices.files.download(file) } catch (error) { toast.error(error instanceof Error ? error.message : "다운로드 실패") } }}><Download className="size-4" /></button><button className="icon-button text-rose-500 opacity-60 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100" title="삭제" onClick={remove}><Trash2 className="size-4" /></button></div>
}

const previewKind = (file: EvidenceFile): "image" | "pdf" | "unsupported" => {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) return "image"
  if (extension === "pdf") return "pdf"
  return "unsupported"
}

function useFilePreviewUrl(file: EvidenceFile, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // FilePreviewBody는 파일마다 key로 remount하므로 이펙트 안에서 상태를 초기화할
  // 필요가 없다. 각 파일은 항상 초기 상태(url=null)에서 시작한다.
  useEffect(() => {
    if (!enabled) return
    let objectUrl: string | null = null
    let active = true
    localServices.files.open(file)
      .then((value) => { if (active) { objectUrl = value; setUrl(value) } else { URL.revokeObjectURL(value) } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "파일을 열 수 없습니다.") })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file, enabled])
  return { url, error }
}

function FilePreviewBody({ file, fillHeight = false }: { file: EvidenceFile; fillHeight?: boolean }) {
  const kind = previewKind(file)
  const { url, error } = useFilePreviewUrl(file, kind !== "unsupported")
  const frameHeight = fillHeight ? "h-full min-h-0 flex-1" : "h-[66vh]"
  const imageHeight = fillHeight ? "max-h-full" : "max-h-[66vh]"
  return <div className={`grid place-items-center overflow-auto bg-slate-100 p-4 ${fillHeight ? "min-h-0 flex-1" : "max-h-[70vh] min-h-[320px]"}`}>{error ? <p className="text-sm text-rose-600">{error}</p> : kind === "unsupported" ? <div className="max-w-sm p-6 text-center"><FileText className="mx-auto size-10 text-blue-500" /><h3 className="mt-4 font-bold">미리보기를 지원하지 않는 형식이에요</h3><p className="mt-2 text-sm leading-6 text-slate-500">DOC, DOCX, HWPX 파일은 브라우저에서 바로 열람할 수 없어요. 아래에서 원본을 내려받아 확인하세요.</p><Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={async () => { try { await localServices.files.download(file) } catch (cause) { toast.error(cause instanceof Error ? cause.message : "다운로드 실패") } }}><Download />원본 다운로드</Button></div> : !url ? <p className="text-sm text-slate-400">불러오는 중…</p> : kind === "image" ? <img src={url} alt={file.name} className={`${imageHeight} w-auto rounded-lg object-contain shadow-sm`} /> : <iframe src={url} title={file.name} className={`${frameHeight} w-full rounded-lg border border-slate-200 bg-white`} />}</div>
}

function FilePreviewDialog({ file, onOpenChange }: { file: EvidenceFile; onOpenChange: (open: boolean) => void }) {
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[min(960px,calc(100vw-2rem))]"><DialogHeader className="border-b border-slate-200 px-6 py-4 text-left"><DialogTitle className="truncate pr-8 text-lg">{file.name}</DialogTitle><DialogDescription>{formatBytes(file.size)} · 원본은 즉시 열람할 수 있고, 텍스트 추출은 AI 분석용으로 백그라운드 처리됩니다.</DialogDescription>{file.extractionStatus === "failed" && <Button variant="outline" size="sm" className="mt-3 w-fit" onClick={async () => { try { await localServices.files.retry(file); toast.success("AI 텍스트 추출을 다시 요청했습니다.") } catch (error) { toast.error(error instanceof Error ? error.message : "재처리에 실패했습니다.") } }}>AI 텍스트 추출 다시 시도</Button>}</DialogHeader><FilePreviewBody key={file.id} file={file} /></DialogContent></Dialog>
}

function FilePreviewPane({ file, onClose }: { file: EvidenceFile; onClose: () => void }) {
  const [retrying, setRetrying] = useState(false)
  const remove = async () => {
    if (!window.confirm(`'${file.name}' 파일을 삭제할까요? 이 자료를 사용하는 모든 프로젝트에서도 제거됩니다.`)) return
    try {
      await localServices.files.remove(file)
      onClose()
      toast.success(`${file.name}을 삭제했어요.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.")
    }
  }
  const retryExtraction = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await localServices.files.retry(file)
      toast.success("AI 텍스트 추출을 다시 요청했어요. 잠시 후 상태가 갱신됩니다.")
    } catch (error) {
      // 재시도마저 실패하면 사용자에게 원인과 다음 행동을 분명히 안내한다.
      toast.error(`${file.name}의 텍스트 추출이 다시 실패했어요. ${error instanceof Error ? error.message : ""} 다른 형식으로 다시 업로드하거나 원본을 확인해 주세요.`)
    } finally {
      setRetrying(false)
    }
  }
  return <section className="pane bg-slate-100"><div className="pane-heading bg-white"><div className="min-w-0"><p className="pane-kicker text-blue-600">ATTACHMENT</p><p className="truncate font-bold">{file.name}</p></div><div className="flex shrink-0 items-center gap-1"><button className="icon-button" title="다운로드" onClick={async () => { try { await localServices.files.download(file) } catch (error) { toast.error(error instanceof Error ? error.message : "다운로드 실패") } }}><Download className="size-4" /></button><button className="icon-button text-rose-500 hover:bg-rose-50 hover:text-rose-600" title="삭제" onClick={remove}><Trash2 className="size-4" /></button><button className="icon-button" title="닫고 자소서로 돌아가기" onClick={onClose}><X className="size-4" /></button></div></div>{file.extractionStatus === "failed" && <div className="flex items-center justify-between gap-3 border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-700"><span>이 파일의 AI 텍스트 추출에 실패해 자소서 수정에 활용할 수 없어요. 다시 시도해 보세요.</span><Button variant="outline" size="sm" disabled={retrying} className="h-7 shrink-0 border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-100" onClick={() => void retryExtraction()}>{retrying ? "다시 시도 중…" : "추출 다시 시도"}</Button></div>}<FilePreviewBody key={file.id} file={file} fillHeight /><div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-400"><span>{formatBytes(file.size)} · 첨부 자료를 열람 중입니다. 자소서 문항을 선택하면 편집기로 돌아갑니다.</span><ExtractionBadge status={file.extractionStatus} /></div></section>
}

function ExtractionBadge({ status }: { status?: EvidenceFile["extractionStatus"] }) {
  const map: Record<NonNullable<EvidenceFile["extractionStatus"]>, { label: string; className: string }> = {
    pending: { label: "AI 컨텍스트 추출 중…", className: "bg-slate-100 text-slate-500" },
    done: { label: "AI 컨텍스트 준비됨", className: "bg-emerald-50 text-emerald-700" },
    unsupported: { label: "AI 컨텍스트 미지원", className: "bg-amber-50 text-amber-700" },
    failed: { label: "AI 컨텍스트 추출 실패", className: "bg-rose-50 text-rose-700" },
  }
  const info = status ? map[status] : null
  if (!info) return null
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${info.className}`}>{info.label}</span>
}

function ProjectCard({ project, onOpen, onEdit }: { project: Project; onOpen: () => void; onEdit: () => void }) {
  const dday = daysLeft(project.deadline)
  return <article className="surface-card group relative min-h-52 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-950/5"><button onClick={onEdit} title="프로젝트 정보 수정" className="icon-button absolute right-14 top-4 z-10"><Pencil className="size-4" /></button><button onClick={onOpen} className="w-full text-left"><div className="flex items-center justify-between pr-24"><span className={`status status-${project.status}`}>{statusLabel[project.status]}</span><span className={`text-sm font-bold ${dday <= 3 ? "text-rose-600" : "text-blue-600"}`}>{dday >= 0 ? `D-${dday}` : `D+${Math.abs(dday)}`}</span></div><p className="mt-8 text-sm font-bold text-slate-500">{project.company}</p><h3 className="mt-1 text-xl font-bold tracking-tight">{project.title}</h3><p className="mt-2 text-sm text-slate-500">{project.role}</p><div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400"><span>{project.fileIds.length}개 첨부 자료</span><span className="flex items-center gap-1 text-blue-600 opacity-0 transition group-hover:opacity-100">워크스페이스 열기 <ChevronRight className="size-3" /></span></div></button></article>
}

function ProjectDialog({ open, onOpenChange, state, project }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppState; project?: Project }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const initialForm = () => ({ company: project?.company ?? "", role: project?.role ?? "", title: project?.title ?? "", deadline: project?.deadline ?? "", fileIds: project?.fileIds ?? state.files.map((file) => file.id) })
  const [form, setForm] = useState(initialForm)
  // 모달을 닫을 때 입력 내용을 초기화해, 다시 열었을 때 이전에 쓰다 만 값이 남지 않게 한다.
  const handleOpenChange = (next: boolean) => { if (!next) setForm(initialForm()); onOpenChange(next) }
  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        // 업로드한 파일은 허브 첨부 자료에 등록되고, 이 프로젝트에도 자동 포함된다.
        const added = await localServices.files.add(file)
        setForm((current) => ({ ...current, fileIds: [...current.fileIds, added.id] }))
        toast.success(`${file.name}을 첨부했어요.`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "업로드 실패")
      }
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); if (!form.company.trim() || !form.role.trim() || !form.title.trim() || !form.deadline) return toast.error("필수 정보를 모두 입력해 주세요."); if (!project && daysLeft(form.deadline) < 0) return toast.error("오늘 이후의 마감일을 선택해 주세요."); if (project) { localServices.projects.update(project.id, form); localServices.projects.setFiles(project.id, form.fileIds); toast.success("프로젝트 정보를 수정했어요."); handleOpenChange(false) } else { const created = localServices.projects.create(form); handleOpenChange(false); router.push(`/projects/${created.id}/workspace`) } }
  return <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{project ? "프로젝트 정보 수정" : "새 지원 프로젝트"}</DialogTitle><DialogDescription>{project ? "회사, 직무와 마감 정보를 변경할 수 있습니다." : "기업과 지원 정보를 입력하고 함께 사용할 자료를 선택하세요."}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><FormField label="회사명 *" value={form.company} onChange={(company) => setForm({ ...form, company })} placeholder="예: 넥스트파이낸스" /><FormField label="지원 직무 *" value={form.role} onChange={(role) => setForm({ ...form, role })} placeholder="예: 서비스 기획" /><div className="sm:col-span-2"><FormField label="프로젝트명 *" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="예: 2026 상반기 체험형 인턴" /></div><label className="sm:col-span-2"><span className="form-label">마감일 *</span><input className="text-input" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label></div><div><div className="mb-2 flex items-center justify-between"><p className="form-label mb-0">포함할 첨부 자료</p><Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload />파일 첨부</Button></div><input ref={inputRef} className="hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.hwpx" onChange={(event) => { upload(event.target.files); event.target.value = "" }} /><p className="mb-2 text-xs text-slate-400">필요한 자료만 선택하세요. 새로 첨부한 파일은 허브에도 등록됩니다.</p><div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{state.files.length ? state.files.map((file) => <label key={file.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-slate-50"><Checkbox checked={form.fileIds.includes(file.id)} onCheckedChange={(checked) => setForm({ ...form, fileIds: checked ? [...form.fileIds, file.id] : form.fileIds.filter((fileId) => fileId !== file.id) })} /><FileText className="size-4 text-slate-400" /><span className="truncate text-sm font-semibold">{file.name}</span></label>) : <p className="p-3 text-center text-sm text-slate-400">첨부된 자료가 없습니다. ‘파일 첨부’로 추가하세요.</p>}</div></div><DialogFooter><Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>취소</Button><Button type="submit" className="bg-blue-600 hover:bg-blue-700">{project ? "수정 완료" : "프로젝트 만들기"}</Button></DialogFooter></form></DialogContent></Dialog>
}

function FormField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label><span className="form-label">{label}</span><input className="text-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>
}

function LegacyDashboardRoute({ state, projectId }: { state: AppState; projectId: string }) {
  const router = useRouter()
  useEffect(() => router.replace(`/projects/${projectId}/workspace`), [projectId, router])
  return <WorkspacePage state={state} projectId={projectId} />
}

function WorkspacePage({ state, projectId }: { state: AppState; projectId: string }) {
  const router = useRouter()
  const project = state.projects.find((item) => item.id === projectId)
  const [mobilePane, setMobilePane] = useState<"files" | "editor" | "chat">("editor")
  const [selectedEssayId, setSelectedEssayId] = useState(state.essays[projectId]?.[0]?.id ?? "")
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [proposalRef, setProposalRef] = useState<ProposalRef | null>(null)
  if (!project) return <NotFound />
  const essays = state.essays[projectId] ?? []
  const selectedEssay = essays.find((essay) => essay.id === selectedEssayId) ?? essays[0]
  const selectedFile = selectedFileId ? state.files.find((file) => file.id === selectedFileId && project.fileIds.includes(file.id)) : undefined
  const activeSuggestion = proposalRef ? state.chats[projectId]?.find((session) => session.id === proposalRef.sessionId)?.messages.find((message) => message.id === proposalRef.messageId)?.suggestions?.find((suggestion) => suggestion.id === proposalRef.suggestionId) : undefined
  // 변경 개수는 LLM이 돌려준 changeStatuses가 아니라 실제 diff에서 계산한다.
  // (모델이 changeStatuses를 비우거나 개수를 틀리게 반환해도 검토 화면이 뜨도록.)
  const hasPendingChanges = (() => {
    if (!activeSuggestion) return false
    const totalChanges = createInlineDiff(activeSuggestion.before, activeSuggestion.after).filter((part) => part.kind === "change").length
    if (totalChanges === 0) return false
    const statuses = activeSuggestion.changeStatuses
    if (statuses && statuses.length === totalChanges) return statuses.includes("pending")
    // 아직 사용자가 결정하지 않았거나(=undefined) 길이가 안 맞으면 전체를 미결로 본다.
    return activeSuggestion.status !== "accepted" && activeSuggestion.status !== "rejected"
  })()
  const selectEssay = (essayId: string) => { setProposalRef(null); setSelectedFileId(null); setSelectedEssayId(essayId); setMobilePane("editor") }
  const createEssay = () => { const essay = localServices.essays.create(project.id); setProposalRef(null); setSelectedFileId(null); setSelectedEssayId(essay.id); setMobilePane("editor") }
  const selectFile = (fileId: string) => { setProposalRef(null); setSelectedFileId(fileId); setMobilePane("editor") }
  const deleteEssay = (essayId: string) => {
    const target = essays.find((essay) => essay.id === essayId)
    if (!target) return
    if (!window.confirm(`'${target.title}' 문항을 삭제할까요? 작성한 내용도 함께 사라집니다.`)) return
    localServices.essays.remove(project.id, essayId)
    if (selectedEssayId === essayId) {
      const remaining = essays.filter((essay) => essay.id !== essayId)
      setProposalRef(null)
      setSelectedEssayId(remaining[0]?.id ?? "")
    }
    toast.success("문항을 삭제했어요.")
  }
  const deleteFile = async (fileId: string) => {
    const target = state.files.find((file) => file.id === fileId)
    if (!target) return
    if (!window.confirm(`'${target.name}' 파일을 삭제할까요? 이 자료를 사용하는 모든 프로젝트에서도 제거됩니다.`)) return
    try {
      await localServices.files.remove(target)
      if (selectedFileId === fileId) setSelectedFileId(null)
      toast.success(`${target.name}을 삭제했어요.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제에 실패했습니다.")
    }
  }
  const contribute = () => {
    // 현재 워크스페이스의 문항을 기여 폼 초안으로 넘긴다. 실제 크레딧 보상은 기여 페이지 제출 시 지급된다.
    localServices.setContributionDraft({
      company: project.company,
      role: project.role,
      questions: essays.map((essay) => ({ question: essay.question, answer: essay.answer })),
    })
    router.push("/contribute")
  }
  const previewSuggestion = (reference: ProposalRef & { essayId: string }) => {
    // 제안이 가리키는 문항이 실제로 존재하면 그 문항을, 아니면 현재/첫 문항을 연다.
    // (모델이 잘못된 essayId를 반환해도 가운데 패널에 검토 화면이 뜨도록 보정.)
    const targetEssay = essays.find((essay) => essay.id === reference.essayId) ?? essays.find((essay) => essay.id === selectedEssayId) ?? essays[0]
    setSelectedFileId(null)
    if (targetEssay) setSelectedEssayId(targetEssay.id)
    setProposalRef(reference)
    setMobilePane("editor")
  }
  const filePane = <FilePane state={state} project={project} essays={essays} selectedEssayId={selectedFile ? "" : selectedEssay?.id ?? ""} selectedFileId={selectedFile?.id ?? null} onSelectEssay={selectEssay} onSelectFile={selectFile} onCreateEssay={createEssay} onDeleteEssay={deleteEssay} onDeleteFile={deleteFile} onManageFiles={() => setFilesOpen(true)} onContribute={contribute} />
  const editorPane = selectedFile ? <FilePreviewPane file={selectedFile} onClose={() => setSelectedFileId(null)} /> : selectedEssay ? <EditorPane key={selectedEssay.id} project={project} essay={selectedEssay} review={activeSuggestion && proposalRef && hasPendingChanges ? { reference: proposalRef, suggestion: activeSuggestion } : undefined} onReviewComplete={() => setProposalRef(null)} /> : <EmptyEssay onCreate={createEssay} />
  const chatPane = <ChatPane state={state} project={project} essayId={selectedEssay?.id} onPreviewSuggestion={previewSuggestion} />
  const closeAnalysis = (open: boolean) => setAnalysisOpen(open)
  return <main className="workspace-shell"><div className="workspace-topbar"><button onClick={() => router.push("/hub")} className="icon-button"><ArrowLeft className="size-4" /></button><div className="min-w-0"><p className="truncate text-sm font-bold">{project.company} · {project.title}</p><p className="text-xs text-slate-400">{project.role}</p></div><button onClick={() => setEditOpen(true)} className="icon-button" title="프로젝트 정보 수정"><Pencil className="size-4" /></button><div className="ml-auto flex items-center gap-2"><button className="dashboard-link" onClick={() => setAnalysisOpen(true)}><BarChart3 className="size-4" /><span className="hidden sm:inline">AI 분석</span></button><StatusSelect project={project} /></div></div><div className="mobile-tabs"><button className={mobilePane === "files" ? "active" : ""} onClick={() => setMobilePane("files")}><FolderOpen />파일</button><button className={mobilePane === "editor" ? "active" : ""} onClick={() => setMobilePane("editor")}><FileText />작성</button><button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}><MessageSquareText />AI 코치</button></div><div className="hidden min-h-0 flex-1 lg:block"><ResizablePanelGroup orientation="horizontal"><ResizablePanel defaultSize={20} minSize={15}>{filePane}</ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={52} minSize={35}>{editorPane}</ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={28} minSize={20}>{chatPane}</ResizablePanel></ResizablePanelGroup></div><div className="min-h-0 flex-1 lg:hidden">{mobilePane === "files" && filePane}{mobilePane === "editor" && editorPane}{mobilePane === "chat" && chatPane}</div>{editOpen && <ProjectDialog open={editOpen} onOpenChange={setEditOpen} state={state} project={project} />}{filesOpen && <ManageFilesDialog open={filesOpen} onOpenChange={setFilesOpen} state={state} project={project} />}{analysisOpen && <AnalysisDialog open={analysisOpen} onOpenChange={closeAnalysis} state={state} project={project} />}</main>
}

function StatusSelect({ project }: { project: Project }) {
  return <select aria-label="지원 결과" className={`status-select status-${project.status}`} value={project.status} onChange={(event) => { localServices.projects.updateStatus(project.id, event.target.value as ApplicationStatus) }}><option value="pending">대기중</option><option value="passed">합격</option><option value="failed">불합격</option></select>
}

function FilePane({ state, project, essays, selectedEssayId, selectedFileId, onSelectEssay, onSelectFile, onCreateEssay, onDeleteEssay, onDeleteFile, onManageFiles, onContribute }: { state: AppState; project: Project; essays: Essay[]; selectedEssayId: string; selectedFileId: string | null; onSelectEssay: (id: string) => void; onSelectFile: (id: string) => void; onCreateEssay: () => void; onDeleteEssay: (id: string) => void; onDeleteFile: (id: string) => void; onManageFiles: () => void; onContribute: () => void }) {
  const files = state.files.filter((file) => project.fileIds.includes(file.id))
  return <section className="pane bg-slate-950 text-slate-200"><div className="pane-heading border-slate-800"><div><p className="pane-kicker">EXPLORER</p><h2 className="font-bold">프로젝트 파일</h2></div></div><div className="min-h-0 flex-1 overflow-y-auto p-2"><div className="mb-1 flex items-center justify-between px-2 py-2 text-xs font-bold text-slate-500"><span className="flex items-center gap-2"><ChevronRight className="size-3 rotate-90" />COVER LETTER</span><button onClick={onCreateEssay} className="dark-icon-button" title="자소서 문항 추가"><Plus className="size-4" /></button></div>{essays.map((essay) => <div key={essay.id} className={`group flex items-center gap-1 rounded-lg pr-1 text-sm transition ${selectedEssayId === essay.id ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}><button onClick={() => onSelectEssay(essay.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"><FileText className="size-4 shrink-0" /><span className="truncate">{essay.title}</span></button><button onClick={() => onDeleteEssay(essay.id)} title="문항 삭제" className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"><Trash2 className="size-3.5" /></button></div>)}<div className="mb-1 mt-5 flex items-center justify-between px-2 py-2 text-xs font-bold text-slate-500"><span className="flex items-center gap-2"><ChevronRight className="size-3 rotate-90" />ATTACHMENTS</span><button onClick={onManageFiles} className="dark-icon-button" title="허브 자료 선택 또는 업로드"><Paperclip className="size-4" /></button></div>{files.length ? files.map((file) => <div key={file.id} className={`group flex items-center gap-1 rounded-lg pr-1 text-sm transition ${selectedFileId === file.id ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}><button onClick={() => onSelectFile(file.id)} title="가운데 패널에서 열람" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"><Paperclip className={`size-4 shrink-0 ${selectedFileId === file.id ? "text-white" : "text-blue-400"}`} /><span className="truncate">{file.name}</span></button><button onClick={() => onDeleteFile(file.id)} title="파일 삭제" className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-0 transition hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"><Trash2 className="size-3.5" /></button></div>) : <p className="px-3 py-5 text-center text-xs leading-5 text-slate-500">연결된 첨부 자료가 없습니다.<br />클립 버튼으로 허브 자료를 선택하세요.</p>}</div><div className="space-y-3 border-t border-slate-800 p-3"><button onClick={onContribute} className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-blue-500 hover:bg-slate-800 hover:text-white"><FilePlus2 className="size-3.5" />이 자소서 기여하기</button><p className="text-[11px] leading-5 text-slate-500">문항·파일을 삭제하거나, 작성한 자소서를 기여 페이지로 보낼 수 있어요.</p></div></section>
}

type EssayDoc = { title: string; question: string; answer: string }

/**
 * 자소서 문서(title/question/answer)의 실행취소·재실행 히스토리를 관리한다.
 * 짧은 시간 안의 연속 입력은 하나의 히스토리 항목으로 합쳐(coalesce) 문자 단위가
 * 아니라 편집 묶음 단위로 되돌아가게 한다. 브라우저 기본 undo와 별개로 동작한다.
 */
function useDocumentHistory(initial: EssayDoc, coalesceMs = 500) {
  const [hist, setHist] = useState<{ doc: EssayDoc; past: EssayDoc[]; future: EssayDoc[] }>({ doc: initial, past: [], future: [] })
  const lastCommit = useRef(0)

  const update = (patch: Partial<EssayDoc>) => {
    const now = Date.now()
    // 직전 커밋과의 간격이 짧으면 같은 편집으로 보고 히스토리를 새로 쌓지 않는다.
    const coalesce = now - lastCommit.current <= coalesceMs
    lastCommit.current = now
    setHist((h) => ({
      doc: { ...h.doc, ...patch },
      past: coalesce ? h.past : [...h.past, h.doc],
      future: [],
    }))
  }

  const undo = () => {
    lastCommit.current = 0
    setHist((h) => h.past.length ? { doc: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.doc, ...h.future] } : h)
  }

  const redo = () => {
    lastCommit.current = 0
    setHist((h) => h.future.length ? { doc: h.future[0], past: [...h.past, h.doc], future: h.future.slice(1) } : h)
  }

  // 히스토리에 기록하며 문서를 교체한다(AI 제안 반영 등 외부 변경용).
  const replace = (next: EssayDoc) => {
    lastCommit.current = 0
    setHist((h) => ({ doc: next, past: [...h.past, h.doc], future: [] }))
  }

  return { doc: hist.doc, update, undo, redo, replace, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0 }
}

function EditorPane({ project, essay, review, onReviewComplete }: { project: Project; essay: Essay; review?: { reference: ProposalRef; suggestion: EssaySuggestion }; onReviewComplete: () => void }) {
  const history = useDocumentHistory({ title: essay.title, question: essay.question, answer: essay.answer })
  const { title, question, answer } = history.doc
  // 마지막으로 저장한 스냅샷. 저장이 전역 리렌더를 유발해 essay prop이 새 참조로
  // 바뀌어도, 값이 같으면 다시 저장하지 않아 무한 저장 루프를 막는다.
  const [saved, setSaved] = useState({ title: essay.title, question: essay.question, answer: essay.answer })
  const dirty = title !== saved.title || question !== saved.question || answer !== saved.answer
  const persist = useCallback(() => {
    if (title === saved.title && question === saved.question && answer === saved.answer) return
    localServices.essays.save(project.id, essay.id, { title, question, answer })
    setSaved({ title, question, answer })
  }, [answer, essay.id, project.id, question, saved.answer, saved.question, saved.title, title])
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(persist, 500)
    return () => clearTimeout(timer)
  }, [dirty, persist])
  const chars = answer.replace(/\s/g, "").length
  const decide = (changeIndex: number, decision: "accepted" | "rejected", pendingCount: number) => {
    if (!review) return
    const args = [project.id, review.reference.sessionId, review.reference.messageId, review.suggestion.id, changeIndex] as const
    const nextAnswer = decision === "accepted" ? localServices.acceptSuggestion(...args) : localServices.rejectSuggestion(...args)
    if (nextAnswer !== undefined) { history.replace({ title, question, answer: nextAnswer }); setSaved((current) => ({ ...current, answer: nextAnswer })) }
    toast[decision === "accepted" ? "success" : "info"](`변경 ${changeIndex + 1}을 ${decision === "accepted" ? "반영했어요." : "거절했어요."}`)
    if (pendingCount === 1) onReviewComplete()
  }
  // 편집기 어디서든 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S 단축키를 처리한다.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const meta = event.metaKey || event.ctrlKey
    if (!meta) return
    const key = event.key.toLowerCase()
    if (key === "s") { event.preventDefault(); persist(); toast.success("저장했어요.") }
    else if (key === "z" && !event.shiftKey) { event.preventDefault(); history.undo() }
    else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); history.redo() }
  }
  return <section className="pane bg-slate-100" onKeyDown={onKeyDown}><div className="pane-heading bg-white"><div className="min-w-0 flex-1"><p className="pane-kicker text-blue-600">COVER LETTER</p><input aria-label="문항 파일명" value={title} onChange={(event) => history.update({ title: event.target.value })} className="w-full bg-transparent font-bold outline-none" /></div><div className="flex shrink-0 items-center gap-1"><span className="w-16 shrink-0 whitespace-nowrap text-right text-xs font-semibold text-slate-400">{review ? "검토 중" : dirty ? "저장 중…" : "저장됨"}</span><button type="button" onClick={history.undo} disabled={!history.canUndo} title="실행취소 (Ctrl/Cmd+Z)" className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"><Undo2 className="size-4" /></button><button type="button" onClick={history.redo} disabled={!history.canRedo} title="재실행 (Ctrl/Cmd+Shift+Z)" className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30"><Redo2 className="size-4" /></button></div></div><div className="editor-scroll"><div className="document-page"><div className="mb-6"><p className="text-sm font-bold text-blue-600">{project.company} · {project.role}</p><label className="mt-5 block"><span className="form-label">질문</span><textarea value={question} onChange={(event) => history.update({ question: event.target.value })} className="question-editor" placeholder="자기소개서 문항을 입력하세요." /></label></div><div><span className="form-label">답변</span>{review ? <InlineSuggestion suggestion={review.suggestion} onDecide={decide} /> : <textarea aria-label="자기소개서 답변" value={answer} onChange={(event) => history.update({ answer: event.target.value })} placeholder="이 문항에 대한 나만의 경험을 구체적으로 작성해 보세요…" className="essay-editor" />}</div><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400"><span>공백 제외 {chars.toLocaleString()}자</span><span>권장 700–1,000자</span></div></div></div></section>
}

function EmptyEssay({ onCreate }: { onCreate: () => void }) {
  return <section className="pane grid place-items-center bg-slate-100"><div className="text-center"><FilePlus2 className="mx-auto size-10 text-blue-500" /><h2 className="mt-4 text-lg font-bold">작성할 문항을 추가하세요</h2><Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={onCreate}><Plus />문항 추가</Button></div></section>
}

function InlineSuggestion({ suggestion, onDecide }: { suggestion: EssaySuggestion; onDecide: (index: number, decision: "accepted" | "rejected", pendingCount: number) => void }) {
  const diff = createInlineDiff(suggestion.before, suggestion.after)
  const changeCount = diff.filter((part) => part.kind === "change").length
  const fallbackStatus = suggestion.status === "accepted" || suggestion.status === "rejected" ? suggestion.status : "pending"
  const decisions = Array.from({ length: changeCount }, (_, index) => suggestion.changeStatuses?.[index] ?? fallbackStatus)
  const pendingCount = decisions.filter((decision) => decision === "pending").length
  let changeIndex = 0
  return <div className="proposal-document-text">{diff.map((part, index) => {
        if (part.kind === "equal") return <span key={index} className="proposal-context">{part.text}</span>
        const currentIndex = changeIndex++
        const decision = decisions[currentIndex]
        if (decision !== "pending") return <span key={index} className="proposal-context">{decision === "accepted" ? part.after : part.before}</span>
        return <div key={index} className="inline-review"><div className="inline-review-toolbar"><strong>변경 {currentIndex + 1}</strong><div className="flex shrink-0 items-center gap-1.5"><Button size="sm" variant="outline" onClick={() => onDecide(currentIndex, "rejected", pendingCount)} className="h-7 gap-1 border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50"><X className="size-3" />Reject</Button><Button size="sm" onClick={() => onDecide(currentIndex, "accepted", pendingCount)} className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"><Check className="size-3" />Accept</Button></div></div><div className="inline-hunk"><div className="inline-change before"><span className="change-marker">−</span><div><strong>원래 내용</strong><p>{part.before || "(추가되는 위치)"}</p></div></div><div className="inline-change after"><span className="change-marker">+</span><div><strong>수정본</strong><p>{part.after || "(삭제됨)"}</p></div></div></div></div>
      })}</div>
}

function ChatPane({ state, project, essayId, onPreviewSuggestion }: { state: AppState; project: Project; essayId?: string; onPreviewSuggestion: (reference: ProposalRef & { essayId: string }) => void }) {
  const [prompt, setPrompt] = useState("")
  const [contextIds, setContextIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  // 서버 응답을 기다리는 동안 즉시 보여줄 사용자 메시지. 응답이 오면 서버 상태로 대체된다.
  const [pending, setPending] = useState<{ text: string; references: string[] } | null>(null)
  const sessions = state.chats[project.id] ?? []
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.id ?? "")
  const [historyOpen, setHistoryOpen] = useState(false)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const messages = activeSession?.messages ?? []
  const essays = state.essays[project.id] ?? []
  const files = state.files.filter((file) => project.fileIds.includes(file.id))
  const candidates = [
    ...essays.map((essay) => ({ id: `essay:${essay.id}`, name: essay.title, kind: "자소서" })),
    ...files.map((file) => ({ id: `file:${file.id}`, name: file.name, kind: "첨부 자료" })),
  ]
  const mentionMatch = prompt.match(/@([^@\s]*)$/)
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null
  const mentionCandidates = mentionQuery === null ? [] : candidates.filter((item) => item.name.toLowerCase().includes(mentionQuery) && !contextIds.includes(item.id))
  const selectedContexts = contextIds.map((contextId) => candidates.find((item) => item.id === contextId)).filter((item): item is NonNullable<typeof item> => Boolean(item))
  const chooseContext = (contextId: string, name: string) => {
    setContextIds((current) => current.includes(contextId) ? current : [...current, contextId])
    setPrompt((current) => current.replace(/@[^@\s]*$/, `@[${name}] `))
  }
  const startNewChat = () => {
    const session = localServices.startChat(project.id)
    setActiveSessionId(session.id)
    setHistoryOpen(false)
    setPrompt("")
    setContextIds([])
  }
  const send = async () => {
    if (sending || !prompt.trim()) return
    let sessionId = activeSessionId
    if (!sessionId) {
      const session = localServices.startChat(project.id)
      sessionId = session.id
      setActiveSessionId(session.id)
    }
    const contexts = contextIds.length ? contextIds : essayId ? [`essay:${essayId}`] : []
    const promptText = prompt.trim()
    // 보낸 메시지를 즉시 화면에 띄우고(낙관적 표시), 응답 대기 상태로 전환한다.
    setPending({ text: promptText, references: selectedContexts.map((item) => item.name) })
    setSending(true)
    setPrompt("")
    setContextIds([])
    try {
      const result = await localServices.sendChat(project.id, sessionId, promptText, contexts)
      if (!result.ok) { toast.error(result.error ?? "AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요."); return }
      if (result.preview) onPreviewSuggestion({ sessionId, ...result.preview })
      else toast.info("이번 응답에는 수정 제안이 없어요. 답변 내용을 확인해 주세요.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI 요청 중 문제가 발생했어요.")
    } finally {
      setSending(false)
      setPending(null)
    }
  }
  return <section className="pane bg-white"><div className="pane-heading"><div className="min-w-0"><div className="flex items-center gap-2"><div className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Sparkles className="size-4" /></div><h2 className="truncate font-bold">{historyOpen ? "대화 기록" : activeSession?.title ?? "AI 커리어 코치"}</h2></div><p className="mt-1 truncate text-xs text-slate-400">{historyOpen ? `${sessions.length}개의 저장된 대화` : "여러 파일을 검토하고 수정안을 제안해요 · 10 크레딧"}</p></div><div className="flex gap-1"><button onClick={() => setHistoryOpen(!historyOpen)} className={`icon-button ${historyOpen ? "border-blue-200 bg-blue-50 text-blue-700" : ""}`} title="대화 기록"><History className="size-4" /></button><button onClick={startNewChat} className="icon-button" title="새 대화"><Plus className="size-4" /></button></div></div>{historyOpen ? <ChatHistory sessions={sessions} activeSessionId={activeSessionId} onSelect={(sessionId) => { setActiveSessionId(sessionId); setHistoryOpen(false) }} onNew={startNewChat} /> : <><div className="chat-scroll">{messages.length || pending ? <>{messages.map((message) => <div key={message.id} className={`chat-message ${message.role}`}><span>{message.role === "assistant" ? "AI 코치" : "나"}</span><p>{message.content}</p>{message.references?.length ? <div className="mt-2 flex flex-wrap gap-1">{message.references.map((name) => <span key={name} className="context-chip">@{name}</span>)}</div> : null}{message.reasoning?.length ? <details className="reasoning-panel" open><summary>검토 과정 보기</summary><ol>{message.reasoning.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></details> : null}{message.suggestions?.map((suggestion) => <SuggestionCard key={suggestion.id} sessionId={activeSessionId} messageId={message.id} suggestion={suggestion} onPreview={onPreviewSuggestion} />)}</div>)}{pending ? <><div className="chat-message user"><span>나</span><p>{pending.text}</p>{pending.references.length ? <div className="mt-2 flex flex-wrap gap-1">{pending.references.map((name) => <span key={name} className="context-chip">@{name}</span>)}</div> : null}</div><div className="chat-message assistant"><span>AI 코치</span><p className="flex items-center gap-2 text-slate-400"><span className="chat-typing" aria-hidden><span /><span /><span /></span>답변 작성중…</p></div></> : null}</> : <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-700"><strong className="mb-1 block text-blue-700">새 대화를 시작해 보세요</strong>@를 입력해 여러 문항이나 자료를 태그하고 수정 방향을 알려주세요. 원문은 사용자가 제안을 승인하기 전까지 바뀌지 않습니다.</div>}<div className="mt-3 flex flex-wrap gap-2">{["성과를 수치 중심으로 다듬어줘", "직무와 연결해 수정해줘", "모든 문항의 어조를 통일해줘"].map((text) => <button key={text} onClick={() => setPrompt(text)} className="prompt-chip">{text}</button>)}</div></div><div className="border-t border-slate-200 p-3">{selectedContexts.length ? <div className="mb-2 flex flex-wrap gap-1">{selectedContexts.map((item) => <button key={item.id} onClick={() => setContextIds((current) => current.filter((id) => id !== item.id))} className="context-chip">@{item.name} ×</button>)}</div> : null}<div className="relative"><div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-400">{mentionCandidates.length ? <div className="mention-menu">{mentionCandidates.map((item) => <button key={item.id} onClick={() => chooseContext(item.id, item.name)}><span className="grid size-7 place-items-center rounded-lg bg-blue-50 text-blue-600">{item.kind === "자소서" ? <FileText className="size-4" /> : <Paperclip className="size-4" />}</span><span><strong>{item.name}</strong><small>{item.kind}</small></span></button>)}</div> : null}<textarea rows={2} value={prompt} disabled={sending} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} placeholder={sending ? "답변을 기다리는 중…" : "@로 파일을 태그하고 수정 방향을 알려주세요"} className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-60" /><button onClick={() => void send()} disabled={sending || !prompt.trim()} className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" aria-label="메시지 보내기">{sending ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="size-4" />}</button></div></div></div></>}</section>
}

function ChatHistory({ sessions, activeSessionId, onSelect, onNew }: { sessions: ChatSession[]; activeSessionId: string; onSelect: (id: string) => void; onNew: () => void }) {
  return <div className="min-h-0 flex-1 overflow-y-auto p-3">{sessions.length ? <div className="space-y-2">{sessions.map((session) => <button key={session.id} onClick={() => onSelect(session.id)} className={`w-full rounded-xl border p-3 text-left transition ${session.id === activeSessionId ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><div className="flex items-center justify-between gap-3"><strong className="truncate text-sm">{session.title}</strong><span className="shrink-0 text-[10px] text-slate-400">{new Date(session.updatedAt).toLocaleDateString("ko-KR")}</span></div><p className="mt-1 truncate text-xs text-slate-400">{session.messages.at(-1)?.content ?? "아직 메시지가 없습니다."}</p><span className="mt-2 block text-[10px] font-semibold text-slate-400">메시지 {session.messages.length}개</span></button>)}</div> : <div className="grid h-full min-h-56 place-items-center text-center"><div><History className="mx-auto size-8 text-slate-300" /><p className="mt-3 text-sm font-bold">저장된 대화가 없어요</p><Button size="sm" className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={onNew}><Plus />새 대화</Button></div></div>}</div>
}

function SuggestionCard({ sessionId, messageId, suggestion, onPreview }: { sessionId: string; messageId: string; suggestion: NonNullable<AppState["chats"][string][number]["messages"][number]["suggestions"]>[number]; onPreview: (reference: ProposalRef & { essayId: string }) => void }) {
  const statusText = suggestion.status === "accepted" ? "모두 반영" : suggestion.status === "rejected" ? "모두 거절" : suggestion.status === "partial" ? "일부 반영" : "검토 필요"
  return <button onClick={() => onPreview({ sessionId, messageId, suggestionId: suggestion.id, essayId: suggestion.essayId })} className="suggestion-card w-full text-left"><div className="flex items-center justify-between gap-3"><div><span className="text-[11px] font-extrabold tracking-wider text-blue-600">EDIT PROPOSAL</span><h3 className="text-sm font-bold">{suggestion.essayTitle}</h3></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${suggestion.status === "accepted" ? "bg-emerald-50 text-emerald-700" : suggestion.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{statusText}</span></div><span className="mt-3 flex items-center gap-1 text-xs font-bold text-blue-600">가운데 패널에서 비교하기 <ChevronRight className="size-3" /></span></button>
}

function ManageFilesDialog({ open, onOpenChange, state, project }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppState; project: Project }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState(project.fileIds)
  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      try {
        const added = await localServices.files.add(file)
        setSelected((current) => [...current, added.id])
        toast.success(`${file.name}을 허브에 업로드했어요.`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "업로드 실패")
      }
    }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>프로젝트 자료 선택</DialogTitle><DialogDescription>허브에 있는 자료를 연결하거나 새 파일을 업로드하세요.</DialogDescription></DialogHeader><div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{state.files.length ? state.files.map((file) => <label key={file.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-3 hover:bg-slate-50"><Checkbox checked={selected.includes(file.id)} onCheckedChange={(checked) => setSelected(checked ? [...selected, file.id] : selected.filter((id) => id !== file.id))} /><FileText className="size-4 text-blue-500" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{file.name}</span><span className="text-xs text-slate-400">{formatBytes(file.size)}</span></label>) : <p className="p-8 text-center text-sm text-slate-400">허브에 등록된 자료가 없습니다.</p>}</div><input ref={inputRef} className="hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.hwpx" onChange={(event) => upload(event.target.files)} /><DialogFooter><Button type="button" variant="outline" onClick={() => inputRef.current?.click()}><Upload />새 파일 업로드</Button><Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { localServices.projects.setFiles(project.id, selected); onOpenChange(false); toast.success("프로젝트 자료를 변경했어요.") }}>선택 적용</Button></DialogFooter></DialogContent></Dialog>
}

function AnalysisDialog({ open, onOpenChange, state, project }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppState; project: Project }) {
  const report = [...state.reports].reverse().find((item) => item.projectId === project.id)
  const [running, setRunning] = useState(false)
  const run = async () => {
    if (running) return
    setRunning(true)
    try {
      const result = await localServices.runAnalysis(project.id)
      if (!result.ok) toast.error(result.error ?? "분석 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.")
      else if (result.cached) toast.info("동일한 내용의 저장된 분석을 불러왔어요.")
      else toast.success("새 분석이 완료됐어요. 100 크레딧을 사용했습니다.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "분석 요청 중 문제가 발생했어요.")
    } finally {
      setRunning(false)
    }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next) }}><DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-[min(1100px,calc(100vw-2rem))]"><DialogHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5 text-left"><div className="flex items-end justify-between gap-4 pr-8"><div><p className="eyebrow">AI ANALYSIS</p><DialogTitle className="text-2xl tracking-tight">{project.company} 지원 분석</DialogTitle><DialogDescription className="mt-1">워크스페이스를 벗어나지 않고 현재 문서의 완성도를 확인하세요.</DialogDescription></div><Button onClick={() => void run()} disabled={running} className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-60">{running ? <><span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />분석 중…</> : <><Sparkles />{report ? "다시 분석" : "100 크레딧으로 분석"}</>}</Button></div></DialogHeader><div className="bg-slate-50 p-4 sm:p-6"><div className="grid gap-4 sm:grid-cols-3"><MetricCard label="마감까지" value={`D-${Math.max(0, daysLeft(project.deadline))}`} help={project.deadline} /><MetricCard label="현재 상태" value={statusLabel[project.status]} help="워크스페이스에서 변경 가능" /><MetricCard label="비교 데이터" value={report ? `${report.passedMatches + report.failedMatches}건` : "준비됨"} help={report ? `유사 사례 재정렬 후 합격 ${report.passedMatches} · 불합격 ${report.failedMatches}` : "유사 사례 Top-20 재정렬 후 합격·불합격 추출"} /></div>{report ? <ReportContent report={report} /> : <div className="mt-5 grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white text-center"><div className="max-w-md p-8"><LayoutDashboard className="mx-auto size-10 text-blue-500" /><h2 className="mt-4 text-xl font-bold">아직 분석 결과가 없어요</h2><p className="mt-2 text-sm leading-6 text-slate-500">현재 프로필과 자소서를 임베딩해 유사한 익명 합격·불합격 사례를 찾고, JEV 평가와 함께 강점·보완점을 분석합니다.</p></div></div>}</div></DialogContent></Dialog>
}

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) { return <div className="surface-card p-5"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-3 text-3xl font-bold tracking-tight">{value}</p><p className="mt-2 text-xs text-slate-400">{help}</p></div> }

function ReportContent({ report }: { report: AppState["reports"][number] }) {
  return <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><section className="surface-card grid place-items-center p-8"><div className="score-ring" style={{ background: `conic-gradient(#2563eb ${report.score}%, #e2e8f0 0)` }}><div><strong>{report.score}</strong><span>/ 100</span></div></div><Progress value={report.score} className="mt-6" /></section><section className="space-y-5"><ReportSection title="잘하고 있는 점" tone="good" items={report.strengths} /><ReportSection title="보완이 필요한 점" tone="warn" items={report.weaknesses} /><ReportSection title="다음 수정 제안" tone="action" items={report.suggestions} /></section>{report.passedMatches + report.failedMatches === 0 ? <div className="lg:col-span-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900"><strong>비교 사례 없음:</strong> 아직 색인된 유사 자소서가 없어 이번 분석은 다른 사용자 사례 비교 없이 자소서 자체만 평가했어요. 더 많은 사용자가 자소서를 기여하면 합격·불합격 사례와 비교한 분석이 제공됩니다.</div> : null}</div>
}

function ReportSection({ title, tone, items }: { title: string; tone: "good" | "warn" | "action"; items: string[] }) { return <div className="surface-card p-5"><h3 className="font-bold">{title}</h3><ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-slate-600"><span className={`mt-2 size-1.5 shrink-0 rounded-full report-dot-${tone}`} />{item}</li>)}</ul></div> }

function ContributePage({ state }: { state: AppState }) {
  const router = useRouter()
  const emptyForm = { company: "", role: "", applicationPeriod: "", result: "passed" as "passed" | "failed", questions: [{ question: "", answer: "" }] }
  // 워크스페이스에서 '자소서 기여하기'로 넘어온 초안이 있으면 최초 렌더 시 폼을 채운다.
  // 초안은 한 번 읽으면 비워지는 일회성 값이라 lazy initializer로 처리한다.
  const [prefilled] = useState(() => localServices.takeContributionDraft())
  const [form, setForm] = useState(() => prefilled
    ? { ...emptyForm, company: prefilled.company, role: prefilled.role, questions: prefilled.questions.length ? prefilled.questions : emptyForm.questions }
    : emptyForm)
  useEffect(() => { if (prefilled) toast.info("워크스페이스의 자소서 내용을 불러왔어요. 지원 시기와 결과를 확인해 주세요.") }, [prefilled])
  const updateQuestion = (index: number, field: "question" | "answer", value: string) => setForm({ ...form, questions: form.questions.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!form.company.trim() || !form.role.trim() || !form.applicationPeriod) return toast.error("회사, 직무와 지원 시기를 입력해 주세요.")
    if (form.questions.some((item) => !item.question.trim() || item.answer.trim().length < 100)) return toast.error("각 문항과 100자 이상의 답변을 입력해 주세요.")
    localServices.contribute(form)
    setForm(emptyForm)
    toast.success("기여가 완료되어 500 크레딧을 받았어요!")
  }
  return <main className="page-wrap max-w-5xl"><section className="mb-8"><p className="eyebrow">DATA CONTRIBUTION</p><h1 className="page-title">과거 자소서로 크레딧 받기</h1><p className="page-subtitle">합격·불합격 결과를 공유하면 더 나은 분석 데이터를 만들고 500 크레딧을 받아요.</p></section><div className="grid gap-6 lg:grid-cols-[1fr_320px]"><form onSubmit={submit} className="surface-card space-y-6 p-6"><div className="grid gap-4 sm:grid-cols-2"><FormField label="회사명 *" value={form.company} onChange={(company) => setForm({ ...form, company })} placeholder="지원했던 회사" /><FormField label="지원 직무 *" value={form.role} onChange={(role) => setForm({ ...form, role })} placeholder="지원했던 직무" /><label><span className="form-label">지원 시기 *</span><input className="text-input" type="month" value={form.applicationPeriod} onChange={(event) => setForm({ ...form, applicationPeriod: event.target.value })} /></label><div><span className="form-label">지원 결과 *</span><div className="grid grid-cols-2 gap-2">{(["passed", "failed"] as const).map((result) => <button key={result} type="button" onClick={() => setForm({ ...form, result })} className={`result-option h-11 ${form.result === result ? "selected" : ""}`}><span className={`status status-${result}`}>{statusLabel[result]}</span>{form.result === result && <Check className="size-4 text-blue-600" />}</button>)}</div></div></div><div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="font-bold">자기소개서 문항</h2><p className="mt-1 text-xs text-slate-400">실제 제출했던 질문과 답변을 문항별로 입력하세요.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, questions: [...form.questions, { question: "", answer: "" }] })}><Plus />문항 추가</Button></div>{form.questions.map((item, index) => <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><strong className="text-sm">문항 {index + 1}</strong>{form.questions.length > 1 && <button type="button" onClick={() => setForm({ ...form, questions: form.questions.filter((_, itemIndex) => itemIndex !== index) })} className="text-xs font-bold text-rose-600">삭제</button>}</div><label><span className="form-label">질문 *</span><textarea className="question-editor bg-white" value={item.question} onChange={(event) => updateQuestion(index, "question", event.target.value)} placeholder="예: 지원 동기와 입사 후 목표를 작성해 주세요." /></label><label className="mt-3 block"><span className="form-label">답변 *</span><textarea className="contribution-editor min-h-52 bg-white" value={item.answer} onChange={(event) => updateQuestion(index, "answer", event.target.value)} placeholder="제출했던 답변을 입력해 주세요." /><span className="mt-2 block text-right text-xs text-slate-400">{item.answer.trim().length} / 최소 100자</span></label></div>)}</div><Button type="submit" className="h-12 w-full bg-blue-600 text-base hover:bg-blue-700">제출하고 500 크레딧 받기</Button></form><aside className="space-y-4"><div className="rounded-2xl bg-slate-950 p-6 text-white"><Coins className="size-8 text-amber-400" /><p className="mt-5 text-sm text-slate-400">현재 보유 크레딧</p><p className="mt-1 text-3xl font-bold">{state.creditBalance.toLocaleString()}</p><Button onClick={() => router.push("/credits")} className="mt-4 w-full bg-blue-600 hover:bg-blue-700"><CreditCard />크레딧 충전</Button><p className="mt-5 border-t border-slate-800 pt-5 text-sm leading-6 text-slate-400">기여 1건마다 500 크레딧이 즉시 지급됩니다.</p></div><button onClick={() => router.push("/contributions")} className="surface-card flex w-full items-center justify-between p-5 text-left transition hover:border-blue-200 hover:bg-blue-50/40"><div><h2 className="font-bold">내 기여 내역</h2><p className="mt-1 text-xs text-slate-400">지금까지 기여한 자소서 {state.contributions.length}건을 확인하세요.</p></div><ChevronRight className="size-5 shrink-0 text-slate-400" /></button><div className="surface-card p-5"><h2 className="font-bold">데이터는 이렇게 사용돼요</h2><ul className="mt-3 space-y-3 text-sm leading-6 text-slate-500"><li>• 개인을 특정하는 정보는 분석 전에 제거합니다.</li><li>• 유사 지원자의 강점과 취약점을 찾는 데 활용합니다.</li><li>• 이 목업에서는 외부 서버로 전송되지 않습니다.</li></ul></div></aside></div></main>
}

function ContributionHistoryPage({ state }: { state: AppState }) {
  const router = useRouter()
  const contributions = [...state.contributions].reverse()
  return <main className="page-wrap max-w-4xl"><button onClick={() => router.push("/contribute")} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />자소서 기여로 돌아가기</button><section className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">MY CONTRIBUTIONS</p><h1 className="page-title">내 기여 내역</h1><p className="page-subtitle">지금까지 기여한 자소서와 결과를 확인하세요.</p></div><Button onClick={() => router.push("/contribute")} className="h-11 bg-blue-600 px-5 hover:bg-blue-700"><Plus />새 기여</Button></section>{contributions.length ? <div className="space-y-4">{contributions.map((item) => <article key={item.id} className="surface-card p-5"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`status status-${item.result}`}>{statusLabel[item.result]}</span><span className="text-xs font-semibold text-slate-400">{item.applicationPeriod}</span></div><h2 className="mt-2 text-lg font-bold">{item.company}</h2><p className="text-sm text-slate-500">{item.role}</p></div><span className="text-xs font-semibold text-slate-400">문항 {item.questions.length}개</span></div><div className="mt-4 space-y-3 border-t border-slate-100 pt-4">{item.questions.map((question, index) => <div key={index}><p className="text-sm font-bold text-slate-700">Q{index + 1}. {question.question || "질문 미입력"}</p><p className="mt-1 line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-500">{question.answer}</p></div>)}</div><p className="mt-4 text-right text-xs text-slate-400">{new Date(item.createdAt).toLocaleDateString("ko-KR")} 기여 · +500 크레딧</p></article>)}</div> : <div className="surface-card grid min-h-64 place-items-center p-8 text-center"><div><FilePlus2 className="mx-auto size-10 text-blue-500" /><h2 className="mt-4 text-lg font-bold">아직 기여한 자소서가 없어요</h2><p className="mt-2 text-sm leading-6 text-slate-500">과거 자소서를 기여하면 500 크레딧을 받고, 여기에서 이력을 확인할 수 있어요.</p><Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={() => router.push("/contribute")}><Plus />자소서 기여하러 가기</Button></div></div>}</main>
}

const creditPacks = [
  { credits: 1000, price: "5,000원", tag: "" },
  { credits: 3000, price: "13,500원", tag: "10% 추가" },
  { credits: 6000, price: "24,000원", tag: "인기" },
  { credits: 12000, price: "42,000원", tag: "20% 추가" },
]

function CreditChargePage({ state }: { state: AppState }) {
  const router = useRouter()
  const [selected, setSelected] = useState(creditPacks[1].credits)
  const charge = () => {
    const pack = creditPacks.find((item) => item.credits === selected)
    if (!pack) return
    localServices.credits.charge(pack.credits, "크레딧 충전")
    toast.success(`${pack.credits.toLocaleString()} 크레딧을 충전했어요.`)
  }
  return <main className="page-wrap max-w-4xl"><button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />돌아가기</button><section className="mb-8"><p className="eyebrow">CREDIT</p><h1 className="page-title">크레딧 충전</h1><p className="page-subtitle">AI 코치와 분석 기능에 사용할 크레딧을 충전하세요.</p></section><div className="grid gap-6 lg:grid-cols-[1fr_320px]"><div className="surface-card p-6"><div className="grid gap-3 sm:grid-cols-2">{creditPacks.map((pack) => <button key={pack.credits} type="button" onClick={() => setSelected(pack.credits)} className={`relative rounded-2xl border p-5 text-left transition ${selected === pack.credits ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20" : "border-slate-200 hover:border-blue-200 hover:bg-slate-50"}`}>{pack.tag && <span className="absolute right-4 top-4 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">{pack.tag}</span>}<div className="flex items-center gap-2 text-blue-600"><Coins className="size-5" /><strong className="text-2xl tracking-tight text-slate-950">{pack.credits.toLocaleString()}</strong><span className="text-sm font-semibold text-slate-500">크레딧</span></div><p className="mt-3 text-sm font-bold text-slate-700">{pack.price}</p></button>)}</div><Button onClick={charge} className="mt-6 h-12 w-full bg-blue-600 text-base hover:bg-blue-700"><CreditCard />{selected.toLocaleString()} 크레딧 충전하기</Button><p className="mt-4 text-center text-xs leading-5 text-slate-400">목업에서는 실제 결제가 이뤄지지 않고 즉시 잔액에 반영됩니다.</p></div><aside className="space-y-4"><div className="rounded-2xl bg-slate-950 p-6 text-white"><Coins className="size-8 text-amber-400" /><p className="mt-5 text-sm text-slate-400">현재 보유 크레딧</p><p className="mt-1 text-3xl font-bold">{state.creditBalance.toLocaleString()}</p><p className="mt-5 border-t border-slate-800 pt-5 text-sm leading-6 text-slate-400">AI 코치 10 · AI 분석 100 크레딧이 사용됩니다.</p></div><div className="surface-card p-5"><h2 className="font-bold">크레딧이 부족하다면</h2><p className="mt-3 text-sm leading-6 text-slate-500">과거 자소서 결과를 기여하면 1건당 500 크레딧을 무료로 받을 수 있어요.</p><Button variant="outline" className="mt-4 w-full" onClick={() => router.push("/contribute")}><FilePlus2 />자소서 기여하고 받기</Button></div></aside></div></main>
}

function NotFound() { const router = useRouter(); return <main className="grid min-h-[70vh] place-items-center text-center"><div><h1 className="text-2xl font-bold">프로젝트를 찾을 수 없어요</h1><Button className="mt-4" onClick={() => router.push("/hub")}>허브로 이동</Button></div></main> }
