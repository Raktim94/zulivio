"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";

interface VersionInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string;
}

function useVersion() {
  return useQuery<VersionInfo>({
    queryKey: ["system", "version"],
    queryFn: () => api.get<VersionInfo>("/api/v1/system/version"),
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Shows nothing unless a newer release is actually available — this is
 * the sidebar's "update available" indicator. See
 * apps/backend/src/system/version.controller.ts for how currentVersion is
 * determined and why a "dev" build never shows one.
 */
export function UpdateBadge({ collapsed, onDark = false }: { collapsed?: boolean; onDark?: boolean }) {
  const { data } = useVersion();
  if (!data?.updateAvailable) return null;

  if (collapsed) {
    return (
      <a
        href={data.releaseUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        title={`Update available: ${data.latestVersion}`}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-dark/20 text-emerald-dark transition hover:bg-emerald-dark/30"
      >
        <Sparkles size={14} aria-hidden />
        <span className="sr-only">Update available: {data.latestVersion}</span>
      </a>
    );
  }

  return (
    <a
      href={data.releaseUrl ?? undefined}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
        onDark ? "bg-emerald-dark/20 text-emerald-dark hover:bg-emerald-dark/30" : "bg-emerald/10 text-emerald-dark hover:bg-emerald/20",
      )}
    >
      <Sparkles size={13} aria-hidden />
      Update available: {data.latestVersion}
    </a>
  );
}
