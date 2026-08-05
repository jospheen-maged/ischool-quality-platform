import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://mxfeyumgdlmiplognpry.supabase.co';
const fallbackPublishableKey = 'sb_publishable_8B_2gV3-U1QTA0J9wfsFrg_IhAD-9Av';

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/^['"]|['"]$/g, '') : '';
}

const configuredUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const configuredKey = clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

export const supabaseUrl = configuredUrl || fallbackUrl;
export const supabasePublishableKey = configuredKey || fallbackPublishableKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'b2b-offline-auth',
  },
});
