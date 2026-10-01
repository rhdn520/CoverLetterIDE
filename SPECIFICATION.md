# CoverLetterIDE 기능 명세

이 문서는 `prd.md`와 `new_requests.md`를 기준으로 프로젝트의 기능 요구사항과 구현 상태를 관리한다.

- `[x]` 현재 코드베이스에서 구현 및 확인됨
- `[ ]` 미구현 또는 추가 작업이 필요한 항목
- 기능을 구현하거나 변경할 때 관련 체크박스와 세부 설명도 함께 갱신한다.

> **구현 현황 요약:** 초기의 `localStorage`/IndexedDB 목업(`lib/local-services.ts`)에서 실제 Supabase 백엔드로 전환이 완료되었다. 현재 UI(`components/cover-letter-app.tsx`)는 `lib/supabase/services.ts`를 통해 Supabase Auth(Google OAuth), Postgres + RLS, Storage, Edge Functions, pgvector, Cron을 직접 호출한다. 웹 앱은 Cloudflare Workers(`vinext` 빌드)에서 호스팅된다. `local-services.ts`와 `synthetic-data.ts`는 더 이상 UI에 연결되어 있지 않다(레거시 목업). 남은 `[ ]` 항목은 주로 아직 UI로 노출되지 않은 편집 기능, 스트리밍, 실제 결제, 대량 시드 스크립트, 자동화 테스트/접근성 점검이다.

## 1. 공통 및 사용자 인증

- [x] Supabase Auth와 Google OAuth로 실제 로그인·세션 관리를 제공한다. (`/auth/callback`에서 PKCE 코드를 교환하고, 세션이 복원되면 `/hub`로 이동한다.)
- [x] 로그아웃하면 인증이 필요한 화면에서 로그인 화면으로 이동한다.
- [x] 사용자의 이름, 이메일과 잔여 크레딧을 화면에 표시한다. (크레딧은 서버 `credit_balance_detail` RPC 기준.)
- [x] 모바일과 데스크톱에서 핵심 기능을 사용할 수 있는 반응형 UI를 제공한다.
- [x] Supabase RLS 정책으로 사용자별 데이터 접근을 제한한다. (모든 사용자 소유 테이블에 `auth.uid()` 기반 정책 적용.)
- [x] OAuth 콜백에 PKCE 코드가 없고 세션이 이미 복원된 경우 거짓 로그인 오류 없이 `/hub`로 보낸다.

## 2. 프로젝트 허브

### 프로필

- [x] 학교, 전공, 졸업 시기, 주요 경험, 수상 내역을 조회하고 수정할 수 있다.
- [x] 프로필 변경 내용을 Supabase Postgres(`profiles`)에 저장한다. (낙관적 업데이트 후 실패 시 서버 상태로 복원.)
- [x] 프로필 값은 AI 분석 캐시 키(`analyze-project`의 sha256 소스)에 포함되어, 변경 시 분석 캐시가 자연스럽게 무효화된다.

### 첨부 자료

