import { useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type Theme } from "./themeContext";

// This file intentionally exports ONLY the ThemeProvider component so Vite
// Fast Refresh can hot-reload it. Consumers should import the `useTheme`
// hook and `Theme` type from `@/hooks/themeContext` directly.

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("app_theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("app_theme", t);
  };

  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (resolved: "dark" | "light") => {
      root.classList.remove("dark", "light");
      root.classList.add(resolved);
    };

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mq.matches ? "dark" : "light");
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
