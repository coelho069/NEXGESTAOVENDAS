import type { CustomerDraft } from "@/lib/domain/customer";

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
      <label className="block text-sm">
        Nome
        <input
          data-testid="customer-name"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        Documento
        <input
          data-testid="customer-document"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={draft.document}
          onChange={(event) => onChange({ ...draft, document: event.target.value })}
        />
      </label>
      <label className="block text-sm">
        E-mail
        <input
          data-testid="customer-email"
          type="email"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          value={draft.email}
          onChange={(event) => onChange({ ...draft, email: event.target.value })}
        />
      </label>
      {error ? (
        <p data-testid="customer-form-error" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          data-testid="customer-save"
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:bg-emerald-300"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            data-testid="customer-cancel"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold"
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
