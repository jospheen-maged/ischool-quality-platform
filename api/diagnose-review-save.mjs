import { createClient } from '@supabase/supabase-js';

const FALLBACK_URL = 'https://mxfeyumgdlmiplognpry.supabase.co';
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

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json');
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed.' });
  if (request.query?.key !== DIAGNOSTIC_KEY) return response.status(404).json({ error: 'Not found.' });

  const configuredUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseUrl = validUrl(configuredUrl) ? String(configuredUrl).trim() : FALLBACK_URL;
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceRoleKey) return response.status(503).json({ stage: 'configuration', error: 'Missing service role key.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let reviewId = null;
  try {
    const [{ data: profileRows, error: profileRowsError }, { data: authUsersData, error: authUsersError }] = await Promise.all([
      admin.from('profiles').select('id, email, role, is_active').eq('email', ADMIN_EMAIL),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (profileRowsError) return response.status(500).json({ stage: 'profile_lookup', error: cleanError(profileRowsError) });
    if (authUsersError) return response.status(500).json({ stage: 'auth_lookup', error: cleanError(authUsersError) });

    const authMatches = (authUsersData?.users || [])
      .filter((user) => user.email?.toLowerCase() === ADMIN_EMAIL)
      .map((user) => ({ id: user.id, email: user.email, confirmedAt: user.confirmed_at || null }));
    const profileMatches = (profileRows || []).map((profile) => ({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      isActive: profile.is_active,
    }));

    const evaluator = profileRows?.[0] || null;
    if (!evaluator) return response.status(500).json({ stage: 'evaluator_lookup', authMatches, profileMatches, error: 'Evaluator not found.' });

    const { data: tutor, error: tutorError } = await admin
      .from('tutors')
      .select('id, employee_code, full_name')
      .eq('employee_code', 'TEST-001')
      .maybeSingle();
    if (tutorError || !tutor) return response.status(500).json({ stage: 'tutor_lookup', authMatches, profileMatches, error: cleanError(tutorError) || 'Test tutor not found.' });

    const { data: existingReviews, error: existingError } = await admin
      .from('reviews')
      .select('id, status, school_branch, created_at')
      .eq('tutor_id', tutor.id)
      .order('created_at', { ascending: false })
      .limit(5);
    if (existingError) return response.status(500).json({ stage: 'existing_review_lookup', authMatches, profileMatches, error: cleanError(existingError) });

    const existing = [];
    for (const item of existingReviews || []) {
      const [{ count: scoreCount }, { count: feedbackCount }] = await Promise.all([
        admin.from('review_scores').select('*', { count: 'exact', head: true }).eq('review_id', item.id),
        admin.from('review_feedback').select('*', { count: 'exact', head: true }).eq('review_id', item.id),
      ]);
      existing.push({
        id: item.id,
        status: item.status,
        schoolBranch: item.school_branch,
        createdAt: item.created_at,
        scoreCount: scoreCount || 0,
        feedbackCount: feedbackCount || 0,
      });
    }

    const { data: criteria, error: criteriaError } = await admin
      .from('evaluation_criteria')
      .select('id, criterion_type')
      .eq('is_active', true);
    if (criteriaError || !criteria?.length) return response.status(500).json({ stage: 'criteria_lookup', authMatches, profileMatches, existing, error: cleanError(criteriaError) || 'No criteria found.' });

    const { data: review, error: reviewError } = await admin
      .from('reviews')
      .insert({
        tutor_id: tutor.id,
        evaluator_id: evaluator.id,
        session_date: '2026-08-05',
        school_branch: 'Diagnostic Branch',
        session_type: 'group',
        students_present: 1,
        age_level: 'Diagnostic',
        observation_scope: 'full_session',
        intended_learning_outcome: 'Temporary diagnostic review. This record is deleted immediately.',
        learning_outcome_status: 'partially_achieved',
        follow_up_status: 'none',
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (reviewError || !review) return response.status(500).json({ stage: 'review_insert', authMatches, profileMatches, existing, error: cleanError(reviewError) || 'Review insert returned no record.' });
    reviewId = review.id;

    const scoreRows = criteria.map((criterion) => criterion.criterion_type === 'rating'
      ? {
          review_id: review.id,
          criterion_id: criterion.id,
          numeric_score: 4,
          is_observed: true,
          compliance_result: null,
          is_applicable: null,
          is_external: false,
          timestamp_seconds: null,
          evidence: 'Temporary diagnostic evidence.',
        }
      : {
          review_id: review.id,
          criterion_id: criterion.id,
          numeric_score: null,
          is_observed: true,
          compliance_result: 'clear',
          is_applicable: true,
          is_external: false,
          timestamp_seconds: null,
          evidence: 'Temporary diagnostic evidence.',
        });

    const { error: scoresError } = await admin.from('review_scores').insert(scoreRows);
    if (scoresError) return response.status(500).json({ stage: 'score_insert', authMatches, profileMatches, existing, reviewId, error: cleanError(scoresError) });

    const { error: feedbackError } = await admin.from('review_feedback').insert({
      review_id: review.id,
      observed_strength: 'Temporary diagnostic strength.',
      development_priority: 'Temporary diagnostic priority.',
      required_action: 'Temporary diagnostic action.',
    });
    if (feedbackError) return response.status(500).json({ stage: 'feedback_insert', authMatches, profileMatches, existing, reviewId, error: cleanError(feedbackError) });

    return response.status(200).json({ ok: true, stage: 'complete', authMatches, profileMatches, existing, criteriaCount: criteria.length });
  } catch (error) {
    return response.status(500).json({ stage: 'unexpected', reviewId, error: cleanError(error) });
  } finally {
    if (reviewId) await admin.from('reviews').delete().eq('id', reviewId);
  }
}
