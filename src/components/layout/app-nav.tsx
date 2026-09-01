import Link from "next/link";
import { canManageInventory, canViewReports, type MemberRole } from "@/lib/domain/rbac";

export function AppNav({ role }: { role?: MemberRole | null }) {
  const resolved = role ?? "cashier";
  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      <Link href="/pdv" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium">
        PDV
      </Link>
      <Link href="/inventory" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium">
        Inventário
      </Link>
      {canViewReports(resolved) ? (
        <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium">
          Dashboard
        </Link>
      ) : null}
      {canManageInventory(resolved) ? (
        <span className="self-center text-xs text-slate-500">gestão</span>
      ) : null}
    </nav>
  );
}