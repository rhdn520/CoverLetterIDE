import { authenticatedUser, clients, openAI, options, response, sha256, typesafe } from "../_shared/core.ts"

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  const reason = "project_analysis"
  let requestId = ""
  try {
    const { projectId, requestId: suppliedRequestId } = await request.json(); requestId = suppliedRequestId
    if (!projectId || !requestId) return response({ error: "Invalid request" }, 400)
    const { currentUser, user } = await authenticatedUser(request); const { service } = clients(request)
    const [{ data: profile }, { data: project }, { data: essays }] = await Promise.all([
      service.from("profiles").select("*").eq("id", currentUser.id).single(),
      service.from("projects").select("*").eq("id", projectId).eq("user_id", currentUser.id).single(),
      service.from("essays").select("*").eq("project_id", projectId).order("position"),
    ])
    if (!profile || !project) return response({ error: "Project not found" }, 404)
    // 비교 데이터 풀(기여 임베딩)의 지문. 건수가 바뀌면(새 기여/시드 주입) 캐시를
    // 무효화해, 데이터가 늘었는데 과거 "0건" 리포트가 재사용되는 문제를 막는다.
    const { count: poolCount } = await service.from("contribution_embeddings").select("id", { count: "exact", head: true })
    const source = JSON.stringify({ profile: [profile.school, profile.major, profile.graduation, profile.experiences, profile.awards], project: [project.company, project.role], essays: (essays ?? []).map((item) => [item.question, item.answer]), pool: poolCount ?? 0, model: [Deno.env.get("OPENAI_CHAT_MODEL"), Deno.env.get("OPENAI_EMBEDDING_MODEL"), Deno.env.get("JEV_MODEL")] })
    const cacheKey = await sha256(source)
    const { data: cached } = await service.from("analysis_reports").select("id").eq("user_id", currentUser.id).eq("cache_key", cacheKey).maybeSingle()
    if (cached) return response({ ok: true, cached: true })
    const { error: reserveError } = await user.rpc("reserve_credits", { p_amount: 100, p_reason: reason, p_request_id: requestId })
    if (reserveError) return response({ error: reserveError.message.includes("Insufficient") ? "크레딧이 부족합니다." : reserveError.message }, 402)
    try {
      const fullEssay = (essays ?? []).map((item) => `${item.question}\n${item.answer}`).join("\n\n")

      // 1) 임베딩 + 유사 사례 검색. 외부 의존(OpenAI/pgvector)이 실패해도 분석 전체를
      //    실패시키지 않고 "비교 사례 없음"으로 진행한다.
      let matches: any[] = []
      try {
        const embeddingResponse: any = await openAI("/embeddings", { model: Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small", input: `${profile.major}\n${profile.experiences}\n${project.company} ${project.role}\n${fullEssay}` })
        const embedding = embeddingResponse.data?.[0]?.embedding
        if (embedding) {
          const { data: matchData, error: matchError } = await service.rpc("match_contribution_embeddings", { query_embedding: embedding, match_count: 20 })
          if (matchError) console.error("match_contribution_embeddings failed:", matchError.message)
          else matches = matchData ?? []
        }
      } catch (embedError) {
        console.error("embedding/vector search failed, continuing without matches:", embedError instanceof Error ? embedError.message : embedError)
      }

      // 유사도 내림차순이 기본 순서(JEV 재정렬 실패 시 폴백).
      const bySimilarity = [...matches].sort((a: any, b: any) => Number(b.similarity) - Number(a.similarity))

      // 2) JEV(TypeSafe)로 (a) 진척도 점수와 (b) 프로필 기반 후보 재정렬을 받는다.
      //    PRD: Vector Top-20 -> JEV 프로필 재정렬 -> 합격5/불합격5.
      //    미설정/오류 시: 점수는 휴리스틱, 재정렬은 유사도 순으로 폴백한다.
      let score: number
      let modelVersion = `${Deno.env.get("OPENAI_CHAT_MODEL")}`
      let jevRanking: string[] = []
      if (matches.length) {
        try {
          const jev: any = await typesafe({ profile: { major: profile.major, experiences: profile.experiences, awards: profile.awards, school: profile.school }, target: { company: project.company, role: project.role }, essay: fullEssay, candidates: matches.map((item: any) => ({ id: item.contribution_question_id, company: item.company, role: item.role, result: item.result, question: item.question, answer: item.answer })) }, {
            progress: { type: "score", instructions: "Rate cover-letter readiness from 0 to 100", criteria: ["Incomplete", "Basic", "Clear experience evidence", "Strong targeted application", "Excellent and persuasive"] },
            ranking: { type: "ranking", instructions: "Re-rank the candidate IDs by how relevant each case is to THIS applicant's profile and target role (most relevant first).", criteria: Object.fromEntries(matches.map((item: any) => [item.contribution_question_id, `${item.company} ${item.role} (${item.result}): ${item.question}`]).slice(0, 20)) },
          })
          const rawScore = Number(jev?.answers?.progress?.score)
          score = Number.isFinite(rawScore) ? rawScore * 25 : NaN
          // TypeSafe ranking 응답 형태가 환경마다 다를 수 있어 방어적으로 id 배열을 추출한다.
          const rankingAnswer = jev?.answers?.ranking
          const rankedIds = Array.isArray(rankingAnswer) ? rankingAnswer : Array.isArray(rankingAnswer?.order) ? rankingAnswer.order : Array.isArray(rankingAnswer?.ids) ? rankingAnswer.ids : []
          jevRanking = rankedIds.map((value: any) => String(value)).filter(Boolean)
          modelVersion = `${Deno.env.get("OPENAI_CHAT_MODEL")}|${jev?.model ?? Deno.env.get("JEV_MODEL")}`
        } catch (jevError) {
          console.error("JEV(typesafe) failed, using heuristic score + similarity ranking:", jevError instanceof Error ? jevError.message : jevError)
          score = NaN
        }
      } else {
        score = NaN
      }
      if (!Number.isFinite(score)) {
        // 휴리스틱: 작성 분량 기반 대략 점수. 환경 미설정/비교 사례 0건에서도 게이지가 뜨도록.
        const essayChars = fullEssay.replace(/\s/g, "").length
        score = 40 + Math.min(45, Math.floor(essayChars / 25)) + (profile.experiences ? 7 : 0)
        modelVersion = `${Deno.env.get("OPENAI_CHAT_MODEL")}|heuristic`
      }
      // 어떤 경우에도 numeric(5,2) CHECK(0~100) 제약을 넘지 않도록 clamp.
      score = Math.min(100, Math.max(0, Math.round(score)))

      // JEV 재정렬 결과가 있으면 그 순서를 우선 적용하고, 빠진 후보는 유사도 순으로 뒤에 붙인다.
      let ranked = bySimilarity
      if (jevRanking.length) {
        const rank = new Map(jevRanking.map((id, index) => [id, index]))
        ranked = [...matches].sort((a: any, b: any) => {
          const ra = rank.has(String(a.contribution_question_id)) ? (rank.get(String(a.contribution_question_id)) as number) : Number.POSITIVE_INFINITY
          const rb = rank.has(String(b.contribution_question_id)) ? (rank.get(String(b.contribution_question_id)) as number) : Number.POSITIVE_INFINITY
          if (ra !== rb) return ra - rb
          return Number(b.similarity) - Number(a.similarity)
        })
      }
      const passed = ranked.filter((item: any) => item.result === "passed").slice(0, 5); const failed = ranked.filter((item: any) => item.result === "failed").slice(0, 5)

      // 3) 2단계 근거 기반 리포트.
      //    (a) 합격군/불합격군의 "공통 특징"을 먼저 추출한다. (사례 내용을 그대로
      //        베끼지 않고 패턴으로 요약)
      //    (b) 그 특징을 기준으로 "이 지원자 자소서"를 평가한다. 강점=합격군 특징 중
      //        지원자가 이미 갖춘 것, 약점=합격군 특징 중 빠진 것 또는 불합격군 특징
      //        중 지원자에게 나타나는 것, 제안=지원자 자소서를 합격군 쪽으로 끌어올릴
      //        구체적 수정. 모든 항목은 반드시 지원자 자소서 내용에 근거해야 한다.
      const chatModel = Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini"
      let report: any = {}
      try {
        const hasCohort = passed.length > 0 || failed.length > 0

        // (a) 코호트 특징 추출 (비교 사례가 있을 때만)
        let traits = { passTraits: [] as string[], failTraits: [] as string[] }
        if (hasCohort) {
          const traitCompletion: any = await openAI("/chat/completions", {
            model: chatModel,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "너는 채용 자소서 분석가다. 익명 합격/불합격 사례들에서 '공통 특징(패턴)'만 한국어로 추출한다. 특정 사례 문장을 그대로 베끼거나 기여자를 식별하지 말 것. JSON만 반환: {passTraits:string[], failTraits:string[]}. 각 배열은 3~6개의 간결한 패턴 설명." },
              { role: "user", content: `합격 사례들:\n${passed.map((x: any) => x.answer).join("\n---\n") || "(없음)"}\n\n불합격 사례들:\n${failed.map((x: any) => x.answer).join("\n---\n") || "(없음)"}` },
            ],
          })
          const parsedTraits = JSON.parse(traitCompletion.choices?.[0]?.message?.content ?? "{}")
          traits = { passTraits: parsedTraits.passTraits ?? [], failTraits: parsedTraits.failTraits ?? [] }
        }

        // (b) 지원자 자소서를 코호트 특징에 비춰 평가 (근거 강제)
        const cohortBlock = hasCohort
          ? `합격군 공통 특징:\n${traits.passTraits.map((t) => `- ${t}`).join("\n") || "- (없음)"}\n\n불합격군 공통 특징:\n${traits.failTraits.map((t) => `- ${t}`).join("\n") || "- (없음)"}`
          : "비교 가능한 익명 사례가 아직 없다. 사례 비교 없이 자소서 자체의 완성도만 평가하라."
        const reportCompletion: any = await openAI("/chat/completions", {
          model: chatModel,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: [
              "너는 한국 취업 자소서 코치다. 아래 '지원자 자소서'를 평가해 한국어 JSON만 반환한다: {summary:string, strengths:string[], weaknesses:string[], suggestions:string[]}.",
              "매우 중요한 규칙:",
              "- 모든 항목은 반드시 '지원자 자소서'의 실제 내용에 근거해야 한다. 사례나 일반론을 그대로 옮기지 말 것.",
              "- summary: 이 지원자 자소서에 대한 2~3문장의 총평. 전반적 인상과 가장 중요한 한 가지 개선 방향을 지원자 자소서 내용에 근거해 요약.",
              "- strengths: 합격군 특징 중 지원자가 '이미 갖춘' 것을, 지원자 자소서의 어느 부분이 그런지와 함께.",
              "- weaknesses: 합격군 특징 중 지원자에게 '빠진' 것, 또는 불합격군 특징 중 지원자에게 '나타나는' 것을.",
              "- suggestions: 지원자 자소서를 합격군 쪽으로 끌어올릴 구체적이고 실행 가능한 수정 제안. 어느 문장/문단을 어떻게 바꿀지.",
              "- 기여자나 특정 사례를 식별하지 말 것. 각 배열 2~5개.",
            ].join("\n") },
            { role: "user", content: `[비교 기준]\n${cohortBlock}\n\n[지원자 자소서]\n${fullEssay}` },
          ],
        })
        report = JSON.parse(reportCompletion.choices?.[0]?.message?.content ?? "{}")
      } catch (reportError) {
        console.error("report generation failed:", reportError instanceof Error ? reportError.message : reportError)
        // 핵심 산출물이 실패하면 크레딧을 환불하고 명확한 오류를 반환한다.
        await user.rpc("refund_credit_reservation", { p_reason: reason, p_request_id: requestId })
        return response({ error: `분석 리포트 생성에 실패했습니다: ${reportError instanceof Error ? reportError.message : "unknown"}` }, 502)
      }

      const { error: saveError } = await service.from("analysis_reports").insert({ project_id: projectId, user_id: currentUser.id, cache_key: cacheKey, model_version: modelVersion, score, summary: typeof report.summary === "string" ? report.summary : "", strengths: report.strengths ?? [], weaknesses: report.weaknesses ?? [], suggestions: report.suggestions ?? [], passed_matches: passed.length, failed_matches: failed.length })
      if (saveError) throw saveError
      return response({ ok: true, cached: false })
    } catch (error) { await user.rpc("refund_credit_reservation", { p_reason: reason, p_request_id: requestId }); throw error }
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Analysis failed" }, 500) }
})
