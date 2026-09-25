"use client";

import { useState } from "react";
import type { AdvisorAnalyzeResponse, AdvisorState } from "@/lib/advisor/types";
import type { AdvisorViewModel } from "@/lib/advisor/view-model";

// ---------------------------------------------------------------------------
// Interface do PDV Advisor — apresenta a análise do JEV.
//
// Seções exibidas:
//   📋 Perfil, 🔎 Requisitos, 📊 Comparação, 💰 Custos, ⚠️ Limitações,
//   📚 Evidências, ❓ Informações não verificadas, ➡️ Próximos passos.
//
// Seções PROIBIDAS (garantidas por teste): 🏆 Melhor opção, 🥇 Vencedor,
// ⭐ Recomendado, "Veredito", "Plano A", "Plano B".
// ---------------------------------------------------------------------------

const DEFAULT_STATE: AdvisorState = {
  sector: "varejo",
  businessSize: "pequeno porte",
  monthlyRevenue: 30000,
  cashRegisters: 1,
  fiscalRequirement: "NF-e completa",
  budget: 0,
  requiredFeatures: ["PDV", "estoque", "financeiro", "NF-e"],
};

const STATUS_STYLES: Record<string, string> = {
  atende: "bg-emerald-100 text-emerald-800",
  "não atende": "bg-red-100 text-red-800",
  parcialmente: "bg-amber-100 text-amber-800",
  "não verificado": "bg-slate-100 text-slate-600",
};

