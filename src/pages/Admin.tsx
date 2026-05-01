import { useState } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { ApiKeyHealth } from "@/components/admin/ApiKeyHealth";
import { DiscoveryRunner } from "@/components/admin/DiscoveryRunner";
import { RestaurantStats } from "@/components/admin/RestaurantStats";
import { ErrorLog } from "@/components/admin/ErrorLog";

const TABS = ["API Keys", "Discovery", "Stats", "Errors"] as const;
type Tab = (typeof TABS)[number];

export default function Admin() {
  const { user, isAdmin, loading, signIn, signUp, signOut } = useAdminAuth();
  const [tab, setTab] = useState<Tab>("Stats");

  if (loading) return <p className="pt-20 text-center text-muted-foreground">Loading…</p>;

  if (!user) return <AdminLogin onSignIn={signIn} onSignUp={signUp} />;

  if (!isAdmin) {
    return (
      <div className="pt-20 text-center">
        <p className="text-foreground">Access denied.</p>
        <button onClick={signOut} className="mt-4 text-xs text-muted-foreground underline">Sign out</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Admin Dashboard</h1>
        <button onClick={signOut} className="text-xs text-muted-foreground underline">Sign out</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "API Keys" && <ApiKeyHealth />}
      {tab === "Discovery" && <DiscoveryRunner />}
      {tab === "Stats" && <RestaurantStats />}
      {tab === "Errors" && <ErrorLog />}
    </div>
  );
}
