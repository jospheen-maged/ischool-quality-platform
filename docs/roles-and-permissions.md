# Roles and permissions

## Super Admin

- Full platform configuration
- User and role management
- Tutor, team, and branch management
- Evaluation template management
- All reviews, flags, objections, analytics, and audit logs

## Admin / QTL

- View all reviews and analytics
- Validate, return, publish, reopen, and close reviews
- Manage objection assignment and decisions
- Approve flag removal or downgrade
- Manage operational tutor/team data
- View audit logs

## QC Evaluator

- View active tutors and evaluation templates
- Create and edit their own draft/submitted reviews
- See reviews they evaluated
- View unassigned objections only when they are not the original evaluator
- Claim and decide assigned objections
- Cannot publish a review or approve flag removal

## Tutor

- View only their own published reviews
- View their own visible flags and feedback
- Submit an objection to their own published review
- View their objection status and final decision
- Cannot read another tutor's review or objection

## Important implementation rules

- Authorization is enforced in PostgreSQL Row Level Security, not only by hiding frontend buttons.
- New authenticated users default to the Tutor role.
- Admin roles must be assigned by a trusted administrator.
- Browser code must use only the Supabase publishable/anon key.
- Privileged user creation and destructive administration should later be moved into Admin-only Edge Functions.
