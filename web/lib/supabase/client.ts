import { createClient, type SupabaseClient } from "@supabase/supabase-js"

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error("Supabase 환경 변수가 없습니다. .env.local을 확인하세요.")
  return { url, anonKey }
}

// 같은 브라우저 컨텍스트에서 동일 storage key로 GoTrueClient가 여러 번 생성되면
// "Multiple GoTrueClient instances" 경고와 함께 동시성 문제가 생길 수 있다.
// 브라우저에서는 단일 인스턴스를 재사용한다.
let browserClient: SupabaseClient | null = null

/** 브라우저 UI에서 Auth, PostgREST, Storage를 호출하는 클라이언트다. RLS가 모든
 * 사용자 소유 데이터의 접근 경계를 담당한다. */
export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient
  const { url, anonKey } = publicConfig()
  browserClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  return browserClient
}
