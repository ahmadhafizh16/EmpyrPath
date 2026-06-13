"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set) => ({
      theme: "dark",

      setTheme: () => {
        // Dark-only: ignore theme changes
        applyTheme("dark");
      },

      toggleTheme: () => {
        // Dark-only: no-op
        set({ theme: "dark" });
        applyTheme("dark");
      },

      initTheme: () => {
        applyTheme("dark");
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Apply theme to document
function applyTheme(theme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  const effectiveTheme = theme === "system" ? systemTheme : theme;

  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export default useThemeStore;

