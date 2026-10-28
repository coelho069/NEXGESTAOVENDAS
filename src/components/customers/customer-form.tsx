import type { CustomerDraft } from "@/lib/domain/customer";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

const CUSTOMER_FORM_CSS = `
.nx-cf-input {
  width: 100%;
  margin-top: 4px;
  border-radius: ${t.radius.md};
  border: 1px solid ${t.color.borderStrong};
  background: rgba(15, 23, 42, 0.55);
  color: ${t.color.text};
  padding: 10px 12px;
  font-size: 15px;
  font-family: ${t.font.body};
  outline: none;
  transition: border-color ${t.motion.fast} ease, box-shadow ${t.motion.fast} ease, background ${t.motion.fast} ease;
}
.nx-cf-input::placeholder { color: ${t.color.textMuted}; opacity: 0.85; }
.nx-cf-input:focus-visible {
  border-color: rgba(37, 99, 235, 0.55);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
  background: rgba(15, 23, 42, 0.72);
}
.nx-cf-save {
  border: none;
  border-radius: ${t.radius.md};
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  font-family: ${t.font.body};
  color: #FFFFFF;
  cursor: pointer;
  background: linear-gradient(135deg, ${t.color.secondary} 0%, #1D4ED8 55%, ${t.color.accent} 100%);
  box-shadow: ${t.shadow.ctaGlow};
  transition: box-shadow ${t.motion.fast} ease, opacity ${t.motion.fast} ease;
}
.nx-cf-save:disabled { cursor: not-allowed; opacity: 0.55; box-shadow: none; }
.nx-cf-ghost {
  border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radius.md};
  background: rgba(255, 255, 255, 0.04);
  color: ${t.color.text};
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  font-family: ${t.font.body};
  cursor: pointer;
  transition: background ${t.motion.fast} ease;
}
.nx-cf-ghost:hover, .nx-cf-ghost:focus-visible { background: rgba(255, 255, 255, 0.08); outline: none; }
.nx-cf-error { color: #FCA5A5; }
@media (prefers-reduced-motion: reduce) {
  .nx-cf-input, .nx-cf-save, .nx-cf-ghost { transition: none; }
}
`;

type CustomerFormProps = {
  draft: CustomerDraft;
  submitting?: boolean;
  error?: string | null;
  submitLabel?: string;
  onChange: (draft: CustomerDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
};

export function CustomerForm({
  draft,
  submitting = false,
  error,
  submitLabel = "Salvar",
  onChange,
  onSubmit,
  onCancel,
}: CustomerFormProps) {
  return (
    <form
      data-testid="customer-form"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <style>{CUSTOMER_FORM_CSS}</style>
      <label className="block text-sm">
        Nome
        <input
          data-testid="customer-name"
          required
          className="nx-cf-input"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Documento
        <input
          data-testid="customer-document"
          className="nx-cf-input"
          value={draft.document}
          onChange={(event) => onChange({ ...draft, document: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        E-mail
        <input
          data-testid="customer-email"
          type="email"
          className="nx-cf-input"
          value={draft.email}
          onChange={(event) => onChange({ ...draft, email: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Limite de desconto (até R$)
        <input
          data-testid="customer-discount-limit"
          className="nx-cf-input"
          inputMode="decimal"
          placeholder="Ex.: 30,00"
          value={draft.discountLimit}
          onChange={(event) => onChange({ ...draft, discountLimit: event.target.value })}
        />
      </label>
      <p className="text-xs" style={{ color: "rgba(148,163,184,0.95)" }}>
        Valor máximo de desconto para este cliente. Aparece no recibo da venda.
      </p>
      {error ? (
        <p data-testid="customer-form-error" className="text-sm nx-cf-error">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          data-testid="customer-save"
          disabled={submitting}
          className="nx-cf-save"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            data-testid="customer-cancel"
            className="nx-cf-ghost"
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
