import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * Provides the typed Supabase client used by client-side features.
 *
 * The browser SSR client is reused so auth state and its storage key remain
 * consistent across the application.
 */
export function createClient() {
  return createBrowserClient();
}
