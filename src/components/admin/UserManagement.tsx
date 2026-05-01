import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Admin {
  user_id: string;
  email: string | null;
}

interface Props {
  currentUserId: string;
}

export function UserManagement({ currentUserId }: Props) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (!roles?.length) {
      setAdmins([]);
      setLoading(false);
      return;
    }

    const userIds = roles.map((r) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, email")
      .in("user_id", userIds);

    setAdmins(
      userIds.map((uid) => ({
        user_id: uid,
        email: profiles?.find((p) => p.user_id === uid)?.email ?? null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const grantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    // Look up user by email in profiles
    const { data: profile, error: lookupErr } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (lookupErr) {
      setMessage({ type: "err", text: lookupErr.message });
      setBusy(false);
      return;
    }
    if (!profile) {
      setMessage({ type: "err", text: "No account found with that email. They must sign up first." });
      setBusy(false);
      return;
    }

    const { error: insertErr } = await supabase
      .from("user_roles")
      .insert({ user_id: profile.user_id, role: "admin" as any });

    if (insertErr) {
      if (insertErr.code === "23505") {
        setMessage({ type: "err", text: "User is already an admin." });
      } else {
        setMessage({ type: "err", text: insertErr.message });
      }
    } else {
      setMessage({ type: "ok", text: `Admin role granted to ${email}.` });
      setEmail("");
      fetchAdmins();
    }
    setBusy(false);
  };

  const revokeAdmin = async (userId: string) => {
    if (!confirm("Revoke admin access for this user?")) return;
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", "admin" as any);

    if (error) {
      setMessage({ type: "err", text: error.message });
    } else {
      setMessage({ type: "ok", text: "Admin role revoked." });
      fetchAdmins();
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Admin Users</h2>

      {/* Current admins */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admins found.</p>
        ) : (
          admins.map((a) => (
            <div
              key={a.user_id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="text-sm text-foreground">
                {a.email ?? a.user_id}
                {a.user_id === currentUserId && (
                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                )}
              </span>
              {a.user_id !== currentUserId && (
                <button
                  onClick={() => revokeAdmin(a.user_id)}
                  className="text-xs text-destructive hover:underline"
                >
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Grant admin */}
      <form onSubmit={grantAdmin} className="flex gap-2">
        <input
          type="email"
          placeholder="Email to grant admin"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Grant"}
        </button>
      </form>

      {message && (
        <p className={`text-sm ${message.type === "ok" ? "text-green-600" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
