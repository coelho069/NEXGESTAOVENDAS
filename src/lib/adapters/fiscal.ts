export const FISCAL_ADAPTER_STATUSES = [
  "issued",
  "failed",
  "pending",
  "unknown",
  "not_configured",
  "cancelled",
] as const;

export type FiscalAdapterStatus = (typeof FISCAL_ADAPTER_STATUSES)[number];

export type FiscalSnapshot = Record<string, unknown>;

export type FiscalOperationContext = {
  documentId: string;
  saleId: string;
  storeId: string;
  operationId: string;
  idempotencyKey: string;
  snapshot: FiscalSnapshot;
  externalId?: string | null;
  signal?: AbortSignal;
};

export type FiscalOperationInput = FiscalOperationContext | string;

export type FiscalAdapterResult = {
  status: FiscalAdapterStatus;
  message: string;
  providerReference?: string;
  externalId?: string;
  errorCode?: string;
  retryable?: boolean;
};

export type FiscalAdapterResultOrPromise = FiscalAdapterResult | Promise<FiscalAdapterResult>;

export interface FiscalAdapter {
  readonly name: string;
  issue(input: FiscalOperationInput): FiscalAdapterResultOrPromise;
  cancel(input: FiscalOperationInput): FiscalAdapterResultOrPromise;
  consult(input: FiscalOperationInput): FiscalAdapterResultOrPromise;
}

/** Backwards-compatible name used by the first fiscal placeholder. */
export type FiscalDocumentAdapter = FiscalAdapter;

export class NotConfiguredFiscalAdapter implements FiscalAdapter {
  readonly name = "not_configured";

  issue(input: FiscalOperationInput): FiscalAdapterResult {
    void input;
    return {
      status: "not_configured",
      message: "Provider fiscal não configurado; nenhuma emissão foi executada.",
      errorCode: "provider_not_configured",
      retryable: false,
    };
  }

  cancel(input: FiscalOperationInput): FiscalAdapterResult {
    void input;
    return {
      status: "not_configured",
      message: "Provider fiscal não configurado; nenhum cancelamento foi executado.",
      errorCode: "provider_not_configured",
      retryable: false,
    };
  }

  consult(input: FiscalOperationInput): FiscalAdapterResult {
    void input;
    return {
      status: "not_configured",
      message: "Provider fiscal não configurado; nenhuma consulta foi executada.",
      errorCode: "provider_not_configured",
      retryable: false,
    };
  }
}

type FiscalHttpOperation = "issue" | "cancel" | "consult";

type FiscalHttpAdapterOptions = {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Generic server-only HTTP adapter. It is deliberately conservative:
 * transport failures are UNKNOWN, and a successful HTTP response without an
 * explicit provider status is also UNKNOWN. The adapter never infers ISSUED.
 */
export class HttpFiscalAdapter implements FiscalAdapter {
  readonly name: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: FiscalHttpAdapterOptions = {}
  ) {
    this.name = name;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  issue(input: FiscalOperationInput): Promise<FiscalAdapterResult> {
    return this.execute("issue", input);
  }

  cancel(input: FiscalOperationInput): Promise<FiscalAdapterResult> {
    return this.execute("cancel", input);
  }

  consult(input: FiscalOperationInput): Promise<FiscalAdapterResult> {
    return this.execute("consult", input);
  }

  private async execute(
    operation: FiscalHttpOperation,
    input: FiscalOperationInput
  ): Promise<FiscalAdapterResult> {
    const context = normalizeFiscalContext(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    context.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await this.fetchFn(this.endpoint(operation, context), {
        method: operation === "consult" ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Idempotency-Key": context.idempotencyKey,
          "X-Operation-Id": context.operationId,
        },
        body:
          operation === "consult"
            ? undefined
            : JSON.stringify({
                document_id: context.documentId,
                sale_id: context.saleId,
                store_id: context.storeId,
                operation_id: context.operationId,
                idempotency_key: context.idempotencyKey,
                snapshot: context.snapshot,
                external_id: context.externalId ?? undefined,
              }),
        signal: controller.signal,
      });

      const body = await readProviderBody(response);
      return normalizeProviderResponse(operation, response.status, body);
    } catch {
      const timedOut = controller.signal.aborted;
      return {
        status: "unknown",
        message: timedOut
          ? "O provider fiscal excedeu o timeout; resultado desconhecido."
          : "Não foi possível confirmar a resposta do provider fiscal.",
        errorCode: timedOut ? "provider_timeout" : "provider_unreachable",
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private endpoint(operation: FiscalHttpOperation, context: FiscalOperationContext): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    if (operation === "consult") {
      const reference = encodeURIComponent(context.externalId ?? context.documentId);
      return `${base}/documents/${reference}`;
    }
    return `${base}/${operation}`;
  }
}

function normalizeFiscalContext(input: FiscalOperationInput): FiscalOperationContext {
  if (typeof input !== "string") return input;
  return {
    documentId: input,
    saleId: input,
    storeId: "",
    operationId: input,
    idempotencyKey: `fiscal:${input}`,
    snapshot: {},
  };
}

async function readProviderBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeProviderResponse(
  operation: FiscalHttpOperation,
  httpStatus: number,
  body: Record<string, unknown>
): FiscalAdapterResult {
  const providerStatus = typeof body.status === "string" ? body.status.toLowerCase() : "";
  const externalId =
    typeof body.external_id === "string"
      ? body.external_id
      : typeof body.id === "string"
        ? body.id
        : undefined;
  const errorCode =
    typeof body.error_code === "string" ? safeErrorCode(body.error_code) : undefined;

  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    return {
      status: "unknown",
      message: "Provider fiscal indisponível; o resultado requer reconciliação.",
      errorCode: errorCode ?? "provider_unavailable",
      retryable: true,
    };
  }

  if (!providerStatus) {
    return {
      status: httpStatus >= 200 && httpStatus < 300 ? "unknown" : "failed",
      message:
        httpStatus >= 200 && httpStatus < 300
          ? "Provider respondeu sem estado fiscal confirmável."
          : "Provider rejeitou a operação fiscal.",
      errorCode: errorCode ?? (httpStatus >= 200 && httpStatus < 300
        ? "provider_status_missing"
        : "provider_rejected"),
      retryable: httpStatus >= 500,
      ...(externalId ? { externalId } : {}),
    };
  }

  const allowed = new Set<string>(
    operation === "issue"
      ? ["issued", "failed", "pending", "unknown", "not_configured"]
      : operation === "cancel"
        ? ["cancelled", "failed", "pending", "unknown", "not_configured"]
        : ["issued", "failed", "pending", "unknown", "cancelled", "not_configured"]
  );

  if (!allowed.has(providerStatus)) {
    return {
      status: "unknown",
      message: "Provider retornou um estado fiscal incompatível.",
      errorCode: "provider_status_invalid",
      retryable: false,
    };
  }

  return {
    status: providerStatus as FiscalAdapterStatus,
    message: `Provider fiscal retornou ${providerStatus}.`,
    ...(externalId ? { externalId } : {}),
    ...(errorCode ? { errorCode } : {}),
    retryable: providerStatus === "pending" || providerStatus === "unknown",
  };
}

function safeErrorCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) || "provider_error";
}

export const fiscalAdapter = new NotConfiguredFiscalAdapter();
