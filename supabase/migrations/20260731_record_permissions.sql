-- Grind-PSD v1.4.0: local-first permissions, immutable hidden test IDs,
-- administrator access, and atomic replacement of PSD fractions.
-- Apply with the Supabase SQL editor or CLI using a database-owner role.

begin;

create or replace function public.is_grind_psd_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'zj_crop@163.com';
$$;

revoke all on function public.is_grind_psd_admin() from public;
grant execute on function public.is_grind_psd_admin() to authenticated;

-- source_record_id is the hidden immutable test code. New clients write a
-- compact gpsd-U2E2YYMMDDS3C2 value; legacy gpsd-* values remain valid.
create unique index if not exists measurements_grind_psd_record_code_uidx
  on public.measurements (source_app, source_record_id)
  where source_app = 'grind-psd' and deleted_at is null;

create or replace function public.guard_grind_psd_measurement_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.source_app = 'grind-psd' and not public.is_grind_psd_admin() then
    if new.user_id is distinct from old.user_id
       or new.source_app is distinct from old.source_app
       or new.source_record_id is distinct from old.source_record_id then
      raise exception 'Grind-PSD hidden test identity is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_grind_psd_measurement_identity on public.measurements;
create trigger guard_grind_psd_measurement_identity
before update on public.measurements
for each row execute function public.guard_grind_psd_measurement_identity();

alter table public.measurements enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'measurements'
  loop
    execute format('drop policy if exists %I on public.measurements', p.policyname);
  end loop;
end $$;

create policy measurements_select_owner_or_admin
on public.measurements for select
to authenticated
using (user_id = auth.uid() or public.is_grind_psd_admin());

create policy measurements_insert_owner_or_admin
on public.measurements for insert
to authenticated
with check (user_id = auth.uid() or public.is_grind_psd_admin());

create policy measurements_update_owner_or_admin
on public.measurements for update
to authenticated
using (user_id = auth.uid() or public.is_grind_psd_admin())
with check (user_id = auth.uid() or public.is_grind_psd_admin());

create policy measurements_delete_admin_only
on public.measurements for delete
to authenticated
using (public.is_grind_psd_admin());

alter table public.measurement_fractions enable row level security;

do $$
declare p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'measurement_fractions'
  loop
    execute format('drop policy if exists %I on public.measurement_fractions', p.policyname);
  end loop;
end $$;

create policy measurement_fractions_select_owner_or_admin
on public.measurement_fractions for select
to authenticated
using (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and (m.user_id = auth.uid() or public.is_grind_psd_admin())
  )
);

create policy measurement_fractions_insert_owner_or_admin
on public.measurement_fractions for insert
to authenticated
with check (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and (m.user_id = auth.uid() or public.is_grind_psd_admin())
  )
);

create policy measurement_fractions_update_owner_or_admin
on public.measurement_fractions for update
to authenticated
using (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and (m.user_id = auth.uid() or public.is_grind_psd_admin())
  )
)
with check (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and (m.user_id = auth.uid() or public.is_grind_psd_admin())
  )
);

create policy measurement_fractions_delete_admin_only
on public.measurement_fractions for delete
to authenticated
using (public.is_grind_psd_admin());

create or replace function public.replace_measurement_fractions(
  p_measurement_id uuid,
  p_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1
    from public.measurements m
    where m.id = p_measurement_id
      and (m.user_id = auth.uid() or public.is_grind_psd_admin())
  ) then
    raise exception 'Not authorized to replace this measurement';
  end if;

  delete from public.measurement_fractions
  where measurement_id = p_measurement_id;

  insert into public.measurement_fractions (
    measurement_id,
    ordinal,
    label,
    lower_um,
    upper_um,
    mass_g,
    percentage,
    legacy_merged
  )
  select
    p_measurement_id,
    (row_data ->> 'ordinal')::integer,
    coalesce(row_data ->> 'label', ''),
    nullif(row_data ->> 'lower_um', '')::numeric,
    nullif(row_data ->> 'upper_um', '')::numeric,
    coalesce((row_data ->> 'mass_g')::numeric, 0),
    coalesce((row_data ->> 'percentage')::numeric, 0),
    coalesce((row_data ->> 'legacy_merged')::boolean, false)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row_data;
end;
$$;

revoke all on function public.replace_measurement_fractions(uuid, jsonb) from public;
grant execute on function public.replace_measurement_fractions(uuid, jsonb) to authenticated;

create or replace function public.admin_delete_grind_psd_record(
  p_source_record_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  affected integer;
begin
  if not public.is_grind_psd_admin() then
    raise exception 'Administrator permission required';
  end if;

  delete from public.measurements
  where source_app = 'grind-psd'
    and source_record_id = p_source_record_id;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.admin_delete_grind_psd_record(text) from public;
grant execute on function public.admin_delete_grind_psd_record(text) to authenticated;

-- Preserve existing owner policies on related tables and add a separate
-- administrator policy. Tables not present in a deployment are skipped.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'grinders', 'sieve_sets', 'app_settings',
    'sync_tombstones', 'data_schema_versions'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists grind_psd_admin_all on public.%I', table_name);
      execute format(
        'create policy grind_psd_admin_all on public.%I for all to authenticated using (public.is_grind_psd_admin()) with check (public.is_grind_psd_admin())',
        table_name
      );
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.measurements to authenticated;
grant select, insert, update on public.measurement_fractions to authenticated;

commit;
