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

export function canManageFiscal(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canCancelSales(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canReturnSales(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "cashier";
}

export function canManageCustomers(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "cashier";
}

export function canViewStoreSettings(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "cashier";
}

export function canManageStoreSettings(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** Cashier/manager/admin may print commercial receipts for their store. */
export function canPrintReceipt(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "cashier";
}

/** Only manager/admin may change printer mode / paper width for a store. */
export function canManagePrinterSettings(role: MemberRole | null | undefined): boolean {
  return canManageStoreSettings(role);
}

export function canSeeCostPrice(role: MemberRole | null | undefined): boolean {
  return canViewReports(role);
}

/** Manager/admin may list operational audit events for authorized stores. */
export function canViewAuditLogs(role: MemberRole | null | undefined): boolean {
  return canViewReports(role);
}

export function rowsBelongToOrg<T extends { orgId: string }>(rows: T[], orgId: string): boolean {
  return rows.every((row) => row.orgId === orgId);
}