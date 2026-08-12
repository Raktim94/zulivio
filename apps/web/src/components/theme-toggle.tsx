"use client";

import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/use-theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-canvas p-0.5"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.value)}
            className={
              active
                ? "flex h-7 w-7 items-center justify-center rounded-md bg-surface text-ink shadow-sm"
                : "flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:text-ink"
            }
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
