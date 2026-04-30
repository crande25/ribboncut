import { createContext, useContext } from "react";

export type Theme = "dark" | "light" | "system";

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Context lives in its own module so the provider file can stay
// component-only (keeps Vite Fast Refresh happy).
export const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);