- [x] '증빙 자료' 섹션 제목을 '첨부 자료'로 표시한다. _(new_requests.md)_
- [x] PDF, JPG, JPEG, PNG, DOCX, HWPX, TXT, MD 파일을 업로드할 수 있다. (서버 허용 확장자 기준. 레거시 `.doc`는 미지원.)
- [x] 비공개 Supabase Storage(`evidence-files` 버킷)에 원본을 저장하고 Supabase Postgres(`evidence_files`)에서 메타데이터를 관리한다. 업로드 직후에는 `quarantined` 상태로 두고 처리 후 `ready`로 전환한다.
- [x] 업로드한 파일의 이름과 크기를 확인하고 서명 URL(60초)로 원본을 다운로드할 수 있다.
- [x] 워크스페이스에서 추가한 파일이 프로젝트 허브에도 표시된다.
- [x] 프로젝트 허브에서 파일을 클릭하면 미리보기 모달에서 열람할 수 있다. 이미지·PDF는 바로 표시하고, DOC·DOCX·HWPX는 다운로드로 안내한다. _(new_requests.md)_
- [x] 프로젝트 허브와 워크스페이스에서 파일을 삭제할 수 있고, 삭제 시 이를 참조하던 모든 프로젝트의 연결도 함께 제거된다. (Storage 원본 삭제 + `evidence_files` 삭제, `project_files`는 FK로 정리.) _(new_requests.md)_
- [x] 업로드 파일의 크기(최대 25MB), 확장자, 매직 바이트 시그니처를 Supabase Edge Function(`process-evidence`)에서 서버 검증한다. 불일치 시 `rejected` 상태로 표시한다.
- [x] PDF·이미지(OCR), DOCX·HWPX(OOXML/HWPX unzip), TXT·MD 텍스트 추출을 Supabase Edge Function(`process-evidence`)에서 수행한다. OCR은 OpenAI responses API를 사용한다.
- [x] 추출 텍스트와 상태(`extraction_status`)를 파일 메타데이터에 캐싱해 재사용한다. 파일 열람 가능 여부와 텍스트 추출 성공 여부는 독립적으로 관리한다(추출 실패해도 원본 열람 가능).
- [x] 파일 열람 패널에 AI 컨텍스트 추출 상태(추출 중·준비됨·미지원·실패)를 표시한다.
- [x] 추출 실패 시 재시도(`process-evidence` 재호출)를 지원한다.
- [x] 최초 추출이 실패한 파일을 이후 다시 사용(열람·AI 컨텍스트)하려 할 때 재시도 버튼을 노출하고, 재시도마저 실패하면 사용자에게 문제를 명확히 안내한다. _(new_requests.md)_
- [ ] 파일 이름을 변경할 수 있다. (UI 미제공.)

### 지원 프로젝트

- [x] 회사명, 지원 직무, 프로젝트명, 마감일을 입력해 프로젝트를 생성할 수 있다.
- [x] 필수 입력값과 과거 마감일을 검증한다.
- [x] 새 프로젝트에 포함할 허브 자료를 기본 선택 상태에서 제외할 수 있다.
- [x] 프로젝트 카드에서 회사, 직무, 상태, 마감 D-Day와 첨부 파일 수를 확인할 수 있다.
- [x] 생성된 프로젝트의 회사명, 직무, 프로젝트명과 마감일을 허브에서 수정할 수 있다. _(new_requests.md)_
- [x] 프로젝트 생성 모달 입력칸의 글자색을 진하게(검정) 표시한다. _(new_requests.md)_
- [x] 프로젝트 생성 모달을 닫으면 입력 내용을 초기화한다. _(new_requests.md)_
- [x] 프로젝트 생성 모달에서 직접 파일을 첨부할 수 있고, 첨부한 파일은 허브 첨부 자료와 해당 프로젝트 탐색기에 함께 노출된다. _(new_requests.md)_
- [x] 프로젝트와 첨부 자료 연결 정보를 Supabase Postgres(`projects`, `project_files`)에 저장한다.
- [x] 프로젝트 보관(archive) 기능을 서비스 계층(`projects.archive`, `archived_at`)에서 지원한다. (보관된 프로젝트는 목록에서 제외된다.)
- [ ] 프로젝트 삭제·보관을 사용자가 직접 실행하는 UI를 제공한다. (서비스 메서드는 있으나 화면 노출 미완.)

## 3. 3분할 워크스페이스

### 공통 레이아웃

- [x] 데스크톱에서 파일 탐색기, 자소서 에디터, AI 코치의 3분할 화면을 제공한다.
- [x] 사용자가 드래그해 각 패널의 너비를 조절할 수 있다.
- [x] 모바일에서는 파일, 작성, AI 코치 탭을 전환할 수 있다.
- [x] 워크스페이스에서 프로젝트 허브로 이동하고 AI 분석 모달을 열 수 있다.
- [x] 워크스페이스 상단에서 프로젝트 정보를 수정하는 모달을 제공한다. _(new_requests.md)_

### 파일 탐색기

