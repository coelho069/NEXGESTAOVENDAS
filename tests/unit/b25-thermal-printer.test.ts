import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BrowserPrinterAdapter,
  EscPosPrinterAdapter,
  NetworkPrinterAdapter,
  NativePrinterAdapter,
  dispatchPrintJob,
  getPrinterAdapter,
  resolvePrinterConfigView,
  retryPrintJob,
} from "@/lib/adapters/printer";
import {
  PRINT_DELIVERY_SEMANTICS,
  assertNoShellPrinterCommand,
  buildEscPosReceipt,
  charsPerLine,
  createPrintJob,
  encodeEscPosText,
  escPosAlign,
  escPosBold,
  escPosCut,
  escPosFeed,
  escPosInit,
  escPosQr,
  escPosBarcode,
  isTerminalPrintFailure,
  nextPrintAttempt,
  printFailureAffectsSaleLifecycle,
  rejectShellPrinterExecution,
  validateNetworkPrinterDestination,
  wrapEscPosLine,
} from "@/lib/domain/printer";
import { renderReceiptHtml, type ReceiptModel } from "@/lib/domain/receipt";
import {
  attachSettingsMeta,
  defaultStoreSettings,
  enrichReceiptWithSettings,
  validateStoreSettingsWrite,
} from "@/lib/domain/store-settings";
import { canManagePrinterSettings, canPrintReceipt } from "@/lib/domain/rbac";
import {
  getPublicPrinterStatus,
  refuseServerNetworkPrint,
  refuseShellPrint,
} from "@/lib/server/printer";
import { storeSettingsWriteSchema } from "@/lib/validation/schemas";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20260906090000_b25_printer_settings.sql"),
  "utf8"
);

const STORE_ID = "22222222-2222-4222-8222-222222222201";
const OTHER_STORE = "22222222-2222-4222-8222-222222222202";
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SALE_ID = "33333333-3333-4333-8333-333333333301";

function sampleReceipt(overrides?: Partial<ReceiptModel>): ReceiptModel {
  return {
    saleId: SALE_ID,
    storeName: "Loja Centro",
    storeDocument: "12345678000195",
    createdAt: "2026-09-06T12:00:00.000Z",
    customerName: "Maria",
    operatorName: "Caixa",
    lines: [
      {
        productId: "p1",
        sku: "BEV-001",
        name: "Água com gás",
        unitPrice: "3.50",
        quantity: 2,
        discount: "0.00",
      },
    ],
    subtotal: "7.00",
    discount: "0.00",
    total: "7.00",
    amountReceived: "10.00",
    changeDue: "3.00",
    payments: [{ method: "cash", amount: "7.00", status: "captured" }],
    syncStatus: "synced",
    saleStatus: "confirmed",
    fiscalStatus: "not_configured",
    ...overrides,
  };
}

describe("B25 browser receipt layout", () => {
  it("renders 58mm and 80mm thermal widths with accents and BRL", () => {
    const receipt = sampleReceipt();
    const html58 = renderReceiptHtml(receipt, { paperWidthMm: 58 });
    const html80 = renderReceiptHtml(receipt, { paperWidthMm: 80 });
    expect(html58).toContain('data-receipt-paper-width="58"');
    expect(html80).toContain('data-receipt-paper-width="80"');
    expect(html58).toContain("Água com gás");
    expect(html58).toContain("R$");
    expect(html58).toContain('data-receipt-kind="commercial"');
    expect(html58).not.toMatch(/chave fiscal falsa|protocolo falso/i);
    expect(html58).toContain("Comprovante comercial");
  });

  it("browser adapter dispatches print without claiming hardware success", async () => {
    const browserPrint = vi.fn();
    const { job, result } = await dispatchPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "browser",
      paperWidthMm: 80,
      receipt: sampleReceipt(),
      context: { browserPrint },
    });
    expect(browserPrint).toHaveBeenCalledOnce();
    expect(result.status).toBe("print_dispatched");
    expect(job.status).toBe("print_dispatched");
    expect(result.status).not.toBe("print_succeeded");
  });
});

