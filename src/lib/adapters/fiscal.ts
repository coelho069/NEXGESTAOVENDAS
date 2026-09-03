export type FiscalAdapterStatus = "not_configured" | "pending" | "issued" | "failed" | "cancelled";

export interface FiscalDocumentAdapter {
  readonly name: string;
  issue(_saleId: string): { status: FiscalAdapterStatus; message: string };
}

export class NotConfiguredFiscalAdapter implements FiscalDocumentAdapter {
  readonly name = "not_configured";

  issue(saleId: string) {
    void saleId;
    return {
      status: "not_configured" as const,
      message: "NFC-e/SAT não configurado no Sprint 1.",
    };
  }
}

export const fiscalAdapter = new NotConfiguredFiscalAdapter();
