"use client"

import { useEffect, useState } from "react"
import { supabaseServices } from "@/lib/supabase/services"
import type { AppState } from "@/lib/domain"

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    const refresh = () => setState({ ...supabaseServices.getState() })
    void supabaseServices.init().then(refresh).catch(() => refresh())
    const unsubscribe = supabaseServices.subscribe(refresh)
    return () => { unsubscribe() }
  }, [])

  return state
}
