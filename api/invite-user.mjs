import { createClient } from '@supabase/supabase-js';

const FALLBACK_SUPABASE_URL = 'https://mxfeyumgdlmiplognpry.supabase.co';

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  response.send(JSON.stringify(payload));
}

function validHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function resolveSupabaseUrl() {
  const candidates = [process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL, FALLBACK_SUPABASE_URL];
  const valid = candidates.find((candidate) => validHttpUrl(candidate));
  return String(valid || FALLBACK_SUPABASE_URL).trim();
}

export default async function handler(request, response) {
  try {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return send(response, 405, { error: 'Method not allowed.' });
    }

    const supabaseUrl = resolveSupabaseUrl();
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!serviceRoleKey) {
      return send(response, 503, { error: 'Account invitations are not configured yet.' });
    }

    const authorization = headerValue(request.headers.authorization);
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!accessToken) return send(response, 401, { error: 'Authentication is required.' });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return send(response, 401, { error: 'Your session is invalid or expired.' });
    }

    const { data: caller, error: callerError } = await admin
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (callerError || !caller || !caller.is_active) {
      return send(response, 403, { error: 'Your account cannot manage invitations.' });
    }

    let body;
    try {
      body = parseBody(request.body);
    } catch {
      return send(response, 400, { error: 'Invalid request body.' });
    }

    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const role = String(body.role || '');
    const tutorId = body.tutorId ? String(body.tutorId).trim() : null;

    if (!fullName || !email || !role) {
      return send(response, 400, { error: 'Full name, email, and role are required.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return send(response, 400, { error: 'Enter a valid email address.' });
    }

    const canInviteTutor = ['super_admin', 'admin', 'qtl'].includes(caller.role);
    const canInviteStaff = caller.role === 'super_admin';

    if (role === 'tutor' && !canInviteTutor) {
      return send(response, 403, { error: 'You do not have permission to invite tutors.' });
    }
    if (role !== 'tutor' && !['admin', 'qtl', 'qc'].includes(role)) {
      return send(response, 400, { error: 'Choose a valid workspace role.' });
    }
    if (role !== 'tutor' && !canInviteStaff) {
      return send(response, 403, { error: 'Only the Super Admin can create staff accounts.' });
    }

    let tutor = null;
    if (role === 'tutor') {
      if (!tutorId) return send(response, 400, { error: 'Select a tutor record before creating login access.' });

      const { data: tutorData, error: tutorError } = await admin
        .from('tutors')
        .select('id, full_name, email, user_id, is_active')
        .eq('id', tutorId)
        .maybeSingle();

      if (tutorError || !tutorData) return send(response, 404, { error: 'Tutor record not found.' });
      if (!tutorData.is_active) return send(response, 400, { error: 'Activate the tutor before creating login access.' });
      if (tutorData.user_id) return send(response, 409, { error: 'This tutor already has a login account.' });
      tutor = tutorData;
    }

    const requestOrigin = headerValue(request.headers.origin);
    const configuredAppUrl = String(process.env.APP_URL || '').trim();
    const origin = validHttpUrl(requestOrigin)
      ? requestOrigin
      : validHttpUrl(configuredAppUrl)
        ? configuredAppUrl
        : 'https://b2b-offline.vercel.app';
    const redirectTo = `${origin.replace(/\/$/, '')}/set-password`;

    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, role, tutor_id: tutorId },
    });

    if (inviteError || !inviteData.user) {
      const message = inviteError?.message?.toLowerCase().includes('already')
        ? 'An account with this email already exists.'
        : inviteError?.message || 'Unable to send the invitation.';
      return send(response, 409, { error: message });
    }

    const invitedUserId = inviteData.user.id;
    const { error: profileError } = await admin.from('profiles').upsert({
      id: invitedUserId,
      full_name: fullName,
      email,
      role,
      tutor_id: tutorId,
      is_active: true,
    }, { onConflict: 'id' });

    if (profileError) {
      await admin.auth.admin.deleteUser(invitedUserId);
      return send(response, 500, { error: 'The invitation was created but the profile could not be linked.' });
    }

    if (role === 'tutor' && tutor) {
      const { error: tutorLinkError } = await admin
        .from('tutors')
        .update({ user_id: invitedUserId, email })
        .eq('id', tutor.id)
        .is('user_id', null);

      if (tutorLinkError) {
        await admin.from('profiles').delete().eq('id', invitedUserId);
        await admin.auth.admin.deleteUser(invitedUserId);
        return send(response, 500, { error: 'The tutor account could not be linked to the tutor record.' });
      }
    }

    return send(response, 200, {
      message: role === 'tutor'
        ? `Login invitation sent to ${email}.`
        : `Workspace invitation sent to ${email}.`,
      userId: invitedUserId,
    });
  } catch (error) {
    console.error('Invite user API failed', error);
    return send(response, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error while sending the invitation.',
    });
  }
}
