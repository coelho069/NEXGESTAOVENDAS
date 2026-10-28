"use client";

import { shouldShowStoreSelect, type StoreOption } from "@/lib/auth/store-context";
import { landingTheme as t } from "@/components/landing/theme/landing-theme";

const STORE_SELECT_CSS = `
.nx-store-fixed { color: ${t.color.text}; }
.nx-store-select option { background: ${t.color.surface}; color: ${t.color.text}; }
`;

type StoreSelectProps = {
  stores: readonly StoreOption[];
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (storeId: string | null) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  testId: string;
  className?: string;
};

export function StoreSelect({
  stores,
  value,
  defaultValue,
  onChange,
  disabled = false,
  id,
  name,
  testId,
  className,
}: StoreSelectProps) {
  const soleStore = shouldShowStoreSelect(stores) ? undefined : stores[0];
  if (soleStore) {
    return (
      <>
        <style>{STORE_SELECT_CSS}</style>
        {name ? (
          <input type="hidden" name={name} value={soleStore.id} data-testid={`${testId}-hidden`} />
        ) : null}
        <span data-testid={`${testId}-fixed`} className="text-sm nx-store-fixed">
          {soleStore.name}
        </span>
      </>
    );
  }

  const selectProps =
    value !== undefined
      ? { value: value ?? "" }
      : { defaultValue: defaultValue ?? "" };

  return (
    <>
      <style>{STORE_SELECT_CSS}</style>
      <select
        id={id}
        name={name}
        data-testid={testId}
        className={className ? `nx-store-select ${className}` : "nx-store-select"}
        disabled={disabled || stores.length === 0}
        onChange={
          onChange
            ? (event) => {
                onChange(event.target.value || null);
              }
            : undefined
        }
        {...selectProps}
      >
        <option value="">Selecione...</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
    </>
  );
}
