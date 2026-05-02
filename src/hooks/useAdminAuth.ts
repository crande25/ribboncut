import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAdminAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkRole = async (u: User | null) => {
      if (!u) {
        if (mounted) { setUser(null); setIsAdmin(false); setLoading(false); }
        return;
      }
      if (mounted) setUser(u);
      try {
        const { data } = await supabase.rpc("has_role", {
          _user_id: u.id,
          _role: "admin",
        });
        if (mounted) setIsAdmin(!!data);
      } catch {
        if (mounted) setIsAdmin(false);
      }
      if (mounted) setLoading(false);
    };

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      checkRole(session?.user ?? null);
    });

    // Listen for future changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        checkRole(session?.user ?? null);
      }
    );

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = () => supabase.auth.signOut();

  return { user, isAdmin, loading, signIn, signOut };
}
