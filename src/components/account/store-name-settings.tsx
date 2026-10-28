"use client";

import { useState } from "react";
import { STORE_NAME_MAX_LENGTH, isValidStoreName, normalizeStoreName } from "@/lib/domain/store-name";

type Props = {
  storeId: string;
  initialName: string;
  canEdit: boolean;
};

const ERROR_MESSAGES: Record<string, string> = {
  forbidden_settings: "Só o administrador ou o gerente da loja pode alterar o nome.",
  invalid_store_name: `Use entre 2 e ${STORE_NAME_MAX_LENGTH} caracteres.`,
};

/** Nome da loja editável pelo administrador ou gerente. Aparece no PDV e no recibo. */
export function StoreNameSettings({ storeId, initialName, canEdit }: Props) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!isValidStoreName(name)) {
      setMessage(ERROR_MESSAGES.invalid_store_name);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/store/name", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, name: normalizeStoreName(name) }),
      });
      const body = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!response.ok || typeof body.name !== "string") {
        setMessage(ERROR_MESSAGES[body.error ?? ""] ?? "Não foi possível salvar. Tente de novo.");
        return;
      }
      setName(body.name);
      setMessage("Nome da loja salvo.");
    } catch {
      setMessage("Não foi possível salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <p data-testid="store-name-readonly" style={{ margin: 0, fontSize: 14 }}>
        Nome da loja: <strong>{initialName}</strong>
      </p>
    );
  }

  return (
    <form
      data-testid="store-name-form"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="block text-sm font-semibold" htmlFor="store-name-input">
        Nome da loja
      </label>
      <input
        id="store-name-input"
        data-testid="store-name-input"
        type="text"
        value={name}
        maxLength={STORE_NAME_MAX_LENGTH}
        onChange={(event) => {
          setMessage(null);
          setName(event.target.value);
        }}
        className="min-h-[44px] w-full rounded-xl border border-border bg-transparent px-3"
      />
      <p className="text-xs text-muted-foreground">Esse nome aparece no PDV e no recibo.</p>
      <button
        type="submit"
        data-testid="store-name-save"
        disabled={saving}
        className="min-h-[44px] rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Salvando…" : "Salvar nome"}
      </button>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
