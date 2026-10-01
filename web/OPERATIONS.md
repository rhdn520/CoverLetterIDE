# CoverLetterIDE 운영 가이드

초기 운영 구조는 **Cloudflare Workers 호스팅 + Supabase Free 백엔드**입니다. Cloudflare는 웹 앱을 배포하고, Supabase는 인증·Postgres DB·RLS·Storage·Edge Functions·pgvector를 담당합니다.

## 전체 흐름

실제 작업은 아래 순서로 진행합니다.

```text
Cloudflare 첫 배포 → 운영 도메인 확보 → Supabase·Google OAuth 설정 →
로컬/배포 환경 변수 설정 → DB·Storage·AI 기능 배포
```

Google 로그인 흐름 자체는 아래와 같습니다.

```text
우리 Cloudflare 웹사이트 → Supabase Auth → Google 로그인 → Supabase callback → 우리 웹사이트
```

> 이 저장소에는 Google 로그인 버튼과 `/auth/callback` 라우트가 구현되어 있습니다. 이 문서는 이를 운영 환경에 연결하고 점검하는 순서입니다.

## 1. Cloudflare에 첫 배포하고 운영 주소 확인

먼저 빈 웹 앱이라도 Cloudflare에 올려 운영 주소를 확보합니다. 이 주소를 뒤에서 Google과 Supabase에 등록합니다.

`web` 폴더에서 아래를 차례대로 실행합니다.

```sh
npx wrangler login
npm run build
npx wrangler deploy --config dist/server/wrangler.json
```

- 첫 명령은 브라우저를 열어 Cloudflare 로그인과 권한 승인을 요청합니다.
- 두 번째 명령은 Cloudflare Worker용 배포 파일을 만듭니다.
- 마지막 명령은 `cover-letter-ide` Worker를 생성하고 배포합니다.

여러 Cloudflare 계정에 속해 있다면 먼저 아래로 사용할 계정을 확인합니다.

```sh
npx wrangler whoami
```

성공하면 터미널에 Worker URL이 출력됩니다. Cloudflare Dashboard → **Workers & Pages** → `cover-letter-ide` → Production deployment에서도 같은 주소를 확인할 수 있습니다.

```text
https://cover-letter-ide.<account-subdomain>.workers.dev
```

아래부터는 이 주소를 `WORKER_URL`이라고 부르겠습니다. 예시는 다음과 같습니다.

```text
WORKER_URL = https://coverletteride.choe-dev.workers.dev
```

`CLOUDFLARE_ACCOUNT_ID`나 API token은 CI 자동 배포에는 필요할 수 있지만, 위의 브라우저 로그인 방식으로 첫 배포를 할 때 앱의 `.env.local`에 넣을 필요는 없습니다.

## 2. Supabase 프로젝트 만들기

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 **New project**를 누릅니다.
2. 조직을 선택하고 프로젝트 이름(예: `coverletteride-staging`)과 강력한 데이터베이스 비밀번호를 정합니다.
3. 생성이 끝나면 **Project Settings > API Keys**에서 Project URL과 publishable/anon key를 확인합니다.
4. **Authentication > Providers > Google**을 열어 Google callback URL을 복사합니다.

```text
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

이 Supabase callback 주소는 다음 단계에서 Google에 등록합니다.

## 3. Google OAuth와 Supabase 연결

### Google Cloud Console

Google Cloud Console에서 **OAuth client ID → Web application**을 만듭니다.

**Authorized JavaScript origins**에는 Cloudflare에서 확보한 Worker 주소와 개발 주소를 추가합니다. 경로(`/auth/callback`)는 넣지 않습니다.

```text
WORKER_URL
http://localhost:5173
```

**Authorized redirect URIs**에는 우리 Worker 주소가 아니라 Supabase callback URL을 추가합니다.

```text
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

Google client ID와 client secret을 복사해 둡니다. 이 값은 브라우저 `.env.local`에 넣지 않습니다.

### Supabase Dashboard

1. **Authentication > Providers > Google**에서 Google provider를 활성화합니다.
2. Google client ID와 client secret을 붙여 넣고 저장합니다.
3. **Authentication > URL Configuration**을 열어 아래처럼 설정합니다.

| 항목 | 값 |
| --- | --- |
| Site URL | `WORKER_URL` |
| Redirect URLs | `WORKER_URL/auth/callback` |
| Redirect URLs | `http://localhost:5173/auth/callback` |

커스텀 도메인을 연결한 뒤에는 Worker 주소를 지우지 말고, 커스텀 도메인도 JavaScript origins와 Supabase Redirect URLs에 추가한 뒤 충분히 검증합니다.

## 4. 로컬·Cloudflare 환경 변수 설정

`.env.example`을 `.env.local`로 복사합니다.

macOS/Linux:

```sh
cp .env.example .env.local
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

| 변수 | 넣을 값 | 브라우저 노출 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | 가능 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key | 가능. RLS가 필수 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | 절대 금지 |
| `OPENAI_API_KEY` | OpenAI API key | 절대 금지 |
| `TYPESAFE_API_KEY` | TypeSafe Jev API key | 절대 금지 |
| `OPENAI_*_MODEL`, `JEV_MODEL` | 고정할 모델 버전 | 가능 |

`.env.local`은 Git에 커밋하지 않습니다. Google client secret, service role, OpenAI, TypeSafe 키는 브라우저 코드에 두지 않습니다.

Cloudflare Dashboard에서 Worker를 열고 **Settings → Variables and Secrets**에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 등록합니다. service role·OpenAI·TypeSafe 키는 Supabase Edge Function secret에서만 관리합니다.

## 5. 데이터베이스와 파일 저장소

테이블을 Dashboard에서 하나씩 만들 필요는 없습니다. 이 저장소의 [`supabase/migrations/202609300001_initial_schema.sql`](../supabase/migrations/202609300001_initial_schema.sql)에 스키마·인덱스·RLS·private Storage bucket·크레딧 RPC·pgvector 검색 함수를 모두 정의해 두었습니다.

Supabase project ref는 Project URL의 서브도메인입니다. 예를 들어 `https://abcdefghijk.supabase.co`라면 project ref는 `abcdefghijk`입니다. 저장소 루트에서 아래를 한 번 실행해 원격 프로젝트에 적용합니다.

