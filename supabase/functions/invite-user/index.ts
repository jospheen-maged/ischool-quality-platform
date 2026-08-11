import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) return json(503, { error: "Account invitations are not configured yet." });

    const authorization = request.headers.get("Authorization") ?? "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return json(401, { error: "Authentication is required." });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) return json(401, { error: "Your session is invalid or expired." });

    const { data: caller, error: callerError } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (callerError || !caller || !caller.is_active) return json(403, { error: "Your account cannot manage invitations." });

    let body: Record<string, unknown>;
    try { body = await request.json(); }
    catch { return json(400, { error: "Invalid request body." }); }

    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const tutorId = body.tutorId ? String(body.tutorId).trim() : null;

    if (!fullName || !email || !role) return json(400, { error: "Full name, email, and role are required." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "Enter a valid email address." });

    const canInviteTutor = ["super_admin", "admin", "qtl"].includes(caller.role);
    const canInviteStaff = caller.role === "super_admin";
    if (role === "tutor" && !canInviteTutor) return json(403, { error: "You do not have permission to invite tutors." });
    if (role !== "tutor" && !["admin", "qtl", "qc"].includes(role)) return json(400, { error: "Choose a valid workspace role." });
    if (role !== "tutor" && !canInviteStaff) return json(403, { error: "Only the Super Admin can create staff accounts." });

    let tutor: { id: string; user_id: string | null; is_active: boolean } | null = null;
    if (role === "tutor") {
      if (!tutorId) return json(400, { error: "Select a tutor record before creating login access." });
      const { data: tutorData, error: tutorError } = await admin
        .from("tutors")
        .select("id, user_id, is_active")
        .eq("id", tutorId)
        .maybeSingle();
      if (tutorError || !tutorData) return json(404, { error: "Tutor record not found." });
      if (!tutorData.is_active) return json(400, { error: "Activate the tutor before creating login access." });
      if (tutorData.user_id) return json(409, { error: "This tutor already has a login account." });
      tutor = tutorData;
    }

    const redirectTo = "https://b2b-offline.vercel.app/set-password";
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, role, tutor_id: tutorId },
    });

    if (inviteError || !inviteData.user) {
      const message = inviteError?.message?.toLowerCase().includes("already")
        ? "An account with this email already exists."
        : inviteError?.message || "Unable to send the invitation.";
      return json(409, { error: message });
    }

    const invitedUserId = inviteData.user.id;
    const { error: profileError } = await admin.from("profiles").upsert({
      id: invitedUserId,
      full_name: fullName,
      email,
      role,
      tutor_id: tutorId,
      is_active: true,
    }, { onConflict: "id" });

    if (profileError) {
      await admin.auth.admin.deleteUser(invitedUserId);
      return json(500, { error: "The invitation was created but the profile could not be linked." });
    }

    if (role === "tutor" && tutor) {
      const { error: tutorLinkError } = await admin
        .from("tutors")
        .update({ user_id: invitedUserId, email })
        .eq("id", tutor.id)
        .is("user_id", null);
      if (tutorLinkError) {
        await admin.from("profiles").delete().eq("id", invitedUserId);
        await admin.auth.admin.deleteUser(invitedUserId);
        return json(500, { error: "The tutor account could not be linked to the tutor record." });
      }
    }

    return json(200, {
      message: role === "tutor" ? `Login invitation sent to ${email}.` : `Workspace invitation sent to ${email}.`,
      userId: invitedUserId,
    });
  } catch (error) {
    console.error("Invite user Edge Function failed", error);
    return json(500, { error: error instanceof Error ? error.message : "Unexpected server error while sending the invitation." });
  }
});
