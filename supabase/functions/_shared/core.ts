import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

export function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })
}

export function options(request: Request) { return request.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null }

export function clients(request: Request) {
  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const authorization = request.headers.get("Authorization") ?? ""
  return {
    user: createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }),
    service: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}

export async function authenticatedUser(request: Request) {
  const { user } = clients(request)
  const { data, error } = await user.auth.getUser()
  if (error || !data.user) throw new Error("Authentication is required")
  return { currentUser: data.user, user }
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function openAI(path: string, body: unknown) {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured")
  const result = await fetch(`https://api.openai.com/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!result.ok) throw new Error(`OpenAI request failed: ${result.status}`)
  return result.json()
}

export async function typesafe(state: unknown, questions: unknown) {
  const apiKey = Deno.env.get("TYPESAFE_API_KEY")
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured")
  const base = Deno.env.get("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai"
  const result = await fetch(`${base.replace(/\/$/, "")}/v1/systemone`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: Deno.env.get("JEV_MODEL") ?? "jev-1.13", questions }),
  })
  if (!result.ok) throw new Error(`TypeSafe request failed: ${result.status}`)
  return result.json()
}

export function redact(text: string) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
    .replace(/(?:01[0-9]-?\d{3,4}-?\d{4})/g, "[전화번호]")
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, "[주민번호]")
    .replace(/\b\d{2,3}-\d{3,4}-\d{4}\b/g, "[전화번호]")
}
