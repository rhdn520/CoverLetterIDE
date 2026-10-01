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
    const source = JSON.stringify({ profile: [profile.school, profile.major, profile.graduation, profile.experiences, profile.awards], project: [project.company, project.role], essays: (essays ?? []).map((item) => [item.question, item.answer]), model: [Deno.env.get("OPENAI_CHAT_MODEL"), Deno.env.get("OPENAI_EMBEDDING_MODEL"), Deno.env.get("JEV_MODEL")] })
    const cacheKey = await sha256(source)
    const { data: cached } = await service.from("analysis_reports").select("id").eq("user_id", currentUser.id).eq("cache_key", cacheKey).maybeSingle()
    if (cached) return response({ ok: true, cached: true })
    const { error: reserveError } = await user.rpc("reserve_credits", { p_amount: 100, p_reason: reason, p_request_id: requestId })
    if (reserveError) return response({ error: reserveError.message.includes("Insufficient") ? "크레딧이 부족합니다." : reserveError.message }, 402)
    try {
      const fullEssay = (essays ?? []).map((item) => `${item.question}\n${item.answer}`).join("\n\n")
      const embeddingResponse: any = await openAI("/embeddings", { model: Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small", input: `${profile.major}\n${profile.experiences}\n${project.company} ${project.role}\n${fullEssay}` })
      const embedding = embeddingResponse.data?.[0]?.embedding
      const { data: matches } = embedding ? await service.rpc("match_contribution_embeddings", { query_embedding: embedding, match_count: 20 }) : { data: [] }
      const jev: any = await typesafe({ profile: { major: profile.major, experiences: profile.experiences }, target: { company: project.company, role: project.role }, essay: fullEssay, candidates: matches ?? [] }, {
        progress: { type: "score", instructions: "Rate cover-letter readiness from 0 to 100", criteria: ["Incomplete", "Basic", "Clear experience evidence", "Strong targeted application", "Excellent and persuasive"] },
        relevance: { type: "choice", instructions: "Which candidate IDs are most relevant to the applicant profile and target role? Return the best candidate id.", criteria: Object.fromEntries((matches ?? []).map((item: any) => [item.contribution_question_id, `${item.company} ${item.role}: ${item.question}`]).slice(0, 20).concat([["none", "No suitable candidate"]])) },
      })
      const ranked = [...(matches ?? [])].sort((a: any, b: any) => Number(b.similarity) - Number(a.similarity))
      const passed = ranked.filter((item: any) => item.result === "passed").slice(0, 5); const failed = ranked.filter((item: any) => item.result === "failed").slice(0, 5)
      const reportCompletion: any = await openAI("/chat/completions", { model: Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini", response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return Korean JSON only: {strengths:string[],weaknesses:string[],suggestions:string[]}. Do not identify any contributor." }, { role: "user", content: `지원자 자소서:\n${fullEssay}\n\n익명 합격 사례:\n${passed.map((x: any) => x.answer).join("\n---\n")}\n\n익명 불합격 사례:\n${failed.map((x: any) => x.answer).join("\n---\n")}` }] })
      const report = JSON.parse(reportCompletion.choices?.[0]?.message?.content ?? "{}")
      // JEV progress 점수는 0~4 척도를 가정하고 25를 곱해 0~100으로 환산한다.
      // 응답이 비거나 숫자가 아니면 0으로 보고, 어떤 경우에도 0~100 범위를 벗어나
      // numeric(5,2) CHECK(0~100) 제약 위반(=500)이 나지 않도록 clamp 한다.
      const rawScore = Number(jev?.answers?.progress?.score)
      const score = Math.min(100, Math.max(0, Math.round((Number.isFinite(rawScore) ? rawScore : 0) * 25)))
      const { error: saveError } = await service.from("analysis_reports").insert({ project_id: projectId, user_id: currentUser.id, cache_key: cacheKey, model_version: `${Deno.env.get("OPENAI_CHAT_MODEL")}|${jev.model ?? Deno.env.get("JEV_MODEL")}`, score, strengths: report.strengths ?? [], weaknesses: report.weaknesses ?? [], suggestions: report.suggestions ?? [], passed_matches: passed.length, failed_matches: failed.length })
      if (saveError) throw saveError
      return response({ ok: true, cached: false })
    } catch (error) { await user.rpc("refund_credit_reservation", { p_reason: reason, p_request_id: requestId }); throw error }
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Analysis failed" }, 500) }
})
