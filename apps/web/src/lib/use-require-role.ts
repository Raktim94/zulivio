"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CurrentEmployee } from "@zulivio/types";
import { useCurrentEmployee } from "./use-current-employee";

/**
 * Guards a manager/owner-only page against direct URL access. Hiding the
 * nav link (done in the app shell) only stops casual navigation — someone
 * can still type the URL, so pages backed by manager-only data need their
 * own redirect, not just an absent sidebar entry.
 */
export function useRequireRole(check: (role: CurrentEmployee["role"] | undefined) => boolean) {
  const router = useRouter();
  const { data: employee, isLoading } = useCurrentEmployee();
  const authorized = check(employee?.role);

  useEffect(() => {
    if (!isLoading && !authorized) {
      router.replace("/");
    }
  }, [isLoading, authorized, router]);

  return { employee, isLoading, authorized };
}
