-- Tighten account administration while preserving management visibility.
begin;

drop policy if exists "admins manage profiles" on public.profiles;

create policy "super admins manage profiles"
on public.profiles for all to authenticated
using (public.current_role() = 'super_admin')
with check (public.current_role() = 'super_admin');

commit;
