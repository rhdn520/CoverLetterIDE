"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeft, Award, BarChart3, BriefcaseBusiness, CalendarDays, Check, ChevronRight,
  Coins, Download, FilePlus2, FileText, FolderOpen, GraduationCap, LayoutDashboard,
  History, LogOut, MessageSquareText, Paperclip, Pencil, Plus, Send, Sparkles, Upload, X,
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
import { localServices } from "@/lib/local-services"
import type { AppState, ApplicationStatus, ChatSession, Essay, EvidenceFile, Project } from "@/lib/domain"

const statusLabel: Record<ApplicationStatus, string> = { pending: "대기중", passed: "합격", failed: "불합격" }
type ProposalRef = { sessionId: string; messageId: string; suggestionId: string }
const daysLeft = (date: string) => Math.ceil((new Date(date + "T23:59:59").getTime() - Date.now()) / 86400000)
const formatBytes = (bytes: number) => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`

function Logo() {
  return <div className="flex items-center gap-2.5"><div className="grid size-9 place-items-center rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-950/20"><FileText className="size-5" /></div><span className="text-lg font-bold tracking-[-0.03em]">CoverLetter<span className="text-blue-500">IDE</span></span></div>
}

function AppHeader({ state }: { state: AppState }) {
  const router = useRouter()
  return <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8"><button onClick={() => router.push("/hub")}><Logo /></button><nav className="hidden items-center gap-1 md:flex" aria-label="주요 메뉴"><NavButton icon={FolderOpen} label="프로젝트 허브" onClick={() => router.push("/hub")} /><NavButton icon={FilePlus2} label="자소서 기여" onClick={() => router.push("/contribute")} /></nav><div className="flex items-center gap-3"><div className="credit-pill"><Coins className="size-4" /><strong>{state.creditBalance.toLocaleString()}</strong><span className="hidden sm:inline">크레딧</span></div><button title="로그아웃" onClick={() => { localServices.auth.signOut(); router.push("/login") }} className="icon-button"><LogOut className="size-4" /></button></div></header>
}

function NavButton({ icon: Icon, label, onClick }: { icon: typeof FolderOpen; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Icon className="size-4" />{label}</button>
}

export function CoverLetterApp() {
  const state = useAppState()
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => { if (state && !state.user && pathname !== "/login" && pathname !== "/") router.replace("/login") }, [state, pathname, router])
  if (!state) return <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">워크스페이스를 불러오는 중…</div>
  if (!state.user || pathname === "/login" || pathname === "/") return <LoginPage />
  const workspace = pathname.match(/^\/projects\/([^/]+)\/workspace$/)
  const dashboard = pathname.match(/^\/projects\/([^/]+)\/dashboard$/)
  let page = <HubPage state={state} />
  if (pathname === "/contribute") page = <ContributePage state={state} />
  if (workspace) page = <WorkspacePage state={state} projectId={workspace[1]} />
  if (dashboard) page = <LegacyDashboardRoute state={state} projectId={dashboard[1]} />
  return <div className="min-h-screen bg-slate-50 text-slate-950"><AppHeader state={state} />{page}<Toaster position="bottom-right" /></div>
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
  const upload = async (files: FileList | null) => { for (const file of Array.from(files ?? [])) { try { await localServices.files.add(file); toast.success(`${file.name} 업로드 완료`) } catch (error) { toast.error(error instanceof Error ? error.message : "업로드에 실패했습니다.") } } }
  return <section className="surface-card overflow-hidden"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="section-title">증빙 자료</h2><p className="section-help">프로젝트에 필요한 파일을 한 곳에 모아두세요.</p></div><Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Upload />업로드</Button><input ref={inputRef} className="hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.hwpx" onChange={(event) => upload(event.target.files)} /></div><div className="p-3">{state.files.length ? state.files.map((file) => <FileRow key={file.id} file={file} />) : <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400"><div><Paperclip className="mx-auto mb-2 size-6" /><p>아직 업로드한 자료가 없어요.</p><p className="mt-1 text-xs">PDF, 이미지, DOC, HWPX 지원</p></div></div>}</div></section>
}

function FileRow({ file }: { file: EvidenceFile }) {
  return <div className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600"><FileText className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="text-xs text-slate-400">{formatBytes(file.size)}</p></div><button className="icon-button opacity-60 group-hover:opacity-100" title="다운로드" onClick={async () => { try { await localServices.files.download(file) } catch (error) { toast.error(error instanceof Error ? error.message : "다운로드 실패") } }}><Download className="size-4" /></button></div>
}

function ProjectCard({ project, onOpen, onEdit }: { project: Project; onOpen: () => void; onEdit: () => void }) {
  const dday = daysLeft(project.deadline)
  return <article className="surface-card group relative min-h-52 p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-950/5"><button onClick={onEdit} title="프로젝트 정보 수정" className="icon-button absolute right-14 top-4 z-10"><Pencil className="size-4" /></button><button onClick={onOpen} className="w-full text-left"><div className="flex items-center justify-between pr-24"><span className={`status status-${project.status}`}>{statusLabel[project.status]}</span><span className={`text-sm font-bold ${dday <= 3 ? "text-rose-600" : "text-blue-600"}`}>{dday >= 0 ? `D-${dday}` : `D+${Math.abs(dday)}`}</span></div><p className="mt-8 text-sm font-bold text-slate-500">{project.company}</p><h3 className="mt-1 text-xl font-bold tracking-tight">{project.title}</h3><p className="mt-2 text-sm text-slate-500">{project.role}</p><div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400"><span>{project.fileIds.length}개 첨부 자료</span><span className="flex items-center gap-1 text-blue-600 opacity-0 transition group-hover:opacity-100">워크스페이스 열기 <ChevronRight className="size-3" /></span></div></button></article>
}

function ProjectDialog({ open, onOpenChange, state, project }: { open: boolean; onOpenChange: (open: boolean) => void; state: AppState; project?: Project }) {
  const router = useRouter()
  const [form, setForm] = useState({ company: project?.company ?? "", role: project?.role ?? "", title: project?.title ?? "", deadline: project?.deadline ?? "", fileIds: project?.fileIds ?? state.files.map((file) => file.id) })
  const submit = (event: FormEvent) => { event.preventDefault(); if (!form.company.trim() || !form.role.trim() || !form.title.trim() || !form.deadline) return toast.error("필수 정보를 모두 입력해 주세요."); if (!project && daysLeft(form.deadline) < 0) return toast.error("오늘 이후의 마감일을 선택해 주세요."); if (project) { localServices.projects.update(project.id, form); localServices.projects.setFiles(project.id, form.fileIds); toast.success("프로젝트 정보를 수정했어요."); onOpenChange(false) } else { const created = localServices.projects.create(form); onOpenChange(false); router.push(`/projects/${created.id}/workspace`) } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{project ? "프로젝트 정보 수정" : "새 지원 프로젝트"}</DialogTitle><DialogDescription>{project ? "회사, 직무와 마감 정보를 변경할 수 있습니다." : "기업과 지원 정보를 입력하고 함께 사용할 자료를 선택하세요."}</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><FormField label="회사명 *" value={form.company} onChange={(company) => setForm({ ...form, company })} placeholder="예: 넥스트파이낸스" /><FormField label="지원 직무 *" value={form.role} onChange={(role) => setForm({ ...form, role })} placeholder="예: 서비스 기획" /><div className="sm:col-span-2"><FormField label="프로젝트명 *" value={form.title} onChange={(title) => setForm({ ...form, title })} placeholder="예: 2026 상반기 체험형 인턴" /></div><label className="sm:col-span-2"><span className="form-label">마감일 *</span><input className="text-input" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label></div><div><p className="form-label">포함할 증빙 자료</p><p className="mb-2 text-xs text-slate-400">필요한 자료만 선택하세요.</p><div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{state.files.length ? state.files.map((file) => <label key={file.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-slate-50"><Checkbox checked={form.fileIds.includes(file.id)} onCheckedChange={(checked) => setForm({ ...form, fileIds: checked ? [...form.fileIds, file.id] : form.fileIds.filter((fileId) => fileId !== file.id) })} /><FileText className="size-4 text-slate-400" /><span className="truncate text-sm font-semibold">{file.name}</span></label>) : <p className="p-3 text-center text-sm text-slate-400">선택할 자료가 없습니다.</p>}</div></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button><Button type="submit" className="bg-blue-600 hover:bg-blue-700">{project ? "수정 완료" : "프로젝트 만들기"}</Button></DialogFooter></form></DialogContent></Dialog>
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
  const [editOpen, setEditOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [proposalRef, setProposalRef] = useState<ProposalRef | null>(null)
  if (!project) return <NotFound />
  const essays = state.essays[projectId] ?? []
  const selectedEssay = essays.find((essay) => essay.id === selectedEssayId) ?? essays[0]
  const activeSuggestion = proposalRef ? state.chats[projectId]?.find((session) => session.id === proposalRef.sessionId)?.messages.find((message) => message.id === proposalRef.messageId)?.suggestions?.find((suggestion) => suggestion.id === proposalRef.suggestionId) : undefined
  const createEssay = () => { const essay = localServices.essays.create(project.id); setProposalRef(null); setSelectedEssayId(essay.id); setMobilePane("editor") }
  const previewSuggestion = (reference: ProposalRef & { essayId: string }) => { setSelectedEssayId(reference.essayId); setProposalRef(reference); setMobilePane("editor") }
  const filePane = <FilePane state={state} project={project} essays={essays} selectedEssayId={selectedEssay?.id ?? ""} onSelectEssay={(essayId) => { setProposalRef(null); setSelectedEssayId(essayId); setMobilePane("editor") }} onCreateEssay={createEssay} onManageFiles={() => setFilesOpen(true)} />
  const editorPane = activeSuggestion && proposalRef && selectedEssay ? <ProposalEditor project={project} essay={selectedEssay} reference={proposalRef} suggestion={activeSuggestion} onClose={() => setProposalRef(null)} /> : selectedEssay ? <EditorPane key={selectedEssay.id} project={project} essay={selectedEssay} /> : <EmptyEssay onCreate={createEssay} />
  const chatPane = <ChatPane state={state} project={project} essayId={selectedEssay?.id} onPreviewSuggestion={previewSuggestion} />
  const closeAnalysis = (open: boolean) => setAnalysisOpen(open)
  return <main className="workspace-shell"><div className="workspace-topbar"><button onClick={() => router.push("/hub")} className="icon-button"><ArrowLeft className="size-4" /></button><div className="min-w-0"><p className="truncate text-sm font-bold">{project.company} · {project.title}</p><p className="text-xs text-slate-400">{project.role}</p></div><button onClick={() => setEditOpen(true)} className="icon-button" title="프로젝트 정보 수정"><Pencil className="size-4" /></button><div className="ml-auto flex items-center gap-2"><button className="dashboard-link" onClick={() => setAnalysisOpen(true)}><BarChart3 className="size-4" /><span className="hidden sm:inline">AI 분석</span></button><StatusSelect project={project} /></div></div><div className="mobile-tabs"><button className={mobilePane === "files" ? "active" : ""} onClick={() => setMobilePane("files")}><FolderOpen />파일</button><button className={mobilePane === "editor" ? "active" : ""} onClick={() => setMobilePane("editor")}><FileText />작성</button><button className={mobilePane === "chat" ? "active" : ""} onClick={() => setMobilePane("chat")}><MessageSquareText />AI 코치</button></div><div className="hidden min-h-0 flex-1 lg:block"><ResizablePanelGroup orientation="horizontal"><ResizablePanel defaultSize={20} minSize={15}>{filePane}</ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={52} minSize={35}>{editorPane}</ResizablePanel><ResizableHandle withHandle /><ResizablePanel defaultSize={28} minSize={20}>{chatPane}</ResizablePanel></ResizablePanelGroup></div><div className="min-h-0 flex-1 lg:hidden">{mobilePane === "files" && filePane}{mobilePane === "editor" && editorPane}{mobilePane === "chat" && chatPane}</div>{editOpen && <ProjectDialog open={editOpen} onOpenChange={setEditOpen} state={state} project={project} />}{filesOpen && <ManageFilesDialog open={filesOpen} onOpenChange={setFilesOpen} state={state} project={project} />}{analysisOpen && <AnalysisDialog open={analysisOpen} onOpenChange={closeAnalysis} state={state} project={project} />}</main>
}

function StatusSelect({ project }: { project: Project }) {
  return <select aria-label="지원 결과" className={`status-select status-${project.status}`} value={project.status} onChange={(event) => { const next = event.target.value as ApplicationStatus; const reward = next !== "pending" && !project.resultRewarded; localServices.projects.updateStatus(project.id, next); if (reward) toast.success("결과 기여 보상 500 크레딧이 지급됐어요.") }}><option value="pending">대기중</option><option value="passed">합격</option><option value="failed">불합격</option></select>
}

function FilePane({ state, project, essays, selectedEssayId, onSelectEssay, onCreateEssay, onManageFiles }: { state: AppState; project: Project; essays: Essay[]; selectedEssayId: string; onSelectEssay: (id: string) => void; onCreateEssay: () => void; onManageFiles: () => void }) {
  const files = state.files.filter((file) => project.fileIds.includes(file.id))
  return <section className="pane bg-slate-950 text-slate-200"><div className="pane-heading border-slate-800"><div><p className="pane-kicker">EXPLORER</p><h2 className="font-bold">프로젝트 파일</h2></div></div><div className="min-h-0 flex-1 overflow-y-auto p-2"><div className="mb-1 flex items-center justify-between px-2 py-2 text-xs font-bold text-slate-500"><span className="flex items-center gap-2"><ChevronRight className="size-3 rotate-90" />COVER LETTER</span><button onClick={onCreateEssay} className="dark-icon-button" title="자소서 문항 추가"><Plus className="size-4" /></button></div>{essays.map((essay) => <button key={essay.id} onClick={() => onSelectEssay(essay.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${selectedEssayId === essay.id ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}><FileText className="size-4 shrink-0" /><span className="truncate">{essay.title}</span></button>)}<div className="mb-1 mt-5 flex items-center justify-between px-2 py-2 text-xs font-bold text-slate-500"><span className="flex items-center gap-2"><ChevronRight className="size-3 rotate-90" />ATTACHMENTS</span><button onClick={onManageFiles} className="dark-icon-button" title="허브 자료 선택 또는 업로드"><Paperclip className="size-4" /></button></div>{files.length ? files.map((file) => <button key={file.id} onClick={async () => { try { await localServices.files.download(file) } catch (error) { toast.error(error instanceof Error ? error.message : "다운로드 실패") } }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white"><Paperclip className="size-4 shrink-0 text-blue-400" /><span className="truncate">{file.name}</span></button>) : <p className="px-3 py-5 text-center text-xs leading-5 text-slate-500">연결된 증빙 자료가 없습니다.<br />클립 버튼으로 허브 자료를 선택하세요.</p>}</div><div className="border-t border-slate-800 p-4 text-xs leading-5 text-slate-500">문항별 파일을 선택하면 중앙 에디터에서 각각 작성할 수 있습니다.</div></section>
}

function EditorPane({ project, essay }: { project: Project; essay: Essay }) {
  const [title, setTitle] = useState(essay.title)
  const [question, setQuestion] = useState(essay.question)
  const [answer, setAnswer] = useState(essay.answer)
  const changed = title !== essay.title || question !== essay.question || answer !== essay.answer
  useEffect(() => {
    const syncAcceptedSuggestion = (event: Event) => {
      const detail = (event as CustomEvent<{ essayId: string; answer: string }>).detail
      if (detail.essayId === essay.id) setAnswer(detail.answer)
    }
    window.addEventListener("coverletteride:essay-accepted", syncAcceptedSuggestion)
    return () => window.removeEventListener("coverletteride:essay-accepted", syncAcceptedSuggestion)
  }, [essay.id])
  useEffect(() => { if (!changed) return; const timer = setTimeout(() => localServices.essays.save(project.id, essay.id, { title, question, answer }), 500); return () => clearTimeout(timer) }, [answer, changed, essay.id, project.id, question, title])
  const chars = answer.replace(/\s/g, "").length
  return <section className="pane bg-slate-100"><div className="pane-heading bg-white"><div><p className="pane-kicker text-blue-600">COVER LETTER</p><input aria-label="문항 파일명" value={title} onChange={(event) => setTitle(event.target.value)} className="w-full bg-transparent font-bold outline-none" /></div><span className="text-xs font-semibold text-slate-400">{changed ? "저장 중…" : "저장됨"}</span></div><div className="editor-scroll"><div className="document-page"><div className="mb-6"><p className="text-sm font-bold text-blue-600">{project.company} · {project.role}</p><label className="mt-5 block"><span className="form-label">질문</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} className="question-editor" placeholder="자기소개서 문항을 입력하세요." /></label></div><label><span className="form-label">답변</span><textarea aria-label="자기소개서 답변" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="이 문항에 대한 나만의 경험을 구체적으로 작성해 보세요…" className="essay-editor" /></label><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400"><span>공백 제외 {chars.toLocaleString()}자</span><span>권장 700–1,000자</span></div></div></div></section>
}

function EmptyEssay({ onCreate }: { onCreate: () => void }) {
  return <section className="pane grid place-items-center bg-slate-100"><div className="text-center"><FilePlus2 className="mx-auto size-10 text-blue-500" /><h2 className="mt-4 text-lg font-bold">작성할 문항을 추가하세요</h2><Button className="mt-4 bg-blue-600 hover:bg-blue-700" onClick={onCreate}><Plus />문항 추가</Button></div></section>
}

function ProposalEditor({ project, essay, reference, suggestion, onClose }: { project: Project; essay: Essay; reference: ProposalRef; suggestion: NonNullable<AppState["chats"][string][number]["messages"][number]["suggestions"]>[number]; onClose: () => void }) {
  const diff = createInlineDiff(suggestion.before, suggestion.after)
  const changeCount = diff.filter((part) => part.kind === "change").length
  const fallbackStatus = suggestion.status === "accepted" || suggestion.status === "rejected" ? suggestion.status : "pending"
  const decisions = Array.from({ length: changeCount }, (_, index) => suggestion.changeStatuses?.[index] ?? fallbackStatus)
  const status = suggestion.status === "accepted" ? "모두 반영됨" : suggestion.status === "rejected" ? "모두 거절됨" : suggestion.status === "partial" ? "일부 검토됨" : "검토 필요"
  let changeIndex = 0
  const decide = (index: number, decision: "accepted" | "rejected") => {
    if (decision === "accepted") localServices.acceptSuggestion(project.id, reference.sessionId, reference.messageId, suggestion.id, index)
    else localServices.rejectSuggestion(project.id, reference.sessionId, reference.messageId, suggestion.id, index)
    toast[decision === "accepted" ? "success" : "info"](`변경 ${index + 1}을 ${decision === "accepted" ? "반영했어요." : "거절했어요."}`)
  }
  return <section className="pane bg-slate-100">
    <div className="proposal-toolbar">
      <div className="min-w-0"><p className="pane-kicker text-blue-600">COVER LETTER · EDIT REVIEW</p><h2 className="truncate font-bold">{suggestion.essayTitle}</h2></div>
      <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${suggestion.status === "accepted" ? "bg-emerald-100 text-emerald-700" : suggestion.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{status}</span><button onClick={onClose} className="icon-button" title="검토 닫기"><X className="size-4" /></button></div>
    </div>
    <div className="editor-scroll"><div className="document-page">
      <div className="mb-6"><p className="text-sm font-bold text-blue-600">{project.company} · {project.role}</p><div className="mt-5"><span className="form-label">질문</span><p className="question-preview">{essay.question || "자기소개서 문항이 비어 있습니다."}</p></div></div>
      <div><span className="form-label">답변 · 변경 제안 {changeCount}곳</span><div className="proposal-document-text">{diff.map((part, index) => {
        if (part.kind === "equal") return <span key={index} className="proposal-context">{part.text}</span>
        const currentIndex = changeIndex++
        const decision = decisions[currentIndex]
        return <div key={index} className={`inline-review ${decision}`}><div className="inline-review-toolbar"><strong>변경 {currentIndex + 1}</strong>{decision === "pending" ? <div className="flex shrink-0 items-center gap-1.5"><Button size="sm" variant="outline" onClick={() => decide(currentIndex, "rejected")} className="h-7 gap-1 border-rose-200 px-2 text-[11px] text-rose-700 hover:bg-rose-50"><X className="size-3" />Reject</Button><Button size="sm" onClick={() => decide(currentIndex, "accepted")} className="h-7 gap-1 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"><Check className="size-3" />Accept</Button></div> : <span className={`change-decision ${decision}`}>{decision === "accepted" ? "반영됨" : "거절됨"}</span>}</div><div className="inline-hunk"><div className="inline-change before"><span className="change-marker">−</span><div><strong>원래 내용</strong><p>{part.before || "(추가되는 위치)"}</p></div></div><div className="inline-change after"><span className="change-marker">+</span><div><strong>수정본</strong><p>{part.after || "(삭제됨)"}</p></div></div></div></div>
      })}</div><p className="mt-3 text-xs text-slate-400">각 변경을 승인한 경우에만 해당 문장이 실제 답변에 반영됩니다.</p></div>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs font-semibold text-slate-400"><span>공백 제외 {suggestion.after.replace(/\s/g, "").length.toLocaleString()}자 (수정본)</span><span>권장 700–1,000자</span></div>
    </div></div>
  </section>
}

function ChatPane({ state, project, essayId, onPreviewSuggestion }: { state: AppState; project: Project; essayId?: string; onPreviewSuggestion: (reference: ProposalRef & { essayId: string }) => void }) {
  const [prompt, setPrompt] = useState("")
  const [contextIds, setContextIds] = useState<string[]>([])
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
  const send = () => {
    if (!prompt.trim()) return
    let sessionId = activeSessionId
    if (!sessionId) {
      const session = localServices.startChat(project.id)
      sessionId = session.id
      setActiveSessionId(session.id)
    }
    const contexts = contextIds.length ? contextIds : essayId ? [`essay:${essayId}`] : []
    const result = localServices.sendChat(project.id, sessionId, prompt.trim(), contexts)
    if (!result.ok) return toast.error(result.error)
    if (result.preview) onPreviewSuggestion({ sessionId, ...result.preview })
    setPrompt("")
    setContextIds([])
  }
  return <section className="pane bg-white"><div className="pane-heading"><div className="min-w-0"><div className="flex items-center gap-2"><div className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white"><Sparkles className="size-4" /></div><h2 className="truncate font-bold">{historyOpen ? "대화 기록" : activeSession?.title ?? "AI 커리어 코치"}</h2></div><p className="mt-1 truncate text-xs text-slate-400">{historyOpen ? `${sessions.length}개의 저장된 대화` : "여러 파일을 검토하고 수정안을 제안해요 · 10 크레딧"}</p></div><div className="flex gap-1"><button onClick={() => setHistoryOpen(!historyOpen)} className={`icon-button ${historyOpen ? "border-blue-200 bg-blue-50 text-blue-700" : ""}`} title="대화 기록"><History className="size-4" /></button><button onClick={startNewChat} className="icon-button" title="새 대화"><Plus className="size-4" /></button></div></div>{historyOpen ? <ChatHistory sessions={sessions} activeSessionId={activeSessionId} onSelect={(sessionId) => { setActiveSessionId(sessionId); setHistoryOpen(false) }} onNew={startNewChat} /> : <><div className="chat-scroll">{messages.length ? messages.map((message) => <div key={message.id} className={`chat-message ${message.role}`}><span>{message.role === "assistant" ? "AI 코치" : "나"}</span><p>{message.content}</p>{message.references?.length ? <div className="mt-2 flex flex-wrap gap-1">{message.references.map((name) => <span key={name} className="context-chip">@{name}</span>)}</div> : null}{message.reasoning?.length ? <details className="reasoning-panel" open><summary>검토 과정 보기</summary><ol>{message.reasoning.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></details> : null}{message.suggestions?.map((suggestion) => <SuggestionCard key={suggestion.id} sessionId={activeSessionId} messageId={message.id} suggestion={suggestion} onPreview={onPreviewSuggestion} />)}</div>) : <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-slate-700"><strong className="mb-1 block text-blue-700">새 대화를 시작해 보세요</strong>@를 입력해 여러 문항이나 자료를 태그하고 수정 방향을 알려주세요. 원문은 사용자가 제안을 승인하기 전까지 바뀌지 않습니다.</div>}<div className="mt-3 flex flex-wrap gap-2">{["성과를 수치 중심으로 다듬어줘", "직무와 연결해 수정해줘", "모든 문항의 어조를 통일해줘"].map((text) => <button key={text} onClick={() => setPrompt(text)} className="prompt-chip">{text}</button>)}</div></div><div className="border-t border-slate-200 p-3">{selectedContexts.length ? <div className="mb-2 flex flex-wrap gap-1">{selectedContexts.map((item) => <button key={item.id} onClick={() => setContextIds((current) => current.filter((id) => id !== item.id))} className="context-chip">@{item.name} ×</button>)}</div> : null}<div className="relative"><div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 focus-within:border-blue-400">{mentionCandidates.length ? <div className="mention-menu">{mentionCandidates.map((item) => <button key={item.id} onClick={() => chooseContext(item.id, item.name)}><span className="grid size-7 place-items-center rounded-lg bg-blue-50 text-blue-600">{item.kind === "자소서" ? <FileText className="size-4" /> : <Paperclip className="size-4" />}</span><span><strong>{item.name}</strong><small>{item.kind}</small></span></button>)}</div> : null}<textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send() } }} placeholder="@로 파일을 태그하고 수정 방향을 알려주세요" className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><button onClick={send} className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-600 text-white hover:bg-blue-700" aria-label="메시지 보내기"><Send className="size-4" /></button></div></div></div></>}</section>
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
  const run = () => { const result = localServices.runAnalysis(project.id); if (!result.ok) toast.error(result.error); else if (result.cached) toast.info("동일한 내용의 저장된 분석을 불러왔어요."); else toast.success("새 분석이 완료됐어요. 100 크레딧을 사용했습니다.") }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-[min(1100px,calc(100vw-2rem))]"><DialogHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5 text-left"><div className="flex items-end justify-between gap-4 pr-8"><div><p className="eyebrow">AI ANALYSIS</p><DialogTitle className="text-2xl tracking-tight">{project.company} 지원 분석</DialogTitle><DialogDescription className="mt-1">워크스페이스를 벗어나지 않고 현재 문서의 완성도를 확인하세요.</DialogDescription></div><Button onClick={run} className="shrink-0 bg-blue-600 hover:bg-blue-700"><Sparkles />{report ? "다시 분석" : "100 크레딧으로 분석"}</Button></div></DialogHeader><div className="bg-slate-50 p-4 sm:p-6"><div className="grid gap-4 sm:grid-cols-3"><MetricCard label="마감까지" value={`D-${Math.max(0, daysLeft(project.deadline))}`} help={project.deadline} /><MetricCard label="현재 상태" value={statusLabel[project.status]} help="워크스페이스에서 변경 가능" /><MetricCard label="비교 데이터" value={report ? "10건" : "준비됨"} help="Top-20 재정렬 후 합격 5 · 불합격 5" /></div>{report ? <ReportContent report={report} /> : <div className="mt-5 grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white text-center"><div className="max-w-md p-8"><LayoutDashboard className="mx-auto size-10 text-blue-500" /><h2 className="mt-4 text-xl font-bold">아직 분석 결과가 없어요</h2><p className="mt-2 text-sm leading-6 text-slate-500">현재 프로필과 자소서를 기준으로 합성된 익명 사례를 비교해 강점과 보완점을 찾습니다. 실제 JEV 또는 벡터 검색은 연결되지 않은 목업입니다.</p></div></div>}</div></DialogContent></Dialog>
}

function MetricCard({ label, value, help }: { label: string; value: string; help: string }) { return <div className="surface-card p-5"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-3 text-3xl font-bold tracking-tight">{value}</p><p className="mt-2 text-xs text-slate-400">{help}</p></div> }

function ReportContent({ report }: { report: AppState["reports"][number] }) {
  return <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><section className="surface-card grid place-items-center p-8"><div className="score-ring" style={{ background: `conic-gradient(#2563eb ${report.score}%, #e2e8f0 0)` }}><div><strong>{report.score}</strong><span>/ 100</span></div></div><h2 className="mt-5 text-xl font-bold">완성도가 좋아지고 있어요</h2><p className="mt-2 text-center text-sm leading-6 text-slate-500">경험의 구조는 명확합니다. 수치와 회사 맥락을 더하면 설득력이 높아집니다.</p><Progress value={report.score} className="mt-6" /></section><section className="space-y-5"><ReportSection title="잘하고 있는 점" tone="good" items={report.strengths} /><ReportSection title="보완이 필요한 점" tone="warn" items={report.weaknesses} /><ReportSection title="다음 수정 제안" tone="action" items={report.suggestions} /></section><div className="lg:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong>목업 안내:</strong> 이 결과는 화면 검증을 위한 결정론적 모의 분석입니다. 실제 사용자 자소서, 임베딩 또는 JEV 모델을 사용하지 않습니다.</div></div>
}

