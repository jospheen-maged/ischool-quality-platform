import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://mxfeyumgdlmiplognpry.supabase.co';
const fallbackPublishableKey = 'sb_publishable_8B_2gV3-U1QTA0J9wfsFrg_IhAD-9Av';

function clean(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\n|\\r/g, '');
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function isValidPublishableKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('eyJ');
}

const configuredUrl = clean(import.meta.env.VITE_SUPABASE_URL);
const configuredKey = clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

export const supabaseUrl = isValidSupabaseUrl(configuredUrl)
  ? configuredUrl
  : fallbackUrl;

export const supabasePublishableKey = isValidPublishableKey(configuredKey)
  ? configuredKey
  : fallbackPublishableKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'b2b-offline-auth',
  },
});
