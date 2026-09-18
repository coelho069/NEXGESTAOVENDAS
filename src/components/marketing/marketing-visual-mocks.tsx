type MockVariant = "hero" | "pdv" | "produtos" | "estoque" | "dashboard";

function MockShell({
  title,
  variant,
}: {
  title: string;
  variant: MockVariant;
}) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--background)] px-3 py-2">
        <span className="size-2 rounded-full bg-[var(--destructive)]/70" />
        <span className="size-2 rounded-full bg-[var(--warning)]/70" />
        <span className="size-2 rounded-full bg-[var(--success)]/70" />
        <span className="ml-2 text-xs font-medium text-[var(--muted-foreground)]">{title}</span>
      </div>
      <div className="p-4">
        {variant === "hero" ? <HeroMockBody /> : null}
        {variant === "pdv" ? <PdvMockBody /> : null}
        {variant === "produtos" ? <ProdutosMockBody /> : null}
        {variant === "estoque" ? <EstoqueMockBody /> : null}
        {variant === "dashboard" ? <DashboardMockBody /> : null}
      </div>
    </div>
  );
}

function HeroMockBody() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">PDV</p>
        <div className="mt-2 space-y-2">
          <div className="h-2 w-3/4 rounded bg-[var(--border)]" />
          <div className="h-8 rounded bg-[var(--background)]" />
          <div className="flex justify-between">
            <div className="h-6 w-16 rounded bg-[var(--primary)]/20" />
            <div className="h-6 w-20 rounded bg-[var(--success)]/25" />
          </div>
        </div>
      </div>
      <div className="rounded-[var(--radius)] border border-[var(--border)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Dashboard</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="h-10 rounded bg-[var(--background)]" />
          <div className="h-10 rounded bg-[var(--background)]" />
          <div className="col-span-2 h-16 rounded bg-[var(--primary)]/10" />
        </div>
      </div>
    </div>
  );
}

function PdvMockBody() {
  return (
    <div className="space-y-2">
      <div className="h-7 rounded bg-[var(--background)]" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-12 rounded border border-[var(--border)] bg-[var(--background)]" />
        ))}
      </div>
      <div className="flex items-center justify-between rounded bg-[var(--success)]/10 px-2 py-1.5">
        <span className="text-[10px] font-medium text-[var(--success)]">Total</span>
        <span className="text-xs font-semibold tabular-nums text-[var(--foreground)]">R$ 127,50</span>
      </div>
    </div>
  );
}

function ProdutosMockBody() {
  return (
    <div className="space-y-2">
      {["SKU-001", "SKU-002", "SKU-003"].map((sku) => (
        <div key={sku} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1.5">
          <span className="text-[10px] font-medium text-[var(--foreground)]">{sku}</span>
          <span className="text-[10px] tabular-nums text-[var(--muted-foreground)]">R$ 19,90</span>
        </div>
      ))}
    </div>
  );
}

function EstoqueMockBody() {
  return (
    <div className="space-y-2">
      {[
        { sku: "A-12", qty: "24 un." },
        { sku: "B-07", qty: "3 un." },
        { sku: "C-99", qty: "0 un." },
      ].map((row) => (
        <div key={row.sku} className="flex items-center justify-between text-[10px]">
          <span className="font-medium text-[var(--foreground)]">{row.sku}</span>
          <span
            className={`tabular-nums ${row.qty === "0 un." ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}
          >
            {row.qty}
          </span>
        </div>
      ))}
    </div>
  );
}

function DashboardMockBody() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded bg-[var(--background)] p-2">
          <p className="text-[9px] text-[var(--muted-foreground)]">Receita</p>
          <p className="text-xs font-semibold tabular-nums">R$ 4.820</p>
        </div>
        <div className="rounded bg-[var(--background)] p-2">
          <p className="text-[9px] text-[var(--muted-foreground)]">Margem</p>
          <p className="text-xs font-semibold tabular-nums">32%</p>
        </div>
      </div>
      <div className="h-14 rounded bg-[var(--primary)]/10" />
    </div>
  );
}

export function MarketingHeroVisual() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-[var(--radius-modal)] bg-[var(--primary)]/5 blur-2xl" />
      <MockShell title="Nex Gestão Vendas" variant="hero" />
    </div>
  );
}

export function MarketingDemoMock({ variant, title }: { variant: MockVariant; title: string }) {
  return <MockShell title={title} variant={variant} />;
}
