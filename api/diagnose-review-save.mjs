import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://mxfeyumgdlmiplognpry.supabase.co';
const FALLBACK_PUBLIC_KEY = 'sb_publishable_8B_2gV3-U1QTA0J9wfsFrg_IhAD-9Av';
const DIAGNOSTIC_KEY = '9f3d3f9b-6e2f-49b5-98a8-5d7ca2fa4f21';
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

function reviewPayload(tutorId, evaluatorId, branch) {
  return {
    tutor_id: tutorId,
    evaluator_id: evaluatorId,
    session_date: '2026-08-05',
    school_branch: branch,
    session_type: 'group',
    students_present: 1,
    age_level: 'Diagnostic',
    observation_scope: 'full_session',
    intended_learning_outcome: 'Temporary diagnostic review. This record is deleted immediately.',
    learning_outcome_status: 'partially_achieved',
    follow_up_status: 'none',
    status: 'submitted',
    submitted_at: new Date().toISOString(),
  };
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json');
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

  const createdReviewIds = [];
  try {
    const [{ data: profileRows, error: profileRowsError }, { data: authUsersData, error: authUsersError }] = await Promise.all([
      admin.from('profiles').select('id, email, role, is_active').eq('email', ADMIN_EMAIL),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (profileRowsError) return response.status(500).json({ stage: 'profile_lookup', error: cleanError(profileRowsError) });
    if (authUsersError) return response.status(500).json({ stage: 'auth_lookup', error: cleanError(authUsersError) });

    const authUser = (authUsersData?.users || []).find((user) => user.email?.toLowerCase() === ADMIN_EMAIL);
    const evaluator = profileRows?.find((profile) => profile.id === authUser?.id) || null;
    if (!authUser || !evaluator) {
      return response.status(500).json({
        stage: 'account_linkage',
        authUserId: authUser?.id || null,
        profileIds: (profileRows || []).map((profile) => profile.id),
        error: 'Auth user and Super Admin profile are not linked.',
      });
    }

    const { data: tutor, error: tutorError } = await admin
      .from('tutors')
      .select('id, employee_code, full_name')
      .eq('employee_code', 'TEST-001')
      .maybeSingle();
    if (tutorError || !tutor) return response.status(500).json({ stage: 'tutor_lookup', error: cleanError(tutorError) || 'Test tutor not found.' });

    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: ADMIN_EMAIL,
    });
    if (generateError || !generated?.properties?.hashed_token) {
      return response.status(500).json({ stage: 'generate_user_token', error: cleanError(generateError) || 'Unable to generate a user-scoped token.' });
    }

    const authClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
      type: 'magiclink',
      token_hash: generated.properties.hashed_token,
    });
    if (verifyError || !verified.session?.access_token) {
      return response.status(500).json({ stage: 'verify_user_token', error: cleanError(verifyError) || 'Unable to verify the user-scoped token.' });
    }

    const userClient = createClient(supabaseUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
    });

    const { data: roleData, error: roleError } = await userClient.rpc('current_role');
    if (roleError) return response.status(500).json({ stage: 'current_role', error: cleanError(roleError) });

    const { data: userReview, error: userReviewError } = await userClient
      .from('reviews')
      .insert(reviewPayload(tutor.id, authUser.id, 'RLS Diagnostic Branch'))
      .select('id')
      .single();

    if (userReview?.id) createdReviewIds.push(userReview.id);
    if (userReviewError || !userReview) {
      return response.status(500).json({
        stage: 'user_rls_review_insert',
        currentRole: roleData,
        authUserId: authUser.id,
        profileRole: evaluator.role,
        profileActive: evaluator.is_active,
        error: cleanError(userReviewError) || 'RLS insert returned no record.',
      });
    }

    return response.status(200).json({
      ok: true,
      stage: 'user_rls_review_insert_complete',
      currentRole: roleData,
      authUserId: authUser.id,
      profileRole: evaluator.role,
      profileActive: evaluator.is_active,
    });
  } catch (error) {
    return response.status(500).json({ stage: 'unexpected', error: cleanError(error) });
  } finally {
    if (createdReviewIds.length) await admin.from('reviews').delete().in('id', createdReviewIds);
  }
}
