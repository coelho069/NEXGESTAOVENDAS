import Link from "next/link";
import { canManageInventory, canViewReports, type MemberRole } from "@/lib/domain/rbac";

function storeHref(path: string, storeId?: string | null): string {
  return storeId ? `${path}?store=${encodeURIComponent(storeId)}` : path;
}

export function AppNav({ role, storeId }: { role?: MemberRole | null; storeId?: string | null }) {
  return (
    <nav className="flex flex-wrap gap-2 text-sm">
      <Link href={storeHref("/pdv", storeId)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium">
        PDV
      </Link>
      <Link
        href={storeHref("/inventory", storeId)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium"
      >
        Inventário
      </Link>
      {canViewReports(role) ? (
        <Link
          href={storeHref("/dashboard", storeId)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium"
        >
          Dashboard
        </Link>
      ) : null}
      {canManageInventory(role) ? (
        <span className="self-center text-xs text-slate-500">gestão</span>
      ) : null}
    </nav>
  );
}