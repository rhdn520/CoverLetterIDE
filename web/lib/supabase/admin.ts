import { createClient } from "@supabase/supabase-js"

/** Edge Function과 신뢰된 서버 코드에서만 사용한다. service_role key는 절대로
 * 브라우저로 전달하거나 NEXT_PUBLIC_ 접두사로 노출하지 않는다. */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error("Supabase 서버 환경 변수가 없습니다.")
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}