- [x] 현재 프로젝트에 연결된 첨부 자료를 확인할 수 있다.
- [x] 새 파일을 업로드하면 현재 프로젝트와 프로젝트 허브에 함께 추가된다. (업로드 즉시 Storage 저장 + `process-evidence` 호출.)
- [x] 새 파일 업로드 외에 허브에 이미 등록된 자료를 선택해 현재 프로젝트에 추가할 수 있다. _(new_requests.md)_
- [x] 첨부 자료를 클릭하면 가운데 패널에서 열람하고, 문항을 선택하면 다시 편집기로 돌아간다. _(new_requests.md)_
- [x] 가운데 패널 열람 중 해당 첨부 자료를 삭제할 수 있다. _(new_requests.md)_
- [x] 좌측 탐색기의 각 첨부 자료를 개별 삭제할 수 있다. _(new_requests.md)_
- [x] 자소서 문항마다 별도의 작성 파일을 생성할 수 있다. (`essays` 테이블.) _(new_requests.md)_
- [x] 생성된 자소서 문항 파일을 좌측 탐색기에서 조회하고 선택할 수 있다. _(new_requests.md)_
- [x] 좌측 탐색기에서 작성 중인 자소서 문항을 삭제할 수 있고, 삭제 시 선택 문항을 자동 재지정한다. _(new_requests.md)_
- [x] 좌측 탐색기 하단의 '이 자소서 기여하기' 버튼으로 현재 문항들을 담아 기여 페이지로 이동한다. _(new_requests.md)_
- [ ] 자소서 문항 파일의 이름 변경을 지원한다. (UI 미제공.)

### 자소서 작성

- [x] 자소서 본문을 작성하고 500ms 디바운스로 자동 저장한다.
- [x] 공백을 제외한 글자 수와 권장 분량을 표시한다.
- [x] 자소서 변경 내용을 Supabase Postgres(`essays`)에 저장하고, `version` 기반 낙관적 동시성으로 충돌을 처리한다. (버전 불일치 시 서버 상태로 복원.)
- [x] 선택한 문항 파일별로 질문, 답변과 글자 수를 독립적으로 관리한다. _(new_requests.md)_
- [ ] 문항 추가는 가능하나 순서 변경과 문항 간 이동 UI는 미제공.

### AI 코치

