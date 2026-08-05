import { createClient } from '@supabase/supabase-js';

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json');

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceRoleKey) {
    response.status(503).json({ error: 'Account invitations are not configured yet.' });
    return;
  }

  const authorization = headerValue(request.headers.authorization);
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!accessToken) {
    response.status(401).json({ error: 'Authentication is required.' });
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    response.status(401).json({ error: 'Your session is invalid or expired.' });
    return;
  }

  const { data: caller, error: callerError } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (callerError || !caller || !caller.is_active) {
    response.status(403).json({ error: 'Your account cannot manage invitations.' });
    return;
  }

  let body;
  try {
    body = parseBody(request.body);
  } catch {
    response.status(400).json({ error: 'Invalid request body.' });
    return;
  }

  const fullName = body.fullName?.trim() || '';
  const email = body.email?.trim().toLowerCase() || '';
  const role = body.role;
  const tutorId = body.tutorId?.trim() || null;

  if (!fullName || !email || !role) {
    response.status(400).json({ error: 'Full name, email, and role are required.' });
    return;
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    response.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }

  const callerRole = caller.role;
  const canInviteTutor = ['super_admin', 'admin', 'qtl'].includes(callerRole);
  const canInviteStaff = callerRole === 'super_admin';

  if (role === 'tutor' && !canInviteTutor) {
    response.status(403).json({ error: 'You do not have permission to invite tutors.' });
    return;
  }

  if (role !== 'tutor' && !canInviteStaff) {
    response.status(403).json({ error: 'Only the Super Admin can create staff accounts.' });
    return;
  }

  let tutor = null;
  if (role === 'tutor') {
    if (!tutorId) {
      response.status(400).json({ error: 'Select a tutor record before creating login access.' });
      return;
    }

    const { data: tutorData, error: tutorError } = await admin
      .from('tutors')
      .select('id, full_name, email, user_id, is_active')
      .eq('id', tutorId)
      .maybeSingle();

    if (tutorError || !tutorData) {
      response.status(404).json({ error: 'Tutor record not found.' });
      return;
    }
    if (!tutorData.is_active) {
      response.status(400).json({ error: 'Activate the tutor before creating login access.' });
      return;
    }
    if (tutorData.user_id) {
      response.status(409).json({ error: 'This tutor already has a login account.' });
      return;
    }
    tutor = tutorData;
  }

  const origin = headerValue(request.headers.origin) || process.env.APP_URL || 'https://b2b-offline.vercel.app';
  const redirectTo = `${origin.replace(/\/$/, '')}/set-password`;

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      full_name: fullName,
      role,
      tutor_id: tutorId,
    },
  });

  if (inviteError || !inviteData.user) {
    const message = inviteError?.message?.toLowerCase().includes('already')
      ? 'An account with this email already exists.'
      : inviteError?.message || 'Unable to send the invitation.';
    response.status(409).json({ error: message });
    return;
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
    response.status(500).json({ error: 'The invitation was created but the profile could not be linked.' });
    return;
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
      response.status(500).json({ error: 'The tutor account could not be linked to the tutor record.' });
      return;
    }
  }

  response.status(200).json({
    message: role === 'tutor'
      ? `Login invitation sent to ${email}.`
      : `Workspace invitation sent to ${email}.`,
    userId: invitedUserId,
  });
}
