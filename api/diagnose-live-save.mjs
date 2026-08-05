import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://mxfeyumgdlmiplognpry.supabase.co';
const FALLBACK_PUBLIC_KEY = 'sb_publishable_8B_2gV3-U1QTA0J9wfsFrg_IhAD-9Av';
const DIAGNOSTIC_KEY = '7bcb4ef1-b180-47bb-8ddb-3cbff3e976fe';
const ADMIN_EMAIL = 'josphen.maged@ischooltech.com';

function validUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function cleanError(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null,
  };
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (request.query?.key !== DIAGNOSTIC_KEY) return response.status(404).json({ error: 'Not found.' });

  const configuredUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseUrl = validUrl(configuredUrl) ? String(configuredUrl).trim() : FALLBACK_URL;
  const configuredPublicKey = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  const publicKey = configuredPublicKey.startsWith('sb_publishable_') ? configuredPublicKey : FALLBACK_PUBLIC_KEY;
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) return response.status(503).json({ stage: 'configuration', error: 'Missing service role key.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let reviewId = null;
  try {
    const [{ data: profile }, { data: tutor }, { data: criteria }, { data: authUsersData, error: authUsersError }] = await Promise.all([
      admin.from('profiles').select('id, role, is_active').eq('email', ADMIN_EMAIL).maybeSingle(),
      admin.from('tutors').select('id').eq('employee_code', 'TEST-001').maybeSingle(),
      admin.from('evaluation_criteria').select('id, criterion_type').eq('is_active', true),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    if (authUsersError) return response.status(500).json({ stage: 'auth_lookup', error: cleanError(authUsersError) });
    const authUser = (authUsersData?.users || []).find((user) => user.email?.toLowerCase() === ADMIN_EMAIL);
    if (!authUser || !profile || !tutor || !criteria?.length) {
      return response.status(500).json({ stage: 'prerequisites', authUser: Boolean(authUser), profile: Boolean(profile), tutor: Boolean(tutor), criteria: criteria?.length || 0 });
    }

    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
    if (generateError || !generated?.properties?.hashed_token) return response.status(500).json({ stage: 'generate_token', error: cleanError(generateError) });

    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({ type: 'magiclink', token_hash: generated.properties.hashed_token });
    if (verifyError || !verified.session?.access_token) return response.status(500).json({ stage: 'verify_token', error: cleanError(verifyError) });

    const userClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
    });

    const { data: review, error: reviewError } = await userClient
      .from('reviews')
      .insert({
        tutor_id: tutor.id,
        evaluator_id: authUser.id,
        session_date: '2026-08-05',
        school_branch: `Live Diagnostic ${Date.now()}`,
        session_type: 'group',
        students_present: 1,
        age_level: 'Diagnostic',
        observation_scope: 'full_session',
        intended_learning_outcome: 'Temporary diagnostic review.',
        learning_outcome_status: 'partially_achieved',
        follow_up_status: 'none',
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (reviewError || !review) return response.status(500).json({ stage: 'review_insert', error: cleanError(reviewError) });
    reviewId = review.id;

    const scoreRows = criteria.map((criterion) => criterion.criterion_type === 'rating'
      ? {
          review_id: reviewId,
          criterion_id: criterion.id,
          numeric_score: 4,
          is_observed: true,
          compliance_result: null,
          is_applicable: null,
          is_external: false,
          evidence: 'Temporary diagnostic evidence.',
        }
      : {
          review_id: reviewId,
          criterion_id: criterion.id,
          numeric_score: null,
          is_observed: true,
          compliance_result: 'clear',
          is_applicable: true,
          is_external: false,
          evidence: 'Temporary diagnostic evidence.',
        });

    const { error: scoresError } = await userClient.from('review_scores').insert(scoreRows);
    if (scoresError) return response.status(500).json({ stage: 'score_insert', reviewId, error: cleanError(scoresError) });

    const { error: feedbackError } = await userClient.from('review_feedback').insert({
      review_id: reviewId,
      observed_strength: 'Temporary diagnostic strength.',
      development_priority: 'Temporary diagnostic priority.',
      required_action: 'Temporary diagnostic action.',
    });
    if (feedbackError) return response.status(500).json({ stage: 'feedback_insert', reviewId, error: cleanError(feedbackError) });

    return response.status(200).json({ ok: true, stage: 'complete', criteriaCount: criteria.length });
  } catch (error) {
    return response.status(500).json({ stage: 'unexpected', reviewId, error: cleanError(error) });
  } finally {
    if (reviewId) await admin.from('reviews').delete().eq('id', reviewId);
  }
}
