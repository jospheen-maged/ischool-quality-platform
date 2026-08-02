# iSchool Quality Platform

Cloud-based quality evaluation, tutor review, flag management, objections, and analytics platform built with React, TypeScript, GitHub, and Supabase.

## Initial scope

- Role-based access for Super Admin, Admin/QTL, QC Evaluator, and Tutor
- Digital session evaluation form
- ELEOT scoring and compliance checks
- Yellow/Red flag history
- Tutor review portal
- Evidence-based objection workflow
- Analytics-ready PostgreSQL schema
- Audit history

## Local setup

1. Copy `.env.example` to `.env`.
2. Add the Supabase project URL and publishable key.
3. Run `npm install`.
4. Run `npm run dev`.
5. Apply the SQL migration in `supabase/migrations/0001_initial_schema.sql` to the Supabase project.

## Security

The browser uses only the Supabase publishable/anon key. Authorization is enforced with PostgreSQL Row Level Security. Never expose the Supabase service-role key in frontend code.
