import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { validate as validateUuid } from "uuid";
import {
  toInventoryDifference,
  toInventoryQuantity,
} from "../../src/lib/domain/quantity";
import { money, toMoneyString } from "../../src/lib/money";

// Diagnostico: NAO exporta nada de src. Le o texto de sync-engine.ts, extrai
// parsePullChangesPayload e helpers puros por nome, transpila e avalia com as
// dependencias reais (uuid, quantity.ts, money.ts).

const SOURCE_PATH = resolve(__dirname, "../../src/lib/offline/sync-engine.ts");

const EXTRACTED_FUNCTIONS = [
  "parsePullChangesPayload",
  "parsePullCursor",
  "normalizeMoneyValue",
  "normalizeQuantityValue",
  "normalizeSignedQuantityValue",
];

function extractFunction(source: string, name: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^(export )?function ${name}\\b`).test(line)
  );
  if (start < 0) throw new Error(`funcao ${name} nao encontrada em sync-engine.ts`);
  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end < 0) throw new Error(`fim da funcao ${name} nao encontrado`);
  return lines.slice(start, end + 1).join("\n");
}

function loadParser(): {
  parsePullChangesPayload: (value: unknown) => PullOut | null;
} {
  const source = readFileSync(SOURCE_PATH, "utf8");
  const body = EXTRACTED_FUNCTIONS.map((name) => extractFunction(source, name)).join(
    "\n\n"
  );
  const js = ts.transpileModule(
    `${body}\nreturn { parsePullChangesPayload };`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.None,
      },
    }
  ).outputText;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "validateUuid",
    "toInventoryQuantity",
    "toInventoryDifference",
    "money",
    "toMoneyString",
    js
  ) as (...args: unknown[]) => { parsePullChangesPayload: (v: unknown) => PullOut | null };
  return factory(
    validateUuid,
    toInventoryQuantity,
    toInventoryDifference,
    money,
    toMoneyString
  );
}

type PullOut = {
  serverTime: string;
  hasMore?: boolean;
  nextCursor?: Record<string, unknown>;
  inventory: Array<Record<string, unknown>>;
  inventoryMovements: Array<Record<string, unknown>>;
  sales: Array<Record<string, unknown>>;
};

const STORE = "3c7b85ff-bb21-4b33-8176-1bc174ae8518";

const PRODUCTION_PAYLOAD = {
  serverTime: "2026-10-15T13:18:03.747Z",
  has_more: false,
  next_cursor: {
    since: "2026-10-15T13:18:03.747Z",
    inventory_after_updated_at: "2026-10-15T12:24:24.103899+00:00",
    inventory_after_product_id: "19c540fd-2707-47f5-852f-e63fd0f0650c",
    inventory_after_created_at: "2026-10-15T12:24:24.103899+00:00",
    inventory_after_id: "12566c24-3313-426b-9b67-a418208346be",
    sales_after_updated_at: "2026-10-05T20:45:48.270384+00:00",
    sales_after_id: "33dc9626-d29f-40b8-af3d-2db04eb534d0",
  },
  inventory: [
    { store_id: STORE, product_id: "e3dfd6cc-87df-4612-add5-33538ed7a5e4", quantity: 1, updated_at: "2026-10-06T21:36:27.899489+00:00" },
    { store_id: STORE, product_id: "e5c1e9be-916d-4163-accb-931737a6b80e", quantity: 10, updated_at: "2026-10-15T10:34:56.172242+00:00" },
    { store_id: STORE, product_id: "635f1b09-517a-4b84-9f68-543afefaec67", quantity: 10, updated_at: "2026-10-15T10:35:48.780164+00:00" },
    { store_id: STORE, product_id: "70cf7e4d-2ac1-4b43-bca6-4d38d79e62aa", quantity: 10, updated_at: "2026-10-15T10:36:37.223713+00:00" },
    { store_id: STORE, product_id: "19c540fd-2707-47f5-852f-e63fd0f0650c", quantity: 10, updated_at: "2026-10-15T12:24:24.103899+00:00" },
  ],
  inventory_movements: [
    { id: "23d50d65-bd97-4341-b70b-bea50f2e6630", store_id: STORE, product_id: "e3dfd6cc-87df-4612-add5-33538ed7a5e4", client_mutation_id: "b1242db4-1ae6-44cd-8843-28a10534e31b", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 1, balance_after: 1, created_at: "2026-10-05T20:45:29.684594+00:00" },
    { id: "1071c313-9a35-4f67-904a-d12f224aa6c7", store_id: STORE, product_id: "e3dfd6cc-87df-4612-add5-33538ed7a5e4", client_mutation_id: null, terminal_id: null, import_id: null, import_row: null, movement_type: "sale", quantity_change: -1, balance_after: 0, created_at: "2026-10-05T20:45:48.270384+00:00" },
    { id: "df45fd35-146f-44ec-a516-b646e4788f99", store_id: STORE, product_id: "e3dfd6cc-87df-4612-add5-33538ed7a5e4", client_mutation_id: "f080c5bf-8ef3-4930-8923-1acfe63a7d78", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 1, balance_after: 1, created_at: "2026-10-06T21:36:27.899489+00:00" },
    { id: "46aa4ecd-0364-46a0-919e-bca11d9e752e", store_id: STORE, product_id: "e5c1e9be-916d-4163-accb-931737a6b80e", client_mutation_id: "c7cf6ff8-0c4c-4daa-99c6-ddb0c5928b8e", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 10, balance_after: 10, created_at: "2026-10-15T10:34:56.172242+00:00" },
    { id: "e2ef3409-dbe7-4225-a24e-8f68842f0770", store_id: STORE, product_id: "635f1b09-517a-4b84-9f68-543afefaec67", client_mutation_id: "4aa517ed-efbc-4b89-b2eb-59fc321465ec", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 10, balance_after: 10, created_at: "2026-10-15T10:35:48.780164+00:00" },
    { id: "443673e5-ec00-4303-9bb6-a0f92a2d7541", store_id: STORE, product_id: "70cf7e4d-2ac1-4b43-bca6-4d38d79e62aa", client_mutation_id: "47def134-c1a3-452a-99ac-d563c8e49f54", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 10, balance_after: 10, created_at: "2026-10-15T10:36:37.223713+00:00" },
    { id: "12566c24-3313-426b-9b67-a418208346be", store_id: STORE, product_id: "19c540fd-2707-47f5-852f-e63fd0f0650c", client_mutation_id: "5e9435d0-3eaa-4d72-9cab-cf0d68c40e4b", terminal_id: null, import_id: null, import_row: null, movement_type: "restock", quantity_change: 10, balance_after: 10, created_at: "2026-10-15T12:24:24.103899+00:00" },
  ],
  sales: [
    { id: "33dc9626-d29f-40b8-af3d-2db04eb534d0", client_mutation_id: "af862167-90aa-412f-9657-90d49439fec4", status: "confirmed", sync_status: "synced", total: 80, updated_at: "2026-10-05T20:45:48.270384+00:00" },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("diagnostico parsePullChangesPayload com payload real de producao", () => {
  const { parsePullChangesPayload } = loadParser();

  it("aceita o payload real de producao", () => {
    const result = parsePullChangesPayload(clone(PRODUCTION_PAYLOAD));
    expect(result).not.toBeNull();
    expect(result!.inventory).toHaveLength(5);
    expect(result!.inventoryMovements).toHaveLength(7);
    expect(result!.sales).toHaveLength(1);
    expect(result!.nextCursor === undefined || typeof result!.nextCursor === "object").toBe(true);
    expect(result!.nextCursor?.since).toBe("2026-10-15T13:18:03.747Z");
    expect(result!.hasMore).toBe(false);
  });

  it("rejeita variante com product_id invalido (prova que o teste discrimina)", () => {
    const broken = clone(PRODUCTION_PAYLOAD);
    broken.inventory[0].product_id = "nao-e-uuid";
    expect(parsePullChangesPayload(broken)).toBeNull();
  });
});
