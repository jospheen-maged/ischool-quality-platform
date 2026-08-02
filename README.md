# iSchool Quality Platform

Cloud-based quality evaluation, tutor review, compliance flag, objection, and analytics platform built with React, TypeScript, GitHub, and Supabase.

## Current MVP foundation

- Email/password authentication with Supabase Auth
- Role-aware routes for Super Admin, Admin/QTL, QC Evaluator, and Tutor
- Digital ELEOT and compliance evaluation form
- Draft and submitted review persistence
- Automatic Yellow/Red flag generation from compliance history
- Tutor-visible review list
- Tutor objection submission and status tracking
- Role-scoped dashboards and analytics views
- Private evidence storage foundation
- PostgreSQL Row Level Security and audit logging
- GitHub Actions type-check and production-build workflow

## Technology

- React 19 + TypeScript
- Vite
- React Router
- Supabase Auth, PostgreSQL, Storage, and Row Level Security
- GitHub Actions

## Local setup

1. Install Node.js 22.12 or newer.
2. Copy `.env.example` to `.env`.
3. Add the Supabase project URL and publishable key.
4. Run `npm install`.
5. Run `npm run dev`.
6. Apply `supabase/migrations/0001_initial_schema.sql` to the Supabase project.

```bash
cp .env.example .env
npm install
npm run dev
```

## Environment variables

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Never expose the Supabase service-role key in frontend code or GitHub secrets intended for Vite builds.

## Documentation

- [Supabase setup](docs/supabase-setup.md)
- [Roles and permissions](docs/roles-and-permissions.md)
- [Evaluation and objection workflow](docs/workflow.md)

## Database migration

The first migration creates the data model, evaluation template, form criteria, RLS policies, automatic flag logic, analytics views, audit logs, and private evidence bucket.

```text
supabase/migrations/0001_initial_schema.sql
```

The initial template contains 14 ELEOT rating criteria with a maximum score of 70, plus 11 iSchool compliance criteria.

## Security model

The frontend hides actions according to role, but the database is the real authorization boundary. Tutors can access only their own published review data and objections. QC users can manage their own reviews and can access objection work that does not belong to the original evaluator. Admin/QTL roles can validate reviews, manage objections, and approve flag changes.

## Next build phase

- Review detail page with strengths and developmental areas
- Admin review validation and publishing queue
- QC objection claim/decision interface
- QTL-only flag removal approval
- Evidence upload UI and signed access links
- User/tutor administration
- Automated deployment
