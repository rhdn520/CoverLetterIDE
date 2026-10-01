import { authenticatedUser, clients, openAI, options, response } from "../_shared/core.ts"

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  let requestId = ""
  let creditReason = "ai_chat"
  try {
    const body = await request.json()
    const { projectId, sessionId, prompt, contextIds = [] } = body
    requestId = body.requestId
    if (!projectId || !sessionId || !requestId || typeof prompt !== "string" || !prompt.trim()) return response({ error: "Invalid request" }, 400)
    const { currentUser, user } = await authenticatedUser(request)
    const { service } = clients(request)
    const { data: project } = await service.from("projects").select("*").eq("id", projectId).eq("user_id", currentUser.id).single()
    if (!project) return response({ error: "Project not found" }, 404)
    const [{ data: essays }, { data: files }, { data: session }] = await Promise.all([
      service.from("essays").select("*").eq("project_id", projectId).order("position"),
      service.from("evidence_files").select("id,original_name,extracted_text,extraction_status,file_state").eq("user_id", currentUser.id).eq("file_state", "ready"),
      service.from("chat_sessions").select("id").eq("id", sessionId).eq("project_id", projectId).eq("user_id", currentUser.id).single(),
    ])
    if (!session) return response({ error: "Chat session not found" }, 404)
    const selectedEssayIds = (contextIds as string[]).filter((value) => value.startsWith("essay:")).map((value) => value.slice(6))
    const selectedFileIds = (contextIds as string[]).filter((value) => value.startsWith("file:")).map((value) => value.slice(5))
    const relevantEssays = (essays ?? []).filter((essay) => !selectedEssayIds.length || selectedEssayIds.includes(essay.id))
    const relevantFiles = (files ?? []).filter((file) => selectedFileIds.includes(file.id) && file.extraction_status === "done" && file.extracted_text)
    const context = [
      ...relevantEssays.map((essay) => `[자소서 문항 ${essay.id}] ${essay.title}\n질문: ${essay.question}\n답변: ${essay.answer}`),
      ...relevantFiles.map((file) => `[첨부자료 ${file.original_name}]\n${file.extracted_text}`),
    ].join("\n\n").slice(0, 50000)
    const { error: reserveError } = await user.rpc("reserve_credits", { p_amount: 10, p_reason: creditReason, p_request_id: requestId })
    if (reserveError) return response({ error: reserveError.message.includes("Insufficient") ? "크레딧이 부족합니다." : reserveError.message }, 402)
    try {
      const completion: any = await openAI("/chat/completions", {
        model: Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a Korean cover-letter coach. Return JSON only: {content:string, reasoning:string[], suggestions:[{essayId:string,essayTitle:string,before:string,after:string,summary:string,status:'pending',changeStatuses:string[]}]}. Suggest edits only for provided essay IDs. Preserve factual claims." },
          { role: "user", content: `지원 회사: ${project.company}\n직무: ${project.role}\n사용자 요청: ${prompt}\n\n${context}` },
        ],
      })
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}")
      const userMessage = { session_id: sessionId, role: "user", content: prompt, reasoning: [], reference_items: contextIds, suggestions: [] }
      const assistantMessage = { session_id: sessionId, role: "assistant", content: String(parsed.content ?? "피드백을 생성하지 못했습니다."), reasoning: parsed.reasoning ?? [], reference_items: contextIds, suggestions: (parsed.suggestions ?? []).map((item: any) => ({ ...item, id: crypto.randomUUID(), status: "pending" })) }
      const { data: saved } = await service.from("chat_messages").insert([userMessage, assistantMessage]).select("id,suggestions")
      await service.from("chat_sessions").update({ title: prompt.slice(0, 28), updated_at: new Date().toISOString() }).eq("id", sessionId)
      const suggestion = saved?.[1]?.suggestions?.[0]
      return response({ ok: true, preview: suggestion ? { messageId: saved?.[1]?.id, suggestionId: suggestion.id, essayId: suggestion.essayId } : undefined })
    } catch (error) {
      await user.rpc("refund_credit_reservation", { p_reason: creditReason, p_request_id: requestId })
      throw error
    }
  } catch (error) { return response({ error: error instanceof Error ? error.message : "AI chat failed" }, 500) }
})
