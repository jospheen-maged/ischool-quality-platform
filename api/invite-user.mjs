import { createClient } from '@supabase/supabase-js';

const allowedRoles = new Set(['admin', 'qtl', 'qc']);
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://mxfeyumgdlmiplognpry.supabase.co';

function send(response, status, payload) {
  response.status(status).setHeader('Content-Type', 'application/json');
  response.send(JSON.stringify(payload));
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return send(response, 405, { error: 'Method not allowed.' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return send(response, 503, { error: 'Account invitations are not configured yet. Add SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.' });
  }

  const authorization = request.headers.authorization || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!accessToken) return send(response, 401, { error: 'Authentication is required.' });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) return send(response, 401, { error: 'Your session is invalid or expired.' });

  const { data: caller, error: callerError } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (callerError || caller?.role !== 'super_admin' || !caller?.is_active) {
    return send(response, 403, { error: 'Only the Super Admin can create accounts.' });
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || '');

  if (fullName.length < 2) return send(response, 400, { error: 'Enter the team member full name.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return send(response, 400, { error: 'Enter a valid email address.' });
  if (!allowedRoles.has(role)) return send(response, 400, { error: 'Choose a valid Management or QC role.' });

  const appUrl = (process.env.APP_URL || 'https://b2b-offline.vercel.app').replace(/\/$/, '');
  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${appUrl}/login`,
    data: { full_name: fullName, role },
  });

  if (inviteError) return send(response, 400, { error: inviteError.message });
  if (!inviteData.user?.id) return send(response, 500, { error: 'The invitation was sent, but the account record was not returned.' });

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: inviteData.user.id,
      full_name: fullName,
      email,
      role,
      is_active: true,
    }, { onConflict: 'id' });

  if (profileError) return send(response, 500, { error: `Invitation sent, but role assignment failed: ${profileError.message}` });

  return send(response, 200, {
    message: `${fullName} was invited as ${role === 'admin' ? 'Management' : role === 'qtl' ? 'Quality Team Lead' : 'Quality Control'}.`,
  });
}
