import { authenticatedUser, clients, options, response } from "../_shared/core.ts"

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  try {
    const { currentUser } = await authenticatedUser(request); const { service } = clients(request)
    if (request.method === "GET") {
      const [profile, projects, files, essays, contributions, transactions] = await Promise.all([
        service.from("profiles").select("*").eq("id", currentUser.id).single(),
        service.from("projects").select("*").eq("user_id", currentUser.id),
        service.from("evidence_files").select("*").eq("user_id", currentUser.id),
        service.from("essays").select("*,projects!inner(user_id)").eq("projects.user_id", currentUser.id),
        service.from("contributions").select("*,contribution_questions(*)").eq("user_id", currentUser.id),
        service.from("credit_transactions").select("*").eq("user_id", currentUser.id),
      ])
      return response({ exportedAt: new Date().toISOString(), profile: profile.data, projects: projects.data, files: files.data, essays: essays.data, contributions: contributions.data, transactions: transactions.data })
    }
    if (request.method === "DELETE") {
      const { data: files } = await service.from("evidence_files").select("storage_path").eq("user_id", currentUser.id)
      if (files?.length) await service.storage.from("evidence-files").remove(files.map((file) => file.storage_path))
      // Cascading foreign keys remove projects, files, embeddings, grants, chats and contributions.
      const { error } = await service.auth.admin.deleteUser(currentUser.id); if (error) throw error
      return response({ ok: true })
    }
    return response({ error: "Method not allowed" }, 405)
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Account operation failed" }, 500) }
})
