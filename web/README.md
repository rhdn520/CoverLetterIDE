# CoverLetterIDE

대학생의 지원 자료 관리, 자기소개서 작성, AI 피드백과 결과 기여를 돕는 웹 애플리케이션입니다. 프런트엔드와 웹 런타임은 Cloudflare Workers에서 호스팅하고, 실제 서비스 백엔드는 Supabase를 사용합니다.

## 서비스 구성

- **Supabase Auth**: Google OAuth 로그인과 세션
- **Supabase Postgres + RLS**: 사용자별 데이터, 프로젝트, 자기소개서, 크레딧 원장
- **Supabase Storage**: 비공개 원본 파일
- **Supabase Edge Functions**: 문서 처리, OCR, OpenAI·TypeSafe Jev 서버 호출
- **pgvector**: 동의·익명화된 기여 데이터의 유사 사례 검색
- **Supabase Cron**: 월 기본 크레딧 지급
- **Cloudflare Workers**: Next/Vinext 앱의 호스팅과 정적·동적 웹 요청 처리

Cloudflare D1, R2, Queues, Vectorize는 이 초기 Supabase 구성에서 사용하지 않습니다.

## 사전 준비

- Node.js `>=22.13.0` (수업 환경에서는 LTS 권장)
- Supabase 프로젝트
- Google OAuth 웹 클라이언트
- OpenAI API 키 및 TypeSafe API 키(해당 AI 기능을 구현·검증할 때)

## 로컬 실행

```sh
cd web
npm ci
cp .env.example .env.local
npm run dev
```

브라우저에서 터미널에 표시된 주소(기본 `http://localhost:5173`)를 엽니다. `.env.local`에 실제 Supabase Project URL과 publishable/anon key를 입력해야 Supabase 연동 기능을 사용할 수 있습니다.

`NEXT_PUBLIC_`가 붙은 값은 브라우저에 노출될 수 있으므로 공개 가능한 Supabase URL과 anon key만 둡니다. `SUPABASE_SERVICE_ROLE_KEY`, OpenAI, TypeSafe 키는 절대로 클라이언트 코드나 Git에 넣지 않습니다.

## Supabase 설정

1. Supabase Dashboard에서 프로젝트를 만든 뒤 Project URL과 anon key를 `.env.local`에 넣습니다.
2. **Authentication > Providers > Google**에서 Google 로그인을 켭니다.
3. **Authentication > URL Configuration**에 개발 주소와 배포 주소를 Redirect URL로 등록합니다.
4. SQL migration으로 테이블, 인덱스, RLS 정책을 적용합니다. 모든 사용자 소유 테이블은 `auth.uid()` 기반 정책이 필요합니다.
5. Storage에 비공개 버킷을 만들고, 업로드·다운로드도 RLS 정책으로 소유자를 확인합니다.
6. OpenAI·TypeSafe 호출과 service role이 필요한 작업은 Supabase Edge Function에서만 실행합니다.

구체적인 순서, 환경 변수, 배포 전 보안 점검은 [운영 가이드](./OPERATIONS.md)를 따르세요.

## 명령어

- `npm run dev`: 개발 서버 실행
- `npm run build`: 배포용 Worker 빌드
- `npm run start`: 빌드된 Worker 로컬 미리보기
- `npm run lint`: ESLint 검사

## 배포

Cloudflare에는 웹 앱을 배포하고, Supabase에는 데이터베이스·인증·Storage·Edge Functions를 배포합니다. 배포 환경 변수는 Cloudflare와 Supabase Dashboard/CLI secret에 각각 등록하며, 실제 키가 담긴 `.env.local`은 커밋하지 않습니다.

## 참고

- [Supabase 문서](https://supabase.com/docs)
- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