- [x] 현재 프로젝트의 자소서 내용과 선택한 첨부 자료 텍스트를 컨텍스트로 사용해 실제 LLM(OpenAI)로 AI 답변을 생성한다. (`ai-chat` Edge Function → OpenAI chat completions, JSON 응답.)
- [x] 프로젝트 안에서 서로 분리된 새 대화를 시작할 수 있다. (`chat_sessions`.)
- [x] 프로젝트별 과거 대화 목록을 조회하고 원하는 대화를 다시 열 수 있다. (서버 저장된 `chat_sessions`/`chat_messages`.)
- [x] 첫 사용자 메시지를 기준으로 대화 제목을 자동 생성하고 최근 수정일과 메시지 수를 표시한다.
- [x] AI 코치가 하나 이상의 자소서 문항을 대상으로 수정안을 생성할 수 있다. _(new_requests.md)_
- [x] AI 수정 제안을 생성해도 별도 검토 화면으로 전환하지 않고 기존 자소서 편집기 안에 인라인 변경 블록을 표시한다.
- [x] 변경되지 않은 본문은 그대로 유지하고, 수정된 위치에만 원래 내용과 수정본을 위아래로 배치해 비교한다. _(new_requests.md)_
- [x] 각 수정 구간 바로 위에서 해당 변경만 개별 `Accept` 또는 `Reject`할 수 있다. _(new_requests.md)_
- [x] 일부 변경만 승인하면 승인된 문장만 본문에 반영하고 나머지는 원문으로 유지한다. (승인 결과를 `essays`와 `chat_messages.suggestions`에 함께 반영.)
- [x] 변경을 승인하거나 거절하면 해당 검토 블록은 즉시 사라지고 선택된 문장이 일반 본문으로 남는다.
- [x] 모든 변경을 처리하면 자동으로 일반 자소서 편집 상태로 돌아간다.
- [x] 변경별 처리 상태와 전체 제안의 일부 반영 상태를 새로고침 후에도 복원한다. (서버의 `suggestions` 상태 기준.)
- [x] 답변 전체를 별도 컨테이너로 감싸지 않고 실제로 바뀐 문장만 변경 블록으로 강조한다.
- [x] 여러 수정 구간이 함께 표시되어도 본문 흐름을 과도하게 가리지 않도록 변경 블록과 승인 도구를 컴팩트하게 표시한다.
- [x] 인라인 검토 화면과 채팅 제안 카드에는 별도의 수정 의도 설명을 표시하지 않는다.
- [x] 인라인 변경 블록의 `Reject`를 누르면 원본을 유지하고 제안 상태를 거절됨으로 기록한다.
- [x] 채팅 기록에서는 수정 제안의 처리 상태를 확인하고 중앙 검토 화면을 다시 열 수 있다.
- [x] 여러 자소서 문항과 첨부 자료를 한 요청의 컨텍스트로 선택할 수 있다. _(new_requests.md)_
- [x] `@` 입력 시 커서 위에 문항과 첨부 자료 목록을 표시하고 여러 항목을 태그할 수 있다. _(new_requests.md)_
- [x] 태그된 첨부 자료의 추출 텍스트와 선택 문항을 서버에서 컨텍스트 페이로드(`[자소서 문항]`, `[첨부자료]` 블록, 최대 50,000자)로 조립해 LLM에 전달한다. 추출 완료(`done`)된 자료만 사용한다.
- [x] 요청 해석, 보완점 확인과 수정안 생성으로 구성된 검토 과정(reasoning)을 사용자에게 표시한다. _(new_requests.md)_
- [x] AI 답변은 단순한 검토 문항 수 대신 사용자 요청에 따른 수정 제안의 취지와 중점 사항을 설명한다.
- [x] AI 메시지를 보낼 때 10 크레딧을 서버에서 차감한다. (`reserve_credits`, 요청 실패 시 `refund_credit_reservation`으로 환불.)
- [x] 크레딧이 부족하면 서버(402)에서 요청을 차단하고 안내한다.
- [x] 문장 구체화, 직무 연결과 근거 확인을 위한 빠른 질문을 제공한다.
- [x] `requestId` 기반으로 동일 요청의 중복 크레딧 차감을 방지한다(멱등 처리).
- [x] 메시지를 전송하면 보낸 메시지를 즉시 채팅창에 표시하고, 모델 응답 대기 중에는 '답변 작성중' 안내를 보여준다. _(new_requests.md)_
- [x] 전송 중에는 입력·전송을 비활성화해 중복 요청과 요청 폭주를 막는다. _(new_requests.md)_
- [x] 한글 등 IME 조합 중 Enter가 전송과 마지막 글자 중복 입력을 동시에 일으키던 문제를 수정한다(조합 종료 Enter는 전송하지 않음). _(new_requests.md)_
- [x] AI 수정 제안(Edit Proposal)이 돌아오면 가운데 패널에 인라인 비교(검토)가 뜨도록 하고, 수정 제안이 없으면 그 사실을 안내한다. _(new_requests.md)_
- [ ] 스트리밍 응답과 명시적 오류 재시도 UX를 지원한다. (현재는 단일 JSON 완성 응답.)
- [ ] 프롬프트에 포함되는 자소서 컨텍스트의 발신 사용자 PII를 추가 익명화한다. (분석/기여 경로는 익명화하나, 코치 요청은 본인 데이터 기준.)

### 지원 결과

- [x] 프로젝트 상태를 대기중, 합격, 불합격으로 저장할 수 있다. (`projects.status` 업데이트.)
- [x] 합격/불합격 여부 선택은 상태 저장만 수행하고, 크레딧 보상 로직과 분리한다. 보상은 자소서 기여 제출 시에만 지급된다. _(new_requests.md)_
- [x] 크레딧 지급/차감/환불은 모두 Supabase RPC(`reserve_credits`, `refund_credit_reservation`, `reward_accepted_contribution`) 트랜잭션으로 수행한다.

## 4. AI 분석 모달

