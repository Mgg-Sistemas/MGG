-- ============================================================
-- MGG · Retenciones · Permisos y RLS para Períodos Fiscales e Imágenes
-- Ejecutar en Supabase SQL Editor si la lectura o generación
-- de períodos o imágenes arroja error de permisos (42501).
-- Idempotente: se puede correr varias veces de forma segura.
-- ============================================================

begin;

-- 1. Permisos base de tabla
grant select, insert, update on public.retencion_periodos to authenticated;
grant all on public.retencion_periodos to service_role;

-- 2. Habilitar RLS y políticas en retencion_periodos
alter table public.retencion_periodos enable row level security;

drop policy if exists "retencion_periodos_read_auth" on public.retencion_periodos;
create policy "retencion_periodos_read_auth" on public.retencion_periodos
  for select to authenticated using (true);

drop policy if exists "retencion_periodos_write_op" on public.retencion_periodos;
create policy "retencion_periodos_write_op" on public.retencion_periodos
  for all to authenticated
  using (coalesce((select public.is_operativo()), false))
  with check (coalesce((select public.is_operativo()), false));

-- 3. Asegurar RLS y revocar anon en retencion_agente_imagenes (si existe)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'retencion_agente_imagenes'
  ) then
    alter table public.retencion_agente_imagenes enable row level security;
    revoke all on public.retencion_agente_imagenes from anon, public;
    grant select, insert, update on public.retencion_agente_imagenes to authenticated;
    grant all on public.retencion_agente_imagenes to service_role;

    drop policy if exists "retencion_agente_imagenes_read_auth" on public.retencion_agente_imagenes;
    create policy "retencion_agente_imagenes_read_auth" on public.retencion_agente_imagenes
      for select to authenticated using (true);

    drop policy if exists "retencion_agente_imagenes_write_op" on public.retencion_agente_imagenes;
    create policy "retencion_agente_imagenes_write_op" on public.retencion_agente_imagenes
      for all to authenticated
      using (coalesce((select public.is_operativo()), false))
      with check (coalesce((select public.is_operativo()), false));
  end if;
end $$;

-- 4. Permisos de ejecución en RPCs de períodos
do $$
begin
  if exists (select 1 from pg_proc where proname = 'retencion_periodos_generar') then
    grant execute on function public.retencion_periodos_generar(int) to authenticated, service_role;
  end if;
  if exists (select 1 from pg_proc where proname = 'retencion_periodo_declarar') then
    grant execute on function public.retencion_periodo_declarar to authenticated, service_role;
  end if;
  if exists (select 1 from pg_proc where proname = 'retencion_periodo_reabrir') then
    grant execute on function public.retencion_periodo_reabrir to authenticated, service_role;
  end if;
  if exists (select 1 from pg_proc where proname = 'retencion_calendario_cargar') then
    grant execute on function public.retencion_calendario_cargar to authenticated, service_role;
  end if;
end $$;

commit;
