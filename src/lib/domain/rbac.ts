import type { Enums } from "@/lib/db/types";

export type MemberRole = Enums<"member_role">;

export function isClientRole(role: MemberRole | null | undefined): boolean {
  return role === "client";
}

/** Store operation outside the PDV (inventário). Client accounts stay out of it. */
export function isOperationalRole(
  role: MemberRole | null | undefined
): role is "admin" | "manager" | "cashier" {
  return role === "admin" || role === "manager" || role === "cashier";
}

/** Frente de caixa: vender e operar o caixa. O papel cliente entra aqui. */
export function canUsePdv(
  role: MemberRole | null | undefined
): role is "admin" | "manager" | "cashier" | "client" {
  return isOperationalRole(role) || role === "client";
}

export function canViewReports(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canManageInventory(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

/** Cadastro do catálogo da loja. O papel cliente cadastra produto; estoque continua fora. */
export function canEditProducts(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "client";
}

export function canManageFiscal(role: MemberRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export function canSeeCostPrice(role: MemberRole | null | undefined): boolean {
  return canViewReports(role);
}

export function rowsBelongToOrg<T extends { orgId: string }>(rows: T[], orgId: string): boolean {
  return rows.every((row) => row.orgId === orgId);
}