- [x] 별도 화면으로 이동하지 않고 워크스페이스 위의 대형 모달로 분석 결과를 표시한다.
- [x] 모달을 닫으면 작성 중인 워크스페이스 상태와 선택한 문항을 그대로 유지한다.
- [x] 분석 모달을 열고 닫는 동작은 브라우저 방문 기록에 항목을 추가하지 않는다. _(new_requests.md)_
- [x] 기존 대시보드 URL은 방문 기록을 추가하지 않고 워크스페이스 URL로 치환한다.
- [x] 프로젝트 마감 D-Day와 현재 지원 상태를 표시한다.
- [x] 자소서 완성도를 0~100점 게이지와 진행 막대로 표시한다. (JEV `progress` 점수 × 25.)
- [x] 강점, 취약점과 다음 수정 제안을 보여주는 분석 리포트를 제공한다. (OpenAI로 생성, `analysis_reports`에 저장.)
- [x] 실제 Vector Embedding(OpenAI embeddings)으로 유사 자소서 Top-20을 pgvector(`match_contribution_embeddings`, HNSW/cosine)에서 검색한다.
- [x] JEV 모델(TypeSafe `systemone`)로 사용자 프로필 기반 진척도 평가와 후보 relevance 판정을 수행한다.
- [x] 상위 결과에서 합격 5건과 불합격 5건을 추출해 분석 프롬프트를 구성하고, 비교 데이터 수를 표시한다.
- [x] 프로필·프로젝트·자소서 본문·모델 버전으로 안정적인 캐시 키(sha256)를 생성한다.
- [x] 동일한 입력의 분석 결과는 서버 캐시(`analysis_reports`의 `cache_key`)에서 재사용하고 추가 크레딧을 차감하지 않는다.
- [x] 새로운 분석에는 100 크레딧을 차감하고 부족할 때 서버에서 실행을 차단한다. (실패 시 환불.)
- [x] 분석 실행 버튼은 비동기 호출을 올바르게 처리하고, 실행 중에는 로딩 상태로 중복 클릭을 막으며, 서버 오류(예: 500)는 사용자에게 실제 메시지로 안내한다. (이전에는 동기 호출로 처리돼 항상 실패 토스트가 뜨고 화면이 멈추던 문제를 수정.) _(new_requests.md)_
- [x] 분석 프롬프트에서 합격·불합격 사례의 기여자를 식별하지 못하도록 익명 사례만 사용하고, 시스템 프롬프트로 기여자 식별을 금지한다.
- [x] `quality_status = 'accepted'`이고 익명화된(`anonymized_at`) 기여 데이터만 유사 검색 대상에 포함한다.
- [ ] 프로필 변경 외 조건(예: 수동 무효화)에서의 캐시 만료 정책을 추가로 정의한다. (현재는 입력 해시 변경으로만 자연 무효화.)

## 5. 외부 자소서 기여

- [x] 과거 지원 회사와 직무를 입력할 수 있다.
- [x] 합격 또는 불합격 결과를 선택할 수 있다.
- [x] 각 문항에 최소 100자 이상의 답변을 제출할 수 있다. (클라이언트 + 서버 양쪽 검증.)
- [x] 제출이 완료되면 500 크레딧을 즉시 지급한다. (`reward_accepted_contribution` RPC, `earned` 버킷.)
- [x] 동의한 기여 데이터를 Supabase Postgres(`contributions`, `contribution_questions`)에 저장하고, 익명화한 답변을 pgvector(`contribution_embeddings`)에 임베딩·색인한다. (`index-contribution` Edge Function.)
- [x] 연도와 월 단위로 지원 시기를 입력할 수 있다. _(new_requests.md)_
- [x] 자소서 원문 단일 입력란을 질문과 답변 입력란으로 분리한다. _(new_requests.md)_
- [x] 사용자가 실제 문항 수에 맞춰 질문·답변 묶음을 추가하고 삭제할 수 있다. _(new_requests.md)_
- [x] 각 답변의 글자 수와 필수 입력 여부를 검증한다.
- [x] 워크스페이스에서 넘어온 경우 회사·직무·문항을 기여 폼에 자동으로 채운다. _(new_requests.md)_
- [x] 과거에 기여한 자소서 이력을 확인하는 별도 페이지(`/contributions`)를 제공한다. _(new_requests.md)_
- [x] 의미 없는 내용(100자 미만·동일 문자 반복)과 중복 제출(`content_hash` 유니크)을 서버에서 차단한다.
- [x] 저장 시 답변의 이메일·전화번호·주민번호 등 식별 정보를 `redact()`로 제거해 익명화 답변을 별도 저장한다.
- [ ] 허위 합격/불합격 결과 판별 등 심화 품질 검수(사람·AI 모더레이션)를 추가한다. (현재 `quality_status`는 제출 즉시 `accepted`로 설정.)