function ReportSection({ title, tone, items }: { title: string; tone: "good" | "warn" | "action"; items: string[] }) { return <div className="surface-card p-5"><h3 className="font-bold">{title}</h3><ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-slate-600"><span className={`mt-2 size-1.5 shrink-0 rounded-full report-dot-${tone}`} />{item}</li>)}</ul></div> }

function ContributePage({ state }: { state: AppState }) {
  const emptyForm = { company: "", role: "", applicationPeriod: "", result: "passed" as "passed" | "failed", questions: [{ question: "", answer: "" }] }
  const [form, setForm] = useState(emptyForm)
  const updateQuestion = (index: number, field: "question" | "answer", value: string) => setForm({ ...form, questions: form.questions.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!form.company.trim() || !form.role.trim() || !form.applicationPeriod) return toast.error("회사, 직무와 지원 시기를 입력해 주세요.")
    if (form.questions.some((item) => !item.question.trim() || item.answer.trim().length < 100)) return toast.error("각 문항과 100자 이상의 답변을 입력해 주세요.")
    localServices.contribute(form)
    setForm(emptyForm)
    toast.success("기여가 완료되어 500 크레딧을 받았어요!")
  }
  return <main className="page-wrap max-w-5xl"><section className="mb-8"><p className="eyebrow">DATA CONTRIBUTION</p><h1 className="page-title">과거 자소서로 크레딧 받기</h1><p className="page-subtitle">합격·불합격 결과를 공유하면 더 나은 분석 데이터를 만들고 500 크레딧을 받아요.</p></section><div className="grid gap-6 lg:grid-cols-[1fr_320px]"><form onSubmit={submit} className="surface-card space-y-6 p-6"><div className="grid gap-4 sm:grid-cols-2"><FormField label="회사명 *" value={form.company} onChange={(company) => setForm({ ...form, company })} placeholder="지원했던 회사" /><FormField label="지원 직무 *" value={form.role} onChange={(role) => setForm({ ...form, role })} placeholder="지원했던 직무" /><label><span className="form-label">지원 시기 *</span><input className="text-input" type="month" value={form.applicationPeriod} onChange={(event) => setForm({ ...form, applicationPeriod: event.target.value })} /></label><div><span className="form-label">지원 결과 *</span><div className="grid grid-cols-2 gap-2">{(["passed", "failed"] as const).map((result) => <button key={result} type="button" onClick={() => setForm({ ...form, result })} className={`result-option h-11 ${form.result === result ? "selected" : ""}`}><span className={`status status-${result}`}>{statusLabel[result]}</span>{form.result === result && <Check className="size-4 text-blue-600" />}</button>)}</div></div></div><div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="font-bold">자기소개서 문항</h2><p className="mt-1 text-xs text-slate-400">실제 제출했던 질문과 답변을 문항별로 입력하세요.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, questions: [...form.questions, { question: "", answer: "" }] })}><Plus />문항 추가</Button></div>{form.questions.map((item, index) => <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center justify-between"><strong className="text-sm">문항 {index + 1}</strong>{form.questions.length > 1 && <button type="button" onClick={() => setForm({ ...form, questions: form.questions.filter((_, itemIndex) => itemIndex !== index) })} className="text-xs font-bold text-rose-600">삭제</button>}</div><label><span className="form-label">질문 *</span><textarea className="question-editor bg-white" value={item.question} onChange={(event) => updateQuestion(index, "question", event.target.value)} placeholder="예: 지원 동기와 입사 후 목표를 작성해 주세요." /></label><label className="mt-3 block"><span className="form-label">답변 *</span><textarea className="contribution-editor min-h-52 bg-white" value={item.answer} onChange={(event) => updateQuestion(index, "answer", event.target.value)} placeholder="제출했던 답변을 입력해 주세요." /><span className="mt-2 block text-right text-xs text-slate-400">{item.answer.trim().length} / 최소 100자</span></label></div>)}</div><Button type="submit" className="h-12 w-full bg-blue-600 text-base hover:bg-blue-700">제출하고 500 크레딧 받기</Button></form><aside className="space-y-4"><div className="rounded-2xl bg-slate-950 p-6 text-white"><Coins className="size-8 text-amber-400" /><p className="mt-5 text-sm text-slate-400">현재 보유 크레딧</p><p className="mt-1 text-3xl font-bold">{state.creditBalance.toLocaleString()}</p><p className="mt-5 border-t border-slate-800 pt-5 text-sm leading-6 text-slate-400">기여 1건마다 500 크레딧이 즉시 지급됩니다.</p></div><div className="surface-card p-5"><h2 className="font-bold">데이터는 이렇게 사용돼요</h2><ul className="mt-3 space-y-3 text-sm leading-6 text-slate-500"><li>• 개인을 특정하는 정보는 분석 전에 제거합니다.</li><li>• 유사 지원자의 강점과 취약점을 찾는 데 활용합니다.</li><li>• 이 목업에서는 외부 서버로 전송되지 않습니다.</li></ul></div></aside></div></main>
}

function NotFound() { const router = useRouter(); return <main className="grid min-h-[70vh] place-items-center text-center"><div><h1 className="text-2xl font-bold">프로젝트를 찾을 수 없어요</h1><Button className="mt-4" onClick={() => router.push("/hub")}>허브로 이동</Button></div></main> }
