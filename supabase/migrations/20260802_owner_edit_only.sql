-- Grind-PSD v1.7.0: owners may edit and overwrite only their own records.
-- Administrators retain read-all and delete-all capabilities, but no longer
-- receive an update bypass for measurements or measurement fractions.
-- Apply with the Supabase SQL editor or CLI using a database-owner role.

begin;

create or replace function public.guard_grind_psd_measurement_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if old.source_app = 'grind-psd' then
    if new.user_id is distinct from old.user_id
       or new.source_app is distinct from old.source_app
       or new.source_record_id is distinct from old.source_record_id then
      raise exception 'Grind-PSD hidden test identity is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists measurements_insert_owner_or_admin on public.measurements;
drop policy if exists measurements_update_owner_or_admin on public.measurements;
drop policy if exists measurements_insert_owner_only on public.measurements;
drop policy if exists measurements_update_owner_only on public.measurements;

create policy measurements_insert_owner_only
on public.measurements for insert
to authenticated
with check (user_id = auth.uid());

create policy measurements_update_owner_only
on public.measurements for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists measurement_fractions_insert_owner_or_admin on public.measurement_fractions;
drop policy if exists measurement_fractions_update_owner_or_admin on public.measurement_fractions;
drop policy if exists measurement_fractions_insert_owner_only on public.measurement_fractions;
drop policy if exists measurement_fractions_update_owner_only on public.measurement_fractions;

create policy measurement_fractions_insert_owner_only
on public.measurement_fractions for insert
to authenticated
with check (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and m.user_id = auth.uid()
  )
);

create policy measurement_fractions_update_owner_only
on public.measurement_fractions for update
to authenticated
using (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.measurements m
    where m.id = measurement_id
      and m.user_id = auth.uid()
  )
);

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
      and m.user_id = auth.uid()
  ) then
    raise exception 'Only the record owner may replace this measurement';
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

commit;