## 6. 크레딧 및 보상

- [x] 신규 사용자에게 가입(첫 OAuth 로그인) 시 기본 1,000 크레딧을 지급한다. (`handle_new_user` → `ensure_monthly_credits`.)
- [x] 기본(`monthly`) 크레딧과 기여 보상(`earned`) 크레딧을 분리된 버킷으로 관리한다. 월 기본 크레딧은 당월 만료, 보상 크레딧은 만료 없음.
- [x] 접속 시 당월 기본 크레딧이 없으면 멱등 키(`YYYY-MM`)로 1,000 크레딧을 지급한다. (`ensure_monthly_credits`.)
- [x] AI 코치 1회당 10 크레딧을 서버에서 차감한다.
- [x] 새로운 AI 분석 1회당 100 크레딧을 서버에서 차감한다.
- [x] 자소서 기여(외부 기여 폼 제출) 1건당 500 크레딧을 지급한다. 합격/불합격 상태 변경 자체는 보상과 분리한다. _(new_requests.md)_
- [x] `request_id`/참조 ID 유니크 제약으로 동일 행위의 보상·차감 중복을 방지한다.
- [x] 크레딧 증감 내역을 서버 원장(`credit_transactions`, `credit_grants`, `credit_spends`)에 저장한다.
- [x] 잔여 크레딧이 부족하면 AI 기능을 차단한다. (402 응답.)
- [x] 월별 크레딧 지급을 Supabase Cron(`pg_cron`, 매일 KST 00:05 체크, 1일에만 지급) 및 수동 호출용 Edge Function(`monthly-credits`)으로 처리한다.
- [x] 거래 내역을 조회하는 크레딧 화면(`/credits`)을 제공한다.
- [ ] 크레딧 충전 시 실제 결제(PG) 연동을 수행한다. (현재 결제 충전은 준비 중 안내만 노출.)
- [ ] AI 토큰 사용량 기반 과금 정책과 운영용 크레딧 정책(요금표)을 확정한다.

## 7. 데이터 및 Supabase

- [x] 핵심 도메인 타입과 Auth, Project, File, Essay, AI, Credit 서비스 경계를 정의한다. (`lib/domain.ts`.)
- [x] 도메인 타입을 문항별·다중 대화 세션(v3) 구조로 정의한다.
- [x] UI가 저장 구현에 직접 의존하지 않도록 서비스 계층(`lib/supabase/services.ts`)을 분리한다.
- [x] Supabase 테이블, 관계, RLS 정책, 인덱스를 SQL 마이그레이션으로 정의한다. (`supabase/migrations/*`.)
- [x] Supabase Auth, Postgres, Storage, Edge Functions, pgvector 기반 서비스 구현체를 제공한다.
- [x] 운영 하드닝 마이그레이션(크레딧 버킷/멱등 예약·환불, 파일 상태 머신, 기여 중복 해시, 문서 작업 기록, 자소서 버전 트리거)을 적용한다. (`202610010001_service_hardening.sql`.)
- [x] 사용자 데이터 내보내기(GET)와 계정·데이터 삭제(DELETE)를 Edge Function(`account-data`)으로 제공한다.
- [x] `EvidenceFile`에 추출 텍스트와 추출 상태를 두고 파일별로 추출 결과를 캐싱해 재사용한다.
- [ ] 콜드 스타트 테스트용 대량 합성 데이터 생성 및 DB 주입 스크립트를 작성한다. (현재 `lib/synthetic-data.ts`의 30건 생성기는 레거시 목업 전용이며, 서버 주입 스크립트는 없음.)
- [ ] 레거시 목업(`lib/local-services.ts`, `synthetic-data.ts`)을 정리하거나 개발용 전환 플래그로 명확히 분리한다.
- [ ] 개인정보 보존 기간 정책과 익명화 처리(`anonymized_at`)의 운영 기준을 문서화한다.

## 8. 품질 및 검증

