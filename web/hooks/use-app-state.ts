"use client"

import { useEffect, useState } from "react"
import { localServices } from "@/lib/local-services"
import type { AppState } from "@/lib/domain"

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null)

  useEffect(() => {
    localServices.init()
    const refresh = () => setState({ ...localServices.getState() })
    refresh()
    const unsubscribe = localServices.subscribe(refresh)
    return () => { unsubscribe() }
  }, [])

  return state
}
