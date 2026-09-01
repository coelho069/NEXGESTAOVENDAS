/**
 * Creates demo auth users (server-side only — requires SUPABASE_SERVICE_ROLE_KEY).
 * Never import this script from client code.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/db/types";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const STORE_CENTRO = "22222222-2222-4222-8222-222222222201";
const STORE_SHOP = "22222222-2222-4222-8222-222222222202";

const USERS = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "admin@example.invalid",
    password: "Admin123!",
    fullName: "Admin Demo",
    role: "admin" as const,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "cashier@example.invalid",
    password: "Cashier123!",
    fullName: "Caixa Demo",
    role: "cashier" as const,
  },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const user of USERS) {
    const { data: existing } = await admin.auth.admin.getUserById(user.id);
    if (!existing.user) {
      const { error } = await admin.auth.admin.createUser({
        id: user.id,
        email: user.email,
        password: user.password,
        email_confirm: true,
        app_metadata: { role: user.role, org_id: ORG_ID },
      });
      if (error) throw error;
    }

    await admin.from("profiles").upsert({
      id: user.id,
      org_id: ORG_ID,
      full_name: user.fullName,
      email: user.email,
      default_role: user.role,
    });

    const stores = user.role === "admin" ? [STORE_CENTRO, STORE_SHOP] : [STORE_CENTRO, STORE_SHOP];
    for (const storeId of stores) {
      await admin.from("store_members").upsert(
        {
          org_id: ORG_ID,
          store_id: storeId,
          user_id: user.id,
          role: user.role,
        },
        { onConflict: "store_id,user_id" }
      );
    }
  }

  console.log("Seed auth completed.");
  console.log("Admin: admin@example.invalid / Admin123!");
  console.log("Cashier: cashier@example.invalid / Cashier123!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
