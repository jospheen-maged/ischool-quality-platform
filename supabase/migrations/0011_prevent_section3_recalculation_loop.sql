-- The legacy Project score trigger from migration 0003 calls recalculate_review_total
-- whenever project_score changes. The new detailed Section 3 calculation updates the
-- derived project_score itself, so the legacy trigger must be removed to avoid recursion.

begin;

drop trigger if exists reviews_recalculate_project_score on public.reviews;

commit;
