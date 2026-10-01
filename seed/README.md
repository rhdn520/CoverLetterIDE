# 합성 기여 데이터 시더 (seed)

콜드 스타트 문제를 해결하기 위해, 합성 자기소개서 기여 데이터를 대량 생성해
Supabase에 주입하는 로컬 전용 스크립트입니다. 이 데이터가 있어야 AI 분석
(`analyze-project`)의 유사 사례 검색(`match_contribution_embeddings`)이 비어 있지
않게 됩니다.

> ⚠️ 이 스크립트는 **실제 Supabase 프로젝트에 service role 키로 직접 INSERT** 합니다.
> 로컬 개발·테스트 용도로만 사용하세요. 운영 데이터에 실행하지 마세요.

## 동작 방식

시작 시 **단일 합성 계정 1개**를 생성(이미 있으면 재사용)하고, 모든 합성 기여를 그
계정에 귀속합니다. 분석은 익명 답변과 임베딩만 사용하고 기여자 정체성은 보지 않으므로,
레코드마다 계정을 만들 필요가 없습니다.

레코드 1건당:

1. 인구통계·시나리오 풀(직군·성별·학교·전공·회사·합불)에서 샘플링합니다.
2. OpenAI 챗 모델로 그 조건과 합격/불합격 결과에 어울리는 한국어 자소서 답변을
   생성합니다. (프롬프트에서 실명·연락처 등 식별 정보를 넣지 않도록 지시)
3. `contributions` + `contribution_questions` + `contribution_embeddings`에
   삽입하며(단일 합성 계정 소유), `anonymized_at`과 `quality_status='accepted'`를
   설정해 분석의 유사 검색 대상이 되도록 합니다.

> 지원자 다양성(학교·전공·직군·회사·합불)은 `contributions`/`contribution_questions`
> 행 자체에 담기므로, 소유 계정이 하나여도 유사 사례 비교·재정렬 품질에는 영향이 없습니다.

생성되는 답변은 `text-embedding-3-small`(1536차원)로 임베딩되어
`contribution_embeddings.embedding`(vector(1536))에 저장됩니다.

## 사전 준비

- Python 3.10+
- Supabase 마이그레이션이 모두 적용된 프로젝트
- 다음 환경 변수. 기본적으로 `../web/.env.local`에서 읽습니다.
  - `SUPABASE_URL` 또는 `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` — **진짜 service role 키**여야 합니다.
    (RLS를 우회해 INSERT하고 인증 사용자를 생성하려면 필수. anon 키로는 실패합니다.)
  - `OPENAI_API_KEY`
  - (선택) `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL`

> `web/.env.local`의 `SUPABASE_SERVICE_ROLE_KEY`에 과거 anon 키가 잘못 들어 있던
> 적이 있습니다. 실행 전에 Supabase Dashboard → Project Settings → API에서 실제
> service role 키인지 확인하세요.

## 실행

```sh
cd seed
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 기본 100건 생성
python seed_contributions.py --count 100
```

옵션:

- `--count N` 생성 건수 (기본 100)
- `--seed N` 샘플링 재현용 RNG 시드 (기본 42)
- `--sleep S` 레코드 간 지연 초 (기본 0.3, 레이트리밋 완화)
- `--account-email EMAIL` 모든 합성 기여를 소유할 단일 계정 (기본 `synthetic@seed.coverletteride.local`, 재실행 시 재사용)
- `--env-file PATH` 환경 파일 경로 (기본 `../web/.env.local`)

## 주입 결과 확인

Supabase SQL Editor에서:

```sql
select
  (select count(*) from public.contributions where quality_status = 'accepted' and anonymized_at is not null) as searchable,
  (select count(*) from public.contribution_embeddings) as embeddings;
```

두 값이 늘어났다면 AI 분석에서 유사 사례 비교가 동작합니다.

## 정리(롤백)

모든 합성 기여는 단일 계정(기본 `synthetic@seed.coverletteride.local`)에 귀속됩니다.
Dashboard → Authentication → Users에서 그 계정을 삭제하면 `on delete cascade`로 연결된
모든 contributions·questions·embeddings가 함께 제거됩니다. (계정은 그대로 두고 데이터만
지우려면 SQL Editor에서 해당 user_id의 `contributions`를 삭제하면 하위도 cascade로 정리됩니다.)