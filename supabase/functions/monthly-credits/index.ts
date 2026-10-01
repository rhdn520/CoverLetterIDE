import { clients, options, response } from "../_shared/core.ts"

Deno.serve(async (request) => {
  const preflight = options(request); if (preflight) return preflight
  try {
    const secret = request.headers.get("x-cron-secret")
    if (!secret || secret !== Deno.env.get("CRON_SECRET")) return response({ error: "Unauthorized" }, 401)
    const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
    const day = kst.find((part) => part.type === "day")?.value
    if (day !== "01") return response({ ok: true, skipped: true })
    const { service } = clients(request)
    const { data: profiles, error } = await service.from("profiles").select("id"); if (error) throw error
    await Promise.all((profiles ?? []).map((profile) => service.rpc("ensure_monthly_credits", { p_user_id: profile.id })))
    return response({ ok: true, users: profiles?.length ?? 0 })
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Monthly grant failed" }, 500) }
})
