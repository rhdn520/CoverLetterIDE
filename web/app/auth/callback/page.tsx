"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function AuthCallbackPage() {
  const router = useRouter()
  useEffect(() => {
    const complete = async () => {
      const code = new URLSearchParams(window.location.search).get("code")
      // OAuth providers (or an already-completed browser flow opened again) can
      // revisit this route without a PKCE code. Do not show a false login error
      // when Supabase already restored a valid session from its auth cookie.
      if (!code) {
        const { data: { session } } = await createSupabaseBrowserClient().auth.getSession()
        router.replace(session ? "/hub" : "/login?error=missing_callback_code")
        return
      }
      const { error } = await createSupabaseBrowserClient().auth.exchangeCodeForSession(code)
      router.replace(error ? "/login?error=oauth_callback_failed" : "/hub")
    }
    void complete()
  }, [router])
  return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-200">로그인 정보를 확인하고 있습니다…</main>
}