export function AdvisorAnalysisPanel() {
  const [state, setState] = useState<AdvisorState>(DEFAULT_STATE);
  const [viewModel, setViewModel] = useState<AdvisorViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    setError(null);
    setViewModel(null);
    try {
      const response = await fetch("/api/advisor/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const data = (await response.json()) as AdvisorAnalyzeResponse & {
        viewModel?: AdvisorViewModel;
      };
      if (!data.ok) {
        setError(data.error);
        return;
      }
      setViewModel(data.viewModel ?? null);
    } catch {
      setError("advisor_request_failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="PDV Advisor" className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-lg font-bold">PDV Advisor</h2>
        <p className="text-sm text-slate-600">
          A análise é gerada pelo motor JEV. Os dados são apresentados para que
          você tome a decisão — sem veredito automático.
        </p>
      </header>

      <fieldset className="grid grid-cols-2 gap-3 rounded border p-4">
        <legend className="px-1 text-sm font-semibold">Perfil do negócio</legend>
        <label className="text-sm">
          Setor
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={state.sector}
            onChange={(event) => setState({ ...state, sector: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Porte
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={state.businessSize}
            onChange={(event) => setState({ ...state, businessSize: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Faturamento mensal (R$)
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            type="number"
            min={0}
            value={state.monthlyRevenue}
            onChange={(event) =>
              setState({ ...state, monthlyRevenue: Number(event.target.value) || 0 })
            }
          />
        </label>
        <label className="text-sm">
          Quantidade de caixas
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            type="number"
            min={0}
            value={state.cashRegisters}
            onChange={(event) =>
              setState({ ...state, cashRegisters: Number(event.target.value) || 0 })
            }
          />
        </label>
        <label className="text-sm">
          Necessidade fiscal
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={state.fiscalRequirement}
            onChange={(event) => setState({ ...state, fiscalRequirement: event.target.value })}
          />
        </label>
        <label className="text-sm">
          Orçamento (R$)
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            type="number"
            min={0}
            value={state.budget}
            onChange={(event) => setState({ ...state, budget: Number(event.target.value) || 0 })}
          />
        </label>
        <label className="col-span-2 text-sm">
          Recursos necessários (separados por vírgula)
          <input
            className="mt-1 w-full rounded border px-2 py-1"
            value={state.requiredFeatures.join(", ")}
            onChange={(event) =>
              setState({
                ...state,
                requiredFeatures: event.target.value
                  .split(",")
                  .map((feature) => feature.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
        <button
          type="button"
          className="col-span-2 rounded bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
          onClick={analyze}
          disabled={loading}
        >
          {loading ? "Analisando…" : "Analisar com JEV"}
        </button>
      </fieldset>

      {error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          Falha na análise: {error}
        </p>
      ) : null}

      {viewModel ? <AdvisorReportView viewModel={viewModel} /> : null}
    </section>
  );
}

export function AdvisorReportView({ viewModel }: { viewModel: AdvisorViewModel }) {
  return (
    <div className="space-y-6">
      <section aria-label="Perfil" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">📋 Perfil</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt>Setor:</dt>
          <dd>{viewModel.profile.sector}</dd>
          <dt>Porte:</dt>
          <dd>{viewModel.profile.businessSize}</dd>
          <dt>Faturamento mensal:</dt>
          <dd>{viewModel.profile.monthlyRevenue}</dd>
          <dt>Caixas:</dt>
          <dd>{viewModel.profile.cashRegisters}</dd>
          <dt>Necessidade fiscal:</dt>
          <dd>{viewModel.profile.fiscalRequirement}</dd>
          <dt>Orçamento:</dt>
          <dd>{viewModel.profile.budget}</dd>
        </dl>
      </section>

      <section aria-label="Requisitos" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">🔎 Requisitos</h3>
        <ul className="list-inside list-disc text-sm">
          {viewModel.requirements.map((requirement) => (
            <li key={`${requirement.kind}-${requirement.requirement}`}>
              {requirement.requirement} — {requirement.kind}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Comparação" className="space-y-4">
        <h3 className="font-semibold">📊 Comparação</h3>
        {viewModel.comparisons.map((comparison) => (
          <article key={comparison.candidate} className="rounded border p-4">
            <h4 className="mb-2 font-bold">{comparison.candidate}</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="py-1">Requisito</th>
                  <th className="py-1">Status</th>
                  <th className="py-1">Evidência</th>
                </tr>
              </thead>
              <tbody>
                {comparison.requirements.map((requirement) => (
                  <tr key={`${comparison.candidate}-${requirement.requirement}`}>
                    <td className="py-1 pr-2">{requirement.requirement}</td>
                    <td className="py-1 pr-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs ${
                          STATUS_STYLES[requirement.status] ?? "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {requirement.status}
                      </span>
                    </td>
                    <td className="py-1 text-slate-600">{requirement.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      <section aria-label="Custos" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">💰 Custos</h3>
        <ul className="text-sm">
          {viewModel.comparisons.map((comparison) => (
            <li key={`cost-${comparison.candidate}`}>
              <strong>{comparison.candidate}</strong> — custo informado: {comparison.cost}
              {comparison.additionalCosts.length > 0 ? (
                <ul className="ml-4 list-disc">
                  {comparison.additionalCosts.map((cost) => (
                    <li key={`${comparison.candidate}-${cost}`}>{cost}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {viewModel.additionalCosts.length > 0 ? (
          <>
            <h4 className="mt-3 text-sm font-semibold">Custos adicionais gerais</h4>
            <ul className="ml-4 list-disc text-sm">
              {viewModel.additionalCosts.map((cost) => (
                <li key={cost}>{cost}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-label="Limitações" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">⚠️ Limitações</h3>
        <ul className="ml-4 list-disc text-sm">
          {viewModel.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        {viewModel.warnings.length > 0 ? (
          <ul className="ml-4 mt-2 list-disc text-sm text-amber-700">
            {viewModel.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Evidências" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">📚 Evidências</h3>
        <ul className="space-y-2 text-sm">
          {viewModel.evidence.map((item) => (
            <li key={`evidence-${item.candidate}`}>
              <strong>{item.candidate}</strong>
              <ul className="ml-4 list-disc">
                {item.sources.map((source) => (
                  <li key={`${item.candidate}-${source.label}`}>
                    {source.url ? (
                      <a
                        className="text-blue-700 underline"
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {source.label}
                      </a>
                    ) : (
                      source.label
                    )}
                    {source.retrievedAt ? ` — consultado em ${source.retrievedAt}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      {viewModel.divergences.length > 0 ? (
        <section aria-label="Divergências entre fontes" className="rounded border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 font-semibold">Divergências entre fontes</h3>
          <ul className="space-y-3 text-sm">
            {viewModel.divergences.map((divergence) => (
              <li key={divergence.topic}>
                <strong>{divergence.topic}</strong>
                <div>Fonte A: {divergence.sourceA}</div>
                <div>Fonte B: {divergence.sourceB}</div>
                <div>Data: {divergence.date || "não informada"}</div>
                <div>Status: {divergence.status}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Informações não verificadas" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">❓ Informações não verificadas</h3>
        {viewModel.unverifiedInformation.length > 0 ? (
          <ul className="ml-4 list-disc text-sm">
            {viewModel.unverifiedInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Nenhuma informada pelo JEV.</p>
        )}
      </section>

      <section aria-label="Próximos passos" className="rounded border p-4">
        <h3 className="mb-2 font-semibold">➡️ Próximos passos</h3>
        <ol className="ml-4 list-decimal text-sm">
          {viewModel.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
