import type { MemberRole } from "@/lib/domain/rbac";

/** UX-only gate. Real access is enforced by RLS and SECURITY DEFINER RPCs. */

type PermissionGateProps = {
  allow: MemberRole[];
  role: MemberRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export function PermissionGate({ allow, role, children, fallback }: PermissionGateProps) {
  if (!allow.includes(role)) {
    return (
      fallback ?? (
        <div
          role="alert"
          data-testid="permission-denied"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          Sem permissão para este recurso.
        </div>
      )
    );
  }
  return <>{children}</>;
}