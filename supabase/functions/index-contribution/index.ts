import { authenticatedUser, clients, openAI, options, redact, response, sha256 } from "../_shared/core.ts"

function meaningful(value: string) {
  const compact = value.replace(/\s/g, "")
  return compact.length >= 100 && !/(.)\1{14,}/.test(compact)
}

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  try {
    const body = await request.json()
    if (request.headers.get("x-internal-task") === "index") {
      if (request.headers.get("Authorization") !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) return response({ error: "Unauthorized" }, 401)
      const { contributionId } = body; const { service } = clients(request)
      const { data: contribution, error } = await service.from("contributions").select("id,quality_status,anonymized_at").eq("id", contributionId).single()
      if (error || contribution.quality_status !== "accepted" || !contribution.anonymized_at) return response({ error: "Contribution is not indexable" }, 400)
      const { data: rows } = await service.from("contribution_questions").select("id,question,anonymized_answer").eq("contribution_id", contributionId)
      for (const row of rows ?? []) {
        const embeddingResponse: any = await openAI("/embeddings", { model: Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small", input: `${row.question}\n${row.anonymized_answer}` })
        const embedding = embeddingResponse.data?.[0]?.embedding
        if (embedding) await service.from("contribution_embeddings").upsert({ contribution_question_id: row.id, embedding, embedding_model: Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small" }, { onConflict: "contribution_question_id" })
      }
      return response({ ok: true, indexed: rows?.length ?? 0 })
    }
    const { company, role, applicationPeriod, result, questions, consentVersion } = body
    if (!company?.trim() || !role?.trim() || !applicationPeriod || !["passed", "failed"].includes(result) || !consentVersion || !Array.isArray(questions) || !questions.length) return response({ error: "필수 입력값 또는 동의가 누락되었습니다." }, 400)
    if (questions.some((item: any) => !item.question?.trim() || !meaningful(item.answer ?? ""))) return response({ error: "각 답변은 100자 이상이며 반복 문자만으로 구성될 수 없습니다." }, 400)
    const { currentUser } = await authenticatedUser(request); const { service } = clients(request)
    const contentHash = await sha256(JSON.stringify({ company: company.trim(), role: role.trim(), result, questions: questions.map((item: any) => [item.question.trim(), item.answer.trim()]) }))
    const { data: existing } = await service.from("contributions").select("id").eq("content_hash", contentHash).maybeSingle()
    if (existing) return response({ error: "동일한 기여 데이터가 이미 제출되었습니다." }, 409)
    const { data: contribution, error } = await service.from("contributions").insert({ user_id: currentUser.id, company: company.trim(), role: role.trim(), application_period: applicationPeriod, result, consented_at: new Date().toISOString(), consent_version: consentVersion, quality_status: "accepted", anonymized_at: new Date().toISOString(), content_hash: contentHash }).select().single()
    if (error) throw error
    const questionRows = questions.map((item: any, position: number) => ({ contribution_id: contribution.id, position, question: item.question.trim(), answer: item.answer.trim(), anonymized_answer: redact(item.answer.trim()) }))
    const { error: questionError } = await service.from("contribution_questions").insert(questionRows); if (questionError) throw questionError
    const { error: rewardError } = await service.rpc("reward_accepted_contribution", { p_contribution_id: contribution.id }); if (rewardError) throw rewardError
    const { error: invokeError } = await service.functions.invoke("index-contribution", { body: { contributionId: contribution.id }, headers: { "x-internal-task": "index" } })
    if (invokeError) console.error("Embedding job enqueue failed", invokeError)
    return response({ ok: true, contributionId: contribution.id })
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Contribution failed" }, 500) }
})
