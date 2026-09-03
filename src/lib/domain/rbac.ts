import type { Enums } from "@/lib/db/types";

export type MemberRole = Enums<"member_role">;

export function canViewReports(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canManageInventory(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canEditProducts(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canSeeCostPrice(role: MemberRole | null | undefined): boolean {
  return canViewReports(role);
}

export function rowsBelongToOrg<T extends { orgId: string }>(rows: T[], orgId: string): boolean {
  return rows.every((row) => row.orgId === orgId);
}