describe("B25 ESC/POS generation", () => {
  it("builds init, align, bold, feed, cut and encodes accents", () => {
    expect(escPosInit()[0]).toBe(0x1b);
    expect(Array.from(escPosAlign("center"))).toEqual([0x1b, 0x61, 1]);
    expect(Array.from(escPosBold(true))).toEqual([0x1b, 0x45, 1]);
    expect(Array.from(escPosFeed(2))).toEqual([0x1b, 0x64, 2]);
    expect(Array.from(escPosCut(false))).toEqual([0x1d, 0x56, 0]);
    const encoded = encodeEscPosText("Café");
    expect(encoded.length).toBeGreaterThan(3);
    expect(charsPerLine(58)).toBe(32);
    expect(charsPerLine(80)).toBe(48);
    expect(wrapEscPosLine("item muito longo para quebrar linha térmica", 58).length).toBeGreaterThan(1);
  });

  it("includes QR only when fiscal key is really available and barcode when applicable", () => {
    expect(escPosQr("")).toBeNull();
    const qr = escPosQr("35260900000000000000550010000000011123456789012");
    expect(qr).not.toBeNull();
    expect(escPosBarcode("SALE-123")).not.toBeNull();
    expect(escPosBarcode("")).toBeNull();

    const commercial = buildEscPosReceipt(sampleReceipt({ fiscalStatus: "pending" }), 58);
    expect(commercial.byteLength).toBeGreaterThan(40);
    // pending must not invent fiscal QR content with forged keys
    const asText = Buffer.from(commercial).toString("latin1");
    expect(asText).not.toContain("FAKE-KEY");

    const issued = buildEscPosReceipt(
      sampleReceipt({
        fiscalStatus: "issued",
        fiscalAccessKey: "35260900000000000000550010000000011123456789012",
        fiscalKind: "nfce",
      }),
      80
    );
    expect(issued.byteLength).toBeGreaterThan(commercial.byteLength);
  });

  it("ESC/POS adapter without hardware returns printer_not_configured (no fake success)", async () => {
    const adapter = new EscPosPrinterAdapter();
    expect(adapter.configured).toBe(false);
    const job = createPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "escpos",
      paperWidthMm: 58,
    });
    const result = await adapter.print(job, sampleReceipt());
    expect(result.status).toBe("printer_not_configured");
    expect(result.payload?.byteLength).toBeGreaterThan(10);
    expect(result.status).not.toBe("print_succeeded");
  });
});

describe("B25 network / native / USB safety", () => {
  it("rejects SSRF destinations and never accepts arbitrary host/port", () => {
    expect(validateNetworkPrinterDestination("169.254.169.254", 80).ok).toBe(false);
    expect(validateNetworkPrinterDestination("localhost", 9100).ok).toBe(false);
    expect(validateNetworkPrinterDestination("http://evil.com", 9100).ok).toBe(false);
    expect(validateNetworkPrinterDestination("evil.com/path", 9100).ok).toBe(false);
    expect(validateNetworkPrinterDestination("192.168.0.10", 9100).ok).toBe(false);
    expect(validateNetworkPrinterDestination("printer.local", 22).ok).toBe(false);
    expect(validateNetworkPrinterDestination("printer.local", 99999).ok).toBe(false);
    expect(refuseServerNetworkPrint("8.8.8.8", 9100).ok).toBe(false);
  });

  it("rejects shell injection patterns and never execs user input", () => {
    expect(() => assertNoShellPrinterCommand("lpstat; rm -rf /")).toThrow(/shell_injection/);
    expect(() => rejectShellPrinterExecution("bash -c 'id'")).toThrow(/shell_injection/);
    expect(() => refuseShellPrint("cmd.exe /c dir")).toThrow(/shell_injection/);
  });

  it("network and native adapters stay not_configured without bridge", async () => {
    const network = new NetworkPrinterAdapter();
    const native = new NativePrinterAdapter();
    const jobNet = createPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "network",
      paperWidthMm: 80,
    });
    const jobNative = createPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "native",
      paperWidthMm: 80,
    });
    expect((await network.print(jobNet, sampleReceipt())).status).toBe("printer_not_configured");
    expect((await native.print(jobNative, sampleReceipt())).status).toBe("printer_not_configured");
  });
});

