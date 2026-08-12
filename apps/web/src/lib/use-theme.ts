"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "zulivio-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") setThemeState(saved);
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem(STORAGE_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
    }
  }, []);

  return { theme, setTheme };
}
