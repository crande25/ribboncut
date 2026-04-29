import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

type State = "loading" | "valid" | "already" | "invalid" | "submitting" | "success" | "error";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const data = await res.json();
        if (res.ok && data.valid) setState("valid");
        else if (data.reason === "already_unsubscribed") setState("already");
        else setState("invalid");
      } catch {
        setState("invalid");
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState("submitting");
    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ token }),
        }
      );
      const data = await res.json();
      if (res.ok && (data.success || data.reason === "already_unsubscribed")) {
        setState("success");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <div className="mx-auto mt-12 max-w-md rounded-xl border border-border bg-secondary/40 p-6 text-center">
      <h1 className="text-lg font-semibold text-foreground">Unsubscribe</h1>
      <div className="mt-4 text-sm text-muted-foreground">
        {state === "loading" && <p>Checking your link…</p>}
        {state === "invalid" && <p>This unsubscribe link is invalid or expired.</p>}
        {state === "already" && <p>You're already unsubscribed. No further action needed.</p>}
        {state === "valid" && (
          <>
            <p>Click below to stop receiving emails from this address.</p>
            <button
              onClick={confirm}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-xs font-medium text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
            >
              Confirm unsubscribe
            </button>
          </>
        )}
        {state === "submitting" && <p>Processing…</p>}
        {state === "success" && <p>You've been unsubscribed. Sorry to see you go.</p>}
        {state === "error" && (
          <>
            <p>Something went wrong. Please try again.</p>
            <button
              onClick={confirm}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-xs font-medium text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
