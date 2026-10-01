#!/usr/bin/env python3
"""Synthetic contribution seeder for CoverLetterIDE.

Generates N synthetic cover-letter contributions (합격/불합격) using OpenAI,
embeds each answer, and inserts them into Supabase so the AI analysis
(`analyze-project`) has a non-empty comparison pool (cold-start fix).

Pipeline per record:
  1. Sample demographics (직군/성별/학교/전공/회사/합불) from predefined pools.
  2. Ask an OpenAI chat model to write a realistic Korean cover-letter answer
     consistent with those conditions and the pass/fail outcome.
  3. Create (or reuse) a synthetic Supabase auth user so FK integrity holds.
  4. Insert contribution + question + embedding, marked anonymized &
     quality_status='accepted' so `match_contribution_embeddings` returns them.

This writes to a REAL Supabase project using the service role key. It is a
local developer/testing tool only. Do NOT run against production data.

Usage:
  cd seed
  python -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt
  python seed_contributions.py --count 100

Config is read from ../web/.env.local by default (override with --env-file).
Required keys: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx
from openai import OpenAI

# ---------------------------------------------------------------------------
# Demographic & scenario pools (sampled independently per record).
# ---------------------------------------------------------------------------

ROLES = [
    "백엔드 개발", "프론트엔드 개발", "데이터 분석", "데이터 사이언티스트",
    "제품 기획(PM)", "마케팅", "영업", "인사(HR)", "재무/회계", "UX 디자인",
    "경영기획", "생산관리", "품질관리", "연구개발(R&D)",
]

GENDERS = ["남성", "여성", "응답 안 함"]

SCHOOLS = [
    "서울대학교", "연세대학교", "고려대학교", "성균관대학교", "한양대학교",
    "서강대학교", "중앙대학교", "경희대학교", "부산대학교", "경북대학교",
    "KAIST", "POSTECH", "이화여자대학교", "숙명여자대학교", "지방거점국립대",
]

MAJORS = [
    "컴퓨터공학", "산업공학", "경영학", "경제학", "통계학", "전자공학",
    "기계공학", "화학공학", "심리학", "미디어커뮤니케이션", "디자인", "수학",
]

COMPANIES = [
    "삼성전자", "SK하이닉스", "네이버", "카카오", "LG전자", "현대자동차",
    "쿠팡", "배달의민족(우아한형제들)", "토스(비바리퍼블리카)", "당근",
    "KB국민은행", "신한은행", "CJ제일제당", "아모레퍼시픽", "한화시스템",
    "LG CNS", "삼성SDS", "넥슨", "엔씨소프트", "라인",
]

RESULTS = ["passed", "failed"]
# 데이터 풀이 합격/불합격 모두 충분하도록 가중치를 거의 반반으로 둔다.
RESULT_WEIGHTS = [0.5, 0.5]

GRADUATION_YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"]

QUESTION_TEMPLATES = [
    "지원 동기와 입사 후 목표를 작성해 주세요.",
    "본인의 강점과 그것을 발휘한 경험을 구체적으로 서술해 주세요.",
    "가장 도전적이었던 경험과 그로부터 배운 점을 작성해 주세요.",
    "지원 직무와 관련된 역량을 키우기 위해 노력한 경험을 서술해 주세요.",
    "협업 과정에서 갈등을 해결한 경험을 작성해 주세요.",
]

CONSENT_VERSION = "2026-10-v1-synthetic"
EMBED_MODEL_DEFAULT = "text-embedding-3-small"
CHAT_MODEL_DEFAULT = "gpt-4.1-mini"
EMBED_DIM = 1536  # must match contribution_embeddings.vector(1536)


@dataclass
class Scenario:
    role: str
    gender: str
    school: str
    major: str
    company: str
    result: str
    graduation: str
    question: str

    def summary(self) -> str:
        outcome = "합격" if self.result == "passed" else "불합격"
        return (
            f"{self.school} {self.major} 졸업({self.graduation}), {self.gender}, "
            f"{self.company} {self.role} 직무 지원 결과 {outcome}"
        )


def sample_scenario(rng: random.Random) -> Scenario:
    return Scenario(
        role=rng.choice(ROLES),
        gender=rng.choice(GENDERS),
        school=rng.choice(SCHOOLS),
        major=rng.choice(MAJORS),
        company=rng.choice(COMPANIES),
        result=rng.choices(RESULTS, weights=RESULT_WEIGHTS, k=1)[0],
        graduation=rng.choice(GRADUATION_YEARS),
        question=rng.choice(QUESTION_TEMPLATES),
    )


# ---------------------------------------------------------------------------
# Config loading (reads web/.env.local without extra deps).
# ---------------------------------------------------------------------------

def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_config(env_file: Path) -> dict[str, str]:
    file_values = load_env_file(env_file)

    def pick(*names: str) -> str | None:
        for name in names:
            if os.environ.get(name):
                return os.environ[name]
            if file_values.get(name):
                return file_values[name]
        return None

    supabase_url = pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")
    service_key = pick("SUPABASE_SERVICE_ROLE_KEY")
    openai_key = pick("OPENAI_API_KEY")
    chat_model = pick("OPENAI_CHAT_MODEL") or CHAT_MODEL_DEFAULT
    embed_model = pick("OPENAI_EMBEDDING_MODEL") or EMBED_MODEL_DEFAULT

    missing = [
        name
        for name, value in [
            ("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", service_key),
            ("OPENAI_API_KEY", openai_key),
        ]
        if not value
    ]
    if missing:
        print(f"[error] missing config: {', '.join(missing)}", file=sys.stderr)
        print(f"        looked in environment and {env_file}", file=sys.stderr)
        sys.exit(1)

    return {
        "supabase_url": supabase_url.rstrip("/"),  # type: ignore[union-attr]
        "service_key": service_key,  # type: ignore[typeddict-item]
        "openai_key": openai_key,  # type: ignore[typeddict-item]
        "chat_model": chat_model,
        "embed_model": embed_model,
    }


# ---------------------------------------------------------------------------
# Supabase REST helpers (service role; bypasses RLS).
# ---------------------------------------------------------------------------

class Supabase:
    def __init__(self, url: str, service_key: str) -> None:
        self.url = url
        self.key = service_key
        self.client = httpx.Client(timeout=30.0)

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    def find_user_by_email(self, email: str) -> str | None:
        """Return the id of an existing auth user with this email, or None."""
        resp = self.client.get(
            f"{self.url}/auth/v1/admin/users",
            headers=self._headers(),
            params={"page": 1, "per_page": 200},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"list users failed: {resp.status_code} {resp.text}")
        payload = resp.json()
        users = payload.get("users", payload if isinstance(payload, list) else [])
        for user in users:
            if user.get("email") == email:
                return user["id"]
        return None

    def get_or_create_user(self, email: str, metadata: dict[str, str]) -> str:
        """Return a single synthetic auth user id, creating it once if needed.

        All synthetic contributions are attributed to this one account; the
        analysis only reads anonymized answers + embeddings, never the owner,
        so a single system account is sufficient and avoids creating one auth
        user per record. The on_auth_user_created trigger creates the matching
        profiles row and the current-month credit grant.
        """
        existing = self.find_user_by_email(email)
        if existing:
            return existing
        resp = self.client.post(
            f"{self.url}/auth/v1/admin/users",
            headers=self._headers(),
            json={
                "email": email,
                "email_confirm": True,
                "user_metadata": metadata,
                "password": uuid.uuid4().hex,
            },
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"create_user failed: {resp.status_code} {resp.text}")
        return resp.json()["id"]

    def insert_returning(self, table: str, row: dict) -> dict:
        resp = self.client.post(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers({"Prefer": "return=representation"}),
            json=row,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"insert {table} failed: {resp.status_code} {resp.text}")
        data = resp.json()
        return data[0] if isinstance(data, list) else data


# ---------------------------------------------------------------------------
# OpenAI generation.
# ---------------------------------------------------------------------------

def generate_answer(client: OpenAI, model: str, scenario: Scenario) -> str:
    outcome = "합격" if scenario.result == "passed" else "불합격"
    quality_hint = (
        "설득력 있고 직무 적합성이 분명하며 구체적 수치/사례가 담긴 우수한"
        if scenario.result == "passed"
        else "다소 일반적이고 추상적이며 직무 연결이 약해 아쉬운"
    )
    system = (
        "너는 한국 대학생의 자기소개서 작성자다. 실제 지원자가 쓴 것처럼 자연스러운 "
        "한국어 자소서 답변만 출력한다. 머리말·따옴표·설명 없이 본문만 작성한다. "
        "개인 식별 정보(실명/이메일/전화번호/주민번호)는 절대 포함하지 않는다."
    )
    user = (
        f"지원자 조건: {scenario.summary()}\n"
        f"문항: {scenario.question}\n"
        f"이 지원자는 서류 {outcome}한 지원자다. 결과에 어울리게 {quality_hint} 답변을 "
        f"600~900자 분량의 한국어로 작성해라. 문단은 2~3개로 나눈다."
    )
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.9,
    )
    return (completion.choices[0].message.content or "").strip()


def embed_text(client: OpenAI, model: str, text: str) -> list[float]:
    resp = client.embeddings.create(model=model, input=text)
    vector = resp.data[0].embedding
    if len(vector) != EMBED_DIM:
        raise RuntimeError(
            f"embedding dim {len(vector)} != expected {EMBED_DIM}; "
            f"use a {EMBED_DIM}-dim model (e.g. text-embedding-3-small)."
        )
    return vector


# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------

def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed(args: argparse.Namespace) -> None:
    config = resolve_config(Path(args.env_file))
    rng = random.Random(args.seed)
    supabase = Supabase(config["supabase_url"], config["service_key"])
    openai_client = OpenAI(api_key=config["openai_key"])

    run_tag = uuid.uuid4().hex[:8]

    # 합성 기여는 모두 단일 "시스템" 계정에 귀속한다. 분석은 익명 답변과 임베딩만
    # 사용하고 기여자 정체성은 보지 않으므로, 레코드마다 계정을 만들 필요가 없다.
    synthetic_email = args.account_email
    synthetic_user_id = supabase.get_or_create_user(
        synthetic_email,
        {"full_name": "합성 데이터 계정", "synthetic": "true"},
    )
    print(
        f"[info] seeding {args.count} contributions (run={run_tag}) -> {config['supabase_url']}\n"
        f"       all attributed to synthetic account {synthetic_email} ({synthetic_user_id})"
    )

    created = 0
    for index in range(args.count):
        scenario = sample_scenario(rng)
        try:
            answer = generate_answer(openai_client, config["chat_model"], scenario)
            if len(answer.strip()) < 100:
                print(f"[skip] #{index + 1} answer too short, skipping")
                continue
            embedding = embed_text(openai_client, config["embed_model"], answer)

            # contribution (anonymized + accepted so it is searchable)
            content_hash = hashlib.sha256(
                f"{run_tag}:{index}:{answer}".encode("utf-8")
            ).hexdigest()
            contribution = supabase.insert_returning(
                "contributions",
                {
                    "user_id": synthetic_user_id,
                    "company": scenario.company,
                    "role": scenario.role,
                    "application_period": f"{scenario.graduation}-{rng.randint(1, 12):02d}",
                    "result": scenario.result,
                    "consented_at": iso_now(),
                    "consent_version": CONSENT_VERSION,
                    "anonymized_at": iso_now(),
                    "quality_status": "accepted",
                    "content_hash": content_hash,
                },
            )

            # question (answer is already free of PII by generation prompt)
            question_row = supabase.insert_returning(
                "contribution_questions",
                {
                    "contribution_id": contribution["id"],
                    "position": 0,
                    "question": scenario.question,
                    "answer": answer,
                    "anonymized_answer": answer,
                },
            )

            # embedding
            supabase.insert_returning(
                "contribution_embeddings",
                {
                    "contribution_question_id": question_row["id"],
                    "embedding": embedding,
                    "embedding_model": config["embed_model"],
                },
            )

            created += 1
            print(f"[ok] #{index + 1}/{args.count} {scenario.summary()}")
        except Exception as error:  # noqa: BLE001 - log and continue seeding
            print(f"[fail] #{index + 1}: {error}", file=sys.stderr)
        time.sleep(args.sleep)

    print(f"[done] inserted {created}/{args.count} contributions.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed synthetic cover-letter contributions.")
    parser.add_argument("--count", type=int, default=100, help="number of records to generate (default 100)")
    parser.add_argument("--seed", type=int, default=42, help="RNG seed for reproducible sampling")
    parser.add_argument("--sleep", type=float, default=0.3, help="delay between records to ease rate limits")
    parser.add_argument(
        "--account-email",
        default="synthetic@seed.coverletteride.local",
        help="single synthetic account email that owns all seeded contributions (reused across runs)",
    )
    parser.add_argument(
        "--env-file",
        default=str(Path(__file__).resolve().parent.parent / "web" / ".env.local"),
        help="path to env file (default ../web/.env.local)",
    )
    seed(parser.parse_args())


if __name__ == "__main__":
    main()