```sh
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

`supabase db push`는 아직 원격에 적용되지 않은 migration만 순서대로 실행합니다. 이미 적용한 migration을 다시 실행하지 않습니다.

이 migration이 만드는 주요 테이블은 `profiles`, `projects`, `evidence_files`, `project_files`, `essays`, `chat_sessions`, `chat_messages`, `analysis_reports`, `contributions`, `contribution_questions`, `contribution_embeddings`, `credit_transactions`입니다.

모든 사용자 소유 테이블에 `user_id uuid references auth.users(id)`를 두고 RLS를 활성화합니다. 기본 정책은 `auth.uid() = user_id`인 행만 select/insert/update/delete할 수 있도록 작성합니다. 크레딧 차감·보상처럼 여러 행을 함께 바꾸는 작업은 security definer RPC로 원자 처리합니다.

`evidence-files` private Storage bucket을 만들고, 파일 경로를 `{user_id}/{file_id}/...` 형태로 구성합니다. public bucket을 사용하지 않고, 다운로드는 짧은 만료의 signed URL로 제공합니다.

## 6. AI·비동기 처리 설정

앞 단계의 migration이 `vector` 확장, `contribution_embeddings` 테이블과 pgvector Top-20 검색 함수를 이미 만듭니다. 이후 애플리케이션 기능을 구현하면서 다음을 연결합니다.

1. 동의·익명화된 기여 데이터만 Edge Function에서 embedding으로 변환해 `contribution_embeddings`에 기록합니다.
2. 문서 OCR·텍스트 추출·OpenAI/Jev 호출은 Supabase Edge Function에서 실행합니다.
3. 월 기본 크레딧은 migration의 `grant_monthly_credits` 함수를 Supabase Cron 또는 예약 Edge Function이 호출하도록 설정합니다.

Supabase Edge Function secret에는 OpenAI·TypeSafe와 service role처럼 브라우저에 노출되면 안 되는 값만 등록합니다. Dashboard 입력이나 CI secret 주입을 권장합니다.

### Edge Function 배포

저장소 루트에서 migration을 적용한 뒤 아래 함수를 배포합니다.

```sh
npx supabase functions deploy ai-chat
npx supabase functions deploy analyze-project
npx supabase functions deploy process-evidence
npx supabase functions deploy index-contribution
npx supabase functions deploy monthly-credits
npx supabase functions deploy account-data
```

비밀값은 [`supabase/functions/.env.example`](../supabase/functions/.env.example)을 기준으로 등록합니다. 실제 값을 명령 기록에 남기지 않도록 Dashboard의 Edge Function secrets 화면 또는 CI secret 주입을 사용합니다.

```sh
npx supabase secrets set OPENAI_API_KEY=... TYPESAFE_API_KEY=... CRON_SECRET=...
```

`202610010002_monthly_credit_cron.sql` migration은 매일 KST 00:05에 DB 내부의 월 지급 함수를 실행하는 Supabase Cron job을 등록합니다. 함수가 KST 날짜가 1일인지 다시 검사하고 월별 idempotency key를 쓰므로, 재시도되어도 같은 달 기본 크레딧을 중복 지급하지 않습니다. `monthly-credits` Edge Function은 운영자가 수동 점검 또는 외부 스케줄러를 쓸 때만 필요합니다.

Cloudflare에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`만 둡니다. `SUPABASE_SERVICE_ROLE_KEY`, OpenAI, TypeSafe, Cron secret은 Cloudflare에 설정하지 않습니다.

## 7. 배포 전 점검

1. 로그인하지 않은 사용자가 프로젝트·파일·크레딧을 읽을 수 없는지 확인합니다.
2. A 사용자가 B 사용자의 DB 행·Storage 파일을 읽거나 수정할 수 없는지 확인합니다.
3. private Storage 버킷에 public URL이 없는지 확인합니다.
4. Edge Function 로그에 원본 자소서나 API key가 남지 않는지 확인합니다.
5. staging에서 Google 로그인, 파일 업로드, 자소서 저장, AI 호출, 기여 보상, 월 지급을 검증합니다.

## 비용·보안 원칙

- Supabase Free 한도 안에서 시작하고 Storage·DB·함수 호출·egress 사용량을 Dashboard에서 주기적으로 확인합니다.
- OpenAI와 TypeSafe 호출 비용은 Supabase/Cloudflare 무료 플랜과 별개입니다. 사용자별 일·월 호출 한도와 크레딧을 적용합니다.
- API key가 유출되면 즉시 해당 공급자에서 폐기하고 Supabase Edge Function secret을 교체합니다.
- 계정 삭제 시 사용자 DB 행, Storage 원본, embedding을 삭제합니다. 기여 데이터는 동의 범위와 개인정보 처리 방침에 따라 익명화·삭제 정책을 적용합니다.
