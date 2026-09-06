"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MemberRole } from "@/lib/domain/rbac";
import type {
  StoreSettingsResponse,
  StoreSettingsWriteInput,
} from "@/lib/domain/store-settings";
import { pdvFixturesEnabled } from "@/lib/pdv/fixtures";
import {
  clearStoreSettingsCache,
  fetchStoreSettings,
  writeStoreSettingsCache,
} from "@/lib/pdv/settings-api";
import {
  getFixtureStoreSettings,
  upsertFixtureStoreSettings,
} from "@/lib/pdv/settings-fixtures";

function readError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    if (body.error === "forbidden_settings") return "Sem permissão para configurações desta loja";
    if (body.error === "settings_validation_failed" && "message" in body && typeof body.message === "string") {
      return body.message;
    }
    return body.error;
  }
  return fallback;
}

export function useStoreSettings(storeId: string | null, role: MemberRole | null) {
  const [data, setData] = useState<StoreSettingsResponse | null>(() =>
    storeId && pdvFixturesEnabled() ? getFixtureStoreSettings(storeId, role) : null
  );
  const [loading, setLoading] = useState(() => Boolean(storeId) && !pdvFixturesEnabled());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const activeStoreId = useRef<string | null>(storeId);

  useEffect(() => {
    activeStoreId.current = storeId;
  }, [storeId]);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const seq = ++requestSeq.current;
    const targetStoreId = storeId;

    if (!targetStoreId) {
      setData(null);
      setLoading(false);
      setError(null);
      return null;
    }

    if (pdvFixturesEnabled()) {
      const local = getFixtureStoreSettings(targetStoreId, role);
      if (seq === requestSeq.current && activeStoreId.current === targetStoreId) {
        setData(local);
        setError(null);
        setLoading(false);
      }
      return local;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchStoreSettings(targetStoreId, { force: options?.force });
      // Drop stale responses when the operator switches stores mid-flight.
      if (seq !== requestSeq.current || activeStoreId.current !== targetStoreId) {
        return payload;
      }
      setData(payload);
      return payload;
    } catch (cause) {
      if (seq !== requestSeq.current || activeStoreId.current !== targetStoreId) {
        return null;
      }
      setData(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar configurações");
      return null;
    } finally {
      if (seq === requestSeq.current && activeStoreId.current === targetStoreId) {
        setLoading(false);
      }
    }
  }, [role, storeId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: Omit<StoreSettingsWriteInput, "store_id">) => {
      if (!storeId) throw new Error("Selecione uma loja");

      if (pdvFixturesEnabled()) {
        setSaving(true);
        setError(null);
        try {
          const next = upsertFixtureStoreSettings({ ...input, store_id: storeId }, role);
          setData(next);
          setSavedAt(new Date().toISOString());
          return next;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Falha ao salvar";
          setError(message === "forbidden_settings" ? "Sem permissão para alterar configurações" : message);
          throw cause;
        } finally {
          setSaving(false);
        }
      }

      setSaving(true);
      setError(null);
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, store_id: storeId }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(body, "Não foi possível salvar configurações"));
        }
        const payload = body as StoreSettingsResponse;
        writeStoreSettingsCache(storeId, payload);
        if (activeStoreId.current === storeId) {
          setData(payload);
          setSavedAt(new Date().toISOString());
        }
        return payload;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Não foi possível salvar configurações");
        throw cause;
      } finally {
        setSaving(false);
      }
    },
    [role, storeId]
  );

  useEffect(() => {
    return () => {
      // Keep cache across unmount; only bump seq so in-flight sets are ignored.
      requestSeq.current += 1;
    };
  }, []);

  return {
    data,
    settings: data?.settings ?? null,
    loading,
    saving,
    error,
    savedAt,
    refresh: () => refresh({ force: true }),
    save,
    clearCache: clearStoreSettingsCache,
  };
}