describe("B25 settings / RBAC / store isolation", () => {
  it("validates print_mode and paper_width and keeps store-scoped defaults", () => {
    const ok = validateStoreSettingsWrite({
      store_id: STORE_ID,
      print_mode: "browser",
      paper_width_mm: 58,
      auto_print_receipt: true,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.value.print_mode).toBe("browser");
    expect(ok.value.paper_width_mm).toBe(58);

    expect(
      validateStoreSettingsWrite({
        store_id: STORE_ID,
        print_mode: "usb" as never,
      }).ok
    ).toBe(false);
    expect(
      validateStoreSettingsWrite({
        store_id: STORE_ID,
        paper_width_mm: 72 as never,
      }).ok
    ).toBe(false);

    const parsed = storeSettingsWriteSchema.safeParse({
      store_id: STORE_ID,
      print_mode: "escpos",
      paper_width_mm: 58,
      org_id: ORG_ID,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("org_id");
      expect(parsed.data.print_mode).toBe("escpos");
    }
  });

  it("cashier can print; only manager/admin can manage printer settings", () => {
    expect(canPrintReceipt("cashier")).toBe(true);
    expect(canManagePrinterSettings("cashier")).toBe(false);
    expect(canManagePrinterSettings("manager")).toBe(true);
    expect(canManagePrinterSettings("admin")).toBe(true);
  });

  it("exposes printer integration status per store settings without secrets", () => {
    const centro = attachSettingsMeta({
      settings: {
        ...defaultStoreSettings(STORE_ID, ORG_ID),
        print_mode: "escpos",
        paper_width_mm: 58,
        auto_print_receipt: true,
      },
      store: { id: STORE_ID, name: "Centro", code: "C", is_active: true },
      organization: { id: ORG_ID, name: "Org", currency: "BRL", timezone: "America/Sao_Paulo" },
      can_edit: true,
      role: "manager",
    });
    expect(centro.integrations.printer.status).toBe("not_configured");
    expect(centro.integrations.printer.mode).toBe("escpos");
    expect(centro.integrations.printer.paperWidthMm).toBe(58);
    expect(centro.integrations.printer.printerConfigured).toBe(false);
    expect(JSON.stringify(centro.integrations.printer)).not.toMatch(/password|secret|api[_-]?key/i);

    const shopping = attachSettingsMeta({
      settings: defaultStoreSettings(OTHER_STORE, ORG_ID),
      store: { id: OTHER_STORE, name: "Shopping", code: "S", is_active: true },
      organization: { id: ORG_ID, name: "Org", currency: "BRL", timezone: "America/Sao_Paulo" },
      can_edit: false,
      role: "cashier",
    });
    expect(shopping.settings.store_id).toBe(OTHER_STORE);
    expect(shopping.settings.store_id).not.toBe(centro.settings.store_id);
    expect(shopping.integrations.printer.mode).toBe("browser");
  });

  it("enrichReceipt applies paper width from store settings", () => {
    const enriched = enrichReceiptWithSettings(sampleReceipt(), {
      ...defaultStoreSettings(STORE_ID, ORG_ID),
      paper_width_mm: 58,
    });
    expect(enriched.paperWidthMm).toBe(58);
  });
});

describe("B25 auto-print / retry / offline invariants", () => {
  it("auto_print false means caller should not dispatch; true only requests print", async () => {
    const viewOff = resolvePrinterConfigView({
      mode: "browser",
      autoPrintReceipt: false,
    });
    expect(viewOff.autoPrintReceipt).toBe(false);

    const viewOn = getPublicPrinterStatus({
      print_mode: "browser",
      paper_width_mm: 80,
      auto_print_receipt: true,
    });
    expect(viewOn.autoPrintReceipt).toBe(true);
    // Request ≠ confirmed physical print
    expect(PRINT_DELIVERY_SEMANTICS).toBe("at-least-once");
  });

  it("unavailable printer does not affect sale lifecycle and supports retry tracking", async () => {
    expect(printFailureAffectsSaleLifecycle()).toBe(false);
    const { job } = await dispatchPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "escpos",
      paperWidthMm: 80,
      receipt: sampleReceipt({ syncStatus: "pending" }),
    });
    expect(job.status).toBe("printer_not_configured");
    expect(isTerminalPrintFailure(job.status)).toBe(true);

    const retried = await retryPrintJob(job, sampleReceipt());
    expect(retried.job.attempt).toBe(2);
    expect(retried.job.printJobId).not.toBe(job.printJobId);
    expect(retried.job.idempotencyKey).toBe(`${SALE_ID}:2`);
    expect(retried.result.status).toBe("printer_not_configured");

    const next = nextPrintAttempt(job);
    expect(next.attempt).toBe(job.attempt + 1);
  });

  it("offline sale sync remains independent from printer adapter", async () => {
    const offlineReceipt = sampleReceipt({ syncStatus: "pending", saleStatus: "confirmed" });
    const { result } = await dispatchPrintJob({
      saleId: offlineReceipt.saleId,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "network",
      paperWidthMm: 58,
      receipt: offlineReceipt,
    });
    expect(result.status).toBe("printer_not_configured");
    // Sale fields unchanged by print path
    expect(offlineReceipt.saleStatus).toBe("confirmed");
    expect(offlineReceipt.syncStatus).toBe("pending");
  });

  it("browser timeout / failure paths are explicit", async () => {
    const browser = new BrowserPrinterAdapter();
    const job = createPrintJob({
      saleId: SALE_ID,
      storeId: STORE_ID,
      orgId: ORG_ID,
      mode: "browser",
      paperWidthMm: 80,
    });
    const timeout = await browser.print(job, sampleReceipt(), {
      browserPrint: () => {
        throw new Error("timeout waiting for print");
      },
    });
    expect(timeout.status).toBe("timeout");

    const failed = await browser.print(job, sampleReceipt(), {
      browserPrint: () => {
        throw new Error("printer offline");
      },
    });
    expect(failed.status).toBe("print_failed");

    const missing = await browser.print(job, sampleReceipt(), {});
    expect(missing.status).toBe("printer_not_configured");
  });
});

describe("B25 migration contract", () => {
  it("adds print_mode/paper_width without host secrets and keeps manager/admin writes", () => {
    expect(MIGRATION).toContain("print_mode");
    expect(MIGRATION).toContain("paper_width_mm");
    expect(MIGRATION).toContain("v_role NOT IN ('admin', 'manager')");
    expect(MIGRATION).toContain("printer_host");
    expect(MIGRATION).toContain("invalid_settings_print_mode");
    expect(MIGRATION).not.toMatch(/api[_-]?key/i);
    expect(MIGRATION).not.toMatch(/\bexec\b/i);
    expect(getPrinterAdapter("browser").mode).toBe("browser");
  });
});
