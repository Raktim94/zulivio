"use client";

import { useQuery } from "@tanstack/react-query";
import type { CurrentEmployee } from "@zulivio/types";
import { api } from "./api";

export function useCurrentEmployee() {
  return useQuery<CurrentEmployee>({
    queryKey: ["employees", "me"],
    queryFn: () => api.get<CurrentEmployee>("/api/v1/employees/me"),
    retry: false,
  });
}

const RANK: Record<CurrentEmployee["role"], number> = {
  EMPLOYEE: 0,
  MANAGER: 1,
  SALES_HEAD: 2,
  COMPANY_ADMIN: 3,
  MASTER_OWNER: 4,
};

export function isManagerOrAbove(role: CurrentEmployee["role"] | undefined): boolean {
  if (!role) return false;
  return RANK[role] >= RANK.MANAGER;
}

export function isMasterOwner(role: CurrentEmployee["role"] | undefined): boolean {
  return role === "MASTER_OWNER";
}