- [x] TypeScript 검사를 통과한다.
- [x] ESLint 검사를 통과한다.
- [x] 프로덕션 빌드를 완료할 수 있다.
- [x] 주요 입력과 상태 변경에 성공 또는 오류 피드백을 제공한다.
- [x] 크레딧 정책과 파일 정책에 단위 테스트를 둔다. (`tests/credit-policy.test.ts`, `tests/file-policy.test.ts`.)
- [ ] AI·분석·기여 등 Supabase 연동 서비스 계층에 자동화 단위 테스트를 확대한다.
- [ ] 로그인부터 프로젝트 생성, 작성, 분석, 기여까지의 E2E 테스트를 추가한다.
- [ ] 키보드 탐색, 스크린 리더 레이블과 200% 확대 환경을 점검한다.
- [ ] RLS, 트랜잭션, Storage 업로드 실패와 네트워크 오류 시나리오를 실제 Supabase 환경에서 검증한다.

## 9. 최근 `new_requests.md` 반영 현황

Supabase 실연동 전환 이후 보고된 요청을 다음과 같이 처리했다.

1. [x] 채팅 전송 시 IME 조합 중 Enter로 마지막 글자가 중복 전송되던 문제를 수정한다. (ChatPane 입력 `onKeyDown`에서 조합 상태를 확인.)
2. [x] 전송한 메시지를 즉시 표시하고 응답 대기 중 '답변 작성중' 안내를 노출한다. (낙관적 사용자 메시지 + pending 표시, 전송 중 입력/버튼 비활성화.)
3. [x] AI 수정 제안(Edit Proposal)이 가운데 패널 인라인 비교로 열리도록 하고, 제안이 없을 때는 안내한다. 검토 표시 여부는 모델이 돌려준 `changeStatuses`가 아니라 실제 `before`/`after` diff의 변경 개수로 판정하며(모델이 `changeStatuses`를 비우거나 길이를 틀려도 검토 화면이 뜬다), 제안의 `essayId`가 유효하지 않으면 현재/첫 문항으로 보정한다. `ai-chat`도 저장 시 `essayId`를 실제 문항으로 매핑하고 `changeStatuses`를 비운다.
4. [x] 'AI 분석' 실행 시 비동기 호출을 올바르게 처리하고, 로딩 중 중복 클릭을 막으며, 서버 500 오류를 실제 메시지로 안내한다. (화면 멈춤·요청 폭주 완화.)
5. [x] 추출 실패 파일을 다시 사용할 때 재시도를 유도하고, 재시도도 실패하면 문제를 명확히 알린다.

> **참고(서버 측 과제):** `analyze-project` Edge Function의 500 자체는 Edge Function 런타임·환경 변수(OpenAI/TypeSafe 키, JEV 응답) 또는 pgvector 매칭 결과에 의존한다. 클라이언트는 오류를 안전하게 처리하도록 수정했으나, 실제 500 원인 해소는 Supabase 환경에서의 로그 확인이 필요하다.

## 10. 아키텍처 메모

- **호스팅/런타임:** Cloudflare Workers + `vinext`(Next 16 / React 19). 라우트는 `app/page.tsx`와 `app/[...slug]/page.tsx`가 모두 `CoverLetterApp` 하나를 렌더링하는 클라이언트 사이드 SPA 구조이며, `app/api/*` 폴더에는 실제 라우트 핸들러가 없다(브라우저가 Supabase를 직접 호출).
- **상태 관리:** `hooks/use-app-state.ts`가 `supabaseServices`의 전역 스토어를 구독한다. 각 액션은 낙관적 업데이트 후 실패 시 `refresh()`로 서버 상태를 다시 불러온다.
- **Edge Functions:** `ai-chat`(코치), `analyze-project`(JEV + 임베딩 + 리포트), `index-contribution`(기여 색인·보상), `process-evidence`(파일 검증·추출), `monthly-credits`(월 지급), `account-data`(내보내기/삭제). 공통 유틸은 `_shared/core.ts`(OpenAI/TypeSafe 호출, PII `redact`, user/service 클라이언트 분리).
- **크레딧 모델:** `credit_grants`(monthly/earned 버킷) + `credit_spends` + `credit_transactions` 원장. 예약(`reserve_credits`)·환불(`refund_credit_reservation`)은 `request_id` 멱등 처리.
- **데이터 전환 상태:** SPEC 초기 작성 시점의 "로컬 목업"은 Supabase 실연동으로 대체됨. 레거시 목업 파일은 UI에 연결되어 있지 않다.
