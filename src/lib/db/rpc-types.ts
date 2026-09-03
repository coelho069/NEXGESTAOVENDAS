import type { Enums } from "@/lib/db/types";

export type ProcessSaleResult = {
  sale_id: string;
  client_mutation_id: string;
  replay: boolean;
  status: Enums<"sale_status">;
  total?: string;
  stock_reconciled: boolean;
};
