# Supabase setup

## 1. Create the project

Create a Supabase project and keep it in the same organization that will own the production system.

## 2. Apply the migration

Use either the Supabase CLI or the SQL editor to apply:

```text
supabase/migrations/0001_initial_schema.sql
```

The migration creates:

- Authentication-linked profiles
- Tutors, teams, and branches
- Versioned evaluation templates
- ELEOT rating criteria and compliance criteria
- Reviews, scores, feedback, Yellow/Red flags, and objections
- Row Level Security policies
- Audit logs
- Analytics views
- A private `quality-evidence` storage bucket

## 3. Create the first user

In **Authentication → Users**, create the first account. The database trigger creates its profile with the `tutor` role by default.

Promote the first trusted account in the SQL editor:

```sql
update public.profiles
set role = 'super_admin'
where email = 'YOUR_ADMIN_EMAIL';
```

Do not allow users to choose their own role during sign-up.

## 4. Link tutor accounts

Create a tutor record, then link it to the authenticated user:

```sql
insert into public.tutors (user_id, employee_code, full_name, email)
select id, 'T-1000', 'Tutor Name', email
from auth.users
where email = 'TUTOR_EMAIL';

update public.profiles p
set tutor_id = t.id
from public.tutors t
where t.user_id = p.id
  and p.email = 'TUTOR_EMAIL';
```

## 5. Configure the frontend

Copy `.env.example` to `.env` and add:

```text
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only the publishable/anon key belongs in the browser. Never add a service-role key to GitHub or a Vite environment variable.

## 6. Authentication settings

For the first internal release:

- Disable unrestricted public sign-up.
- Create users through an Admin-only workflow or the Supabase Dashboard.
- Require email confirmation if invitation links are used.
- Add the deployed application URL to the allowed redirect URLs.

## 7. Evidence storage

The private bucket expects paths beginning with the uploader's user ID:

```text
<auth-user-id>/<objection-or-review-id>/<file-name>
```

The initial policy allows the uploader and quality staff to read evidence. A later phase can issue short-lived signed URLs through an Edge Function for narrower assignment-based access.
