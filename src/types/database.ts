/**
 * Compatibility entry point for feature code.
 *
 * The source of truth remains the generated database contract in
 * `src/lib/db/types.ts`; run `pnpm db:types` after schema changes.
 */
export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/db/types";
