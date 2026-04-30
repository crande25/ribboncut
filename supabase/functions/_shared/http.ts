// Shared HTTP helpers for edge functions.
//
// Provides standard CORS headers, OPTIONS preflight handling, JSON response
// shaping, and a service-role Supabase client bootstrap. Used by every edge
// function in this project unless the function has special requirements
// (e.g. backfill-vibes accepts an extra x-backfill-token header — for that
// case, build CORS headers via `buildCorsHeaders(extraAllowedHeaders)`).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
};

/** Build a CORS header set with additional allowed headers appended. */
export function buildCorsHeaders(extraAllowedHeaders: string[] = []) {
  const merged = [DEFAULT_ALLOWED_HEADERS, ...extraAllowedHeaders].join(", ");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": merged,
  };
}

/** Handle CORS preflight. Returns a Response if the request is OPTIONS, else null. */
export function handleOptions(req: Request, headers: Record<string, string> = corsHeaders): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  return null;
}

/** Build a JSON response with CORS headers applied. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = corsHeaders,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export class MissingEnvError extends Error {
  constructor(public readonly varName: string) {
    super(`Missing required environment variable: ${varName}`);
    this.name = "MissingEnvError";
  }
}

/** Build a Supabase service-role client. Throws MissingEnvError on missing config. */
export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new MissingEnvError("SUPABASE_URL");
  if (!key) throw new MissingEnvError("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

/** Convenience wrapper: returns either a 500 Response describing the missing env var, or the client. */
export function getServiceClientOr500(
  headers: Record<string, string> = corsHeaders,
): { client: SupabaseClient; error: null } | { client: null; error: Response } {
  try {
    return { client: getServiceClient(), error: null };
  } catch (e) {
    if (e instanceof MissingEnvError) {
      return { client: null, error: jsonResponse({ error: e.message }, 500, headers) };
    }
    throw e;
  }
}
