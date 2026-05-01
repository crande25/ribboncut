import { useState } from "react";

interface Props {
  onSignIn: (email: string, password: string) => Promise<{ error: Error | null }>;
}

export function AdminLogin({ onSignIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: err } = await onSignIn(email, password);
    if (err) setError(err.message);
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-sm pt-20">
      <h1 className="text-xl font-bold text-foreground mb-6">Admin</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Sign In"}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
