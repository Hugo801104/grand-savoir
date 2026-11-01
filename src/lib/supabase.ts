import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, hasBackend } from './config';

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient | null> | null = null;

/** Client Supabase chargé à la demande (l'appli fonctionne sans). */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!hasBackend()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'grand-savoir-auth' },
    });
    return client;
  });
  return loading;
}
