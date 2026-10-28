import Link from "next/link";
import { canManageInventory, canViewReports, isClientRole, type MemberRole } from "@/lib/domain/rbac";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

function storeHref(path: string, storeId?: string | null): string {
  return storeId ? `${path}?store=${encodeURIComponent(storeId)}` : path;
}

/**
 * Visual escuro (glass) alinhado ao login. Botões fantasma com borda `border`;
 * hover/foco aplica o gradiente do `.nx-login-submit`. Não há estado "ativo" por
 * rota: o AppNav é componente de servidor, sem pathname.
 */
const NAV_CSS = `
.nx-app-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-family: ${t.font.body};
}
.nx-app-nav-link {
  display: inline-flex;
  align-items: center;
  border-radius: ${t.radius.md};
  border: 1px solid ${t.color.borderStrong};
  background: ${t.color.glassBg};
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  color: ${t.color.textBody};
  padding: 6px 12px;
  font-weight: 500;
  text-decoration: none;
  transition: color ${t.motion.fast} ease, border-color ${t.motion.fast} ease, box-shadow ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.nx-app-nav-link:hover,
.nx-app-nav-link:focus-visible {
  color: #FFFFFF;
  border-color: rgba(37, 99, 235, 0.55);
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  outline: none;
}
.nx-app-nav-hint {
  align-self: center;
  font-size: 12px;
  font-weight: 500;
  color: ${t.color.textMuted};
}
@media (prefers-reduced-motion: reduce) {
  .nx-app-nav-link { transition: none; }
}
`;

export function AppNav({
  role,
  storeId,
  isPlatformAdmin = false,
}: {
  role?: MemberRole | null;
  storeId?: string | null;
  /** Platform SaaS ADM — separate from tenant store_members.role */
  isPlatformAdmin?: boolean;
}) {
  const clientOnly = isClientRole(role);

  return (
    <nav className="nx-app-nav">
      <style>{NAV_CSS}</style>
      <Link href={storeHref("/pdv", storeId)} className="nx-app-nav-link">
        PDV
      </Link>
      <Link href={storeHref("/inventory", storeId)} className="nx-app-nav-link">
        {clientOnly ? "Produtos" : "Inventário"}
      </Link>
      <Link href={storeHref("/clientes", storeId)} className="nx-app-nav-link">
        Clientes
      </Link>
      <Link href={storeHref("/configuracoes", storeId)} className="nx-app-nav-link">
        Configurações
      </Link>
      {canViewReports(role) || isClientRole(role) ? (
        <Link href={storeHref("/dashboard", storeId)} className="nx-app-nav-link">
          Dashboard
        </Link>
      ) : null}
      {canManageInventory(role) ? (
        <span className="nx-app-nav-hint">gestão</span>
      ) : null}
      {isPlatformAdmin ? (
        <Link href="/admin/assinaturas" className="nx-app-nav-link">
          Assinaturas
        </Link>
      ) : null}
      <Link href={storeHref("/suporte/tickets", storeId)} className="nx-app-nav-link">
        Suporte
      </Link>
    </nav>
  );
}