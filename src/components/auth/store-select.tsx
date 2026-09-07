"use client";

import { shouldShowStoreSelect, type StoreOption } from "@/lib/auth/store-context";

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
        {name ? (
          <input type="hidden" name={name} value={soleStore.id} data-testid={`${testId}-hidden`} />
        ) : null}
        <span data-testid={`${testId}-fixed`} className="text-sm text-slate-800">
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
    <select
      id={id}
      name={name}
      data-testid={testId}
      className={className}
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
  );
}
