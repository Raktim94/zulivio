"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";

export function TopBar({
  title,
  employee,
}: {
  title: string;
  employee: { fullName: string; email: string; role: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    await api.post("/api/v1/auth/sessions/logout");
    router.push("/login");
    router.refresh();
  }

  const initials = employee.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-border bg-surface/90 px-6 backdrop-blur">
      <h1 className="text-base font-semibold text-ink">{title}</h1>

      <div className="flex items-center gap-3">
        <ThemeToggle />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-lg border border-border py-1.5 pl-1.5 pr-2.5 transition hover:bg-canvas"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald text-xs font-semibold text-white">
              {initials}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-medium leading-tight text-ink">{employee.fullName}</span>
              <span className="block text-[11px] leading-tight text-muted">{employee.role.replace("_", " ")}</span>
            </span>
            <ChevronDown size={14} className="text-muted" />
          </button>

          {open && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
            >
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium text-ink">{employee.fullName}</p>
                <p className="mt-0.5 truncate text-xs text-muted">{employee.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={logout}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-coral transition hover:bg-coral/5"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
