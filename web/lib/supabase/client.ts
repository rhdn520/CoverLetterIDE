import { createClient } from "@supabase/supabase-js"

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error("Supabase 환경 변수가 없습니다. .env.local을 확인하세요.")
  return { url, anonKey }
}

/** 브라우저 UI에서 Auth, PostgREST, Storage를 호출하는 클라이언트다. RLS가 모든
 * 사용자 소유 데이터의 접근 경계를 담당한다. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = publicConfig()
  return createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
}
