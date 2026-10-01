import { authenticatedUser, clients, openAI, options, response } from "../_shared/core.ts"
import { applyLineEdits, coerceLineEdits, numberLines, type LineEdit } from "../_shared/line-edits.ts"

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  let requestId = ""
  const creditReason = "ai_chat"
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
    // 자소서 문항은 라인 번호를 매겨 전달한다. 모델은 원문을 재현하지 않고 "L번호"로만
    // 편집 위치를 지목하므로 target 불일치 문제가 사라진다. 첨부자료는 참고용이라
    // 번호를 매기지 않는다.
    const essayContext = relevantEssays.map((essay) => `[자소서 문항 essayId=${essay.id}] ${essay.title}\n질문: ${essay.question}\n답변(라인 번호 포함):\n${numberLines(essay.answer ?? "")}`)
    const fileContext = relevantFiles.map((file) => `[첨부자료 ${file.original_name}]\n${file.extracted_text}`)
    const context = [...essayContext, ...fileContext].join("\n\n").slice(0, 50000)
    const { error: reserveError } = await user.rpc("reserve_credits", { p_amount: 10, p_reason: creditReason, p_request_id: requestId })
    if (reserveError) return response({ error: reserveError.message.includes("Insufficient") ? "크레딧이 부족합니다." : reserveError.message }, 402)
    try {
      const completion: any = await openAI("/chat/completions", {
        model: Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a Korean cover-letter (자기소개서) coach.",
              "Each essay answer is shown with 1-based line numbers like `L1: ...`.",
              "Return JSON ONLY in this exact shape:",
              '{"content": string, "reasoning": string[], "edits": [{"essayId": string, "op": "replace"|"insert_after"|"delete", "line": number, "text"?: string, "expected"?: string}]}',
              "Rules:",
              "- `content`: a short Korean explanation of what you changed and why.",
              "- `reasoning`: 2~4 short Korean steps (요청 해석 / 보완점 / 수정안).",
              "- Each edit targets ONE line by its number from the shown `L<n>` prefix (do NOT include the `L<n>:` prefix in `text`).",
              "- `replace`: replace that line's content with `text`. `insert_after`: add a new line of `text` after that line. `delete`: remove that line.",
              "- `expected`: copy the first ~12 characters of the targeted line so the server can verify the position.",
              "- Only edit essays by their given `essayId`. Preserve factual claims. Keep edits minimal and specific.",
              "- If no change is needed, return an empty `edits` array.",
            ].join("\n"),
          },
          { role: "user", content: `지원 회사: ${project.company}\n직무: ${project.role}\n사용자 요청: ${prompt}\n\n${context}` },
        ],
      })
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}")

      // 모델이 돌려준 라인 편집을 문항별로 모아 실제 본문에 적용해 before/after를
      // 서버에서 결정론적으로 만든다. (모델의 원문 재현에 의존하지 않음)
      const essayById = new Map((essays ?? []).map((essay) => [essay.id, essay]))
      const fallbackEssayId = (relevantEssays[0] ?? (essays ?? [])[0])?.id
      const editsByEssay = new Map<string, LineEdit[]>()
      for (const raw of (Array.isArray(parsed.edits) ? parsed.edits : [])) {
        const essayId = essayById.has(raw?.essayId) ? raw.essayId : fallbackEssayId
        if (!essayId) continue
        const [normalized] = coerceLineEdits([raw])
        if (!normalized) continue
        const bucket = editsByEssay.get(essayId) ?? []
        bucket.push(normalized)
        editsByEssay.set(essayId, bucket)
      }

      const suggestions = [...editsByEssay.entries()].map(([essayId, edits]) => {
        const essay = essayById.get(essayId)
        if (!essay) return null
        const before = essay.answer ?? ""
        const { after, changed } = applyLineEdits(before, edits)
        if (!changed) return null
        return { id: crypto.randomUUID(), essayId, essayTitle: essay.title, before, after, summary: "", status: "pending", changeStatuses: [] }
      }).filter((item): item is NonNullable<typeof item> => Boolean(item))

      const userMessage = { session_id: sessionId, role: "user", content: prompt, reasoning: [], reference_items: contextIds, suggestions: [] }
      const assistantMessage = { session_id: sessionId, role: "assistant", content: String(parsed.content ?? "피드백을 생성하지 못했습니다."), reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [], reference_items: contextIds, suggestions }
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
