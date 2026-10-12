/* ============================================================
   MGG · Choferes / Conductores · Módulo nuevo — 12/10/2026

   El conductor ES una ficha de RRHH (`personal`): acá se le agrega el
   expediente de manejo (licencia, certificado médico, seguro) y todo lo que
   pasa en la ruta. Los descansos NO tienen tabla propia: son los mismos
   `rrhh_descansos` de RRHH (una sola verdad), con su propio tope y sus
   selecciones guardadas bajo la clave 'MGG·choferes' en las tablas de
   configuración y grupos (que ya aceptan cualquier texto como clave).

   La flota reutiliza `vehiculos_catalogo` (de Asignaciones): se le agregan
   estado operativo, vencimiento del seguro y capacidad, y se siembran los
   vehículos que ya estaban en el catálogo de Salidas.

   Tablas nuevas:
     choferes_conductores → expediente del conductor (1 por ficha de personal)
     choferes_viajes      → orden de ruta (VJ-AAAA-NNNN), paradas, estados
     choferes_viaticos    → anticipos, gastos en ruta y devoluciones
     choferes_pagos       → recibo de viaje (RV-AAAA-NNNN)
   ============================================================ */
begin;

-- ───────────── Flota: columnas nuevas en el catálogo de vehículos ─────────────
alter table public.vehiculos_catalogo add column if not exists estado_flota text not null default 'operativo';
alter table public.vehiculos_catalogo add column if not exists seguro_vence date;
alter table public.vehiculos_catalogo add column if not exists capacidad text;
alter table public.vehiculos_catalogo drop constraint if exists vehiculos_catalogo_estado_flota_check;
alter table public.vehiculos_catalogo add constraint vehiculos_catalogo_estado_flota_check
  check (estado_flota in ('operativo', 'taller', 'inactivo'));

-- Los vehículos del catálogo de Salidas pasan a la flota (una sola vez, por placa limpia).
insert into public.vehiculos_catalogo (placa, tipo, marca, modelo, notas, activo, creado_por)
select distinct on (p.placa_limpia)
       p.placa_limpia,
       case when p.nombre ilike '%chuto%' or p.nombre ilike '%trakker%' then 'chuto'
            when p.nombre ilike '%camion%' or p.nombre ilike '%camión%' then 'camion'
            when p.nombre ilike '%camioneta%' then 'camioneta'
            when p.nombre ilike '%van%' then 'bus'
            when p.nombre ilike '%pitman%' or p.nombre ilike '%astra%' then 'maquinaria'
            else 'otro' end,
       nullif(split_part(p.nombre, ' ', 1), ''),
       p.nombre,
       'Importado del catálogo de Salidas el 12-10-2026 (placa original: ' || p.placa_original || ')',
       true,
       'mineralgroupguayanaca@gmail.com'
from (
  select v.nombre,
         coalesce(v.placa, '') as placa_original,
         upper(regexp_replace(split_part(regexp_replace(coalesce(v.placa, ''), '^\s*PLACA:\s*', '', 'i'), '/', 1), '[^A-Za-z0-9]', '', 'g')) as placa_limpia
    from public.salidas_vehiculos v
   where v.activo
) p
where p.placa_limpia <> ''
  and not exists (select 1 from public.vehiculos_catalogo c where upper(btrim(c.placa)) = p.placa_limpia)
order by p.placa_limpia, p.nombre desc;

-- ───────────── Expediente del conductor ─────────────
create table if not exists public.choferes_conductores (
  id                        uuid primary key default gen_random_uuid(),
  personal_id               uuid not null unique references public.personal(id) on delete cascade,
  licencia_grado            text,
  licencia_numero           text,
  licencia_vence            date,
  certificado_medico_vence  date,
  seguro_vence              date,
  tarifa_viaje_usd          numeric not null default 0 check (tarifa_viaje_usd >= 0),
  observaciones             text,
  activo                    boolean not null default true,
  created_by                text,
  actor_name                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz
);
comment on table public.choferes_conductores is 'Choferes / Conductores · expediente de manejo de una ficha de personal (licencia, certificado médico, seguro, tarifa por viaje).';

-- ───────────── Órdenes de ruta / viajes ─────────────
create table if not exists public.choferes_viajes (
  id                      uuid primary key default gen_random_uuid(),
  numero                  text unique,
  chofer_id               uuid not null references public.choferes_conductores(id) on delete restrict,
  vehiculo_id             uuid references public.vehiculos_catalogo(id) on delete set null,
  origen                  text not null,
  destino                 text not null,
  paradas                 jsonb not null default '[]'::jsonb,
  carga                   text,
  fecha_salida            timestamptz not null,
  llegada_prevista        timestamptz,
  salida_real_at          timestamptz,
  llegada_real_at         timestamptz,
  km_salida               numeric,
  km_llegada              numeric,
  estado                  text not null default 'programado' check (estado in ('programado', 'en_ruta', 'finalizado', 'cancelado')),
  tarifa_usd              numeric not null default 0 check (tarifa_usd >= 0),
  nota                    text,
  liquidado_at            timestamptz,
  liquidado_por           text,
  liquidacion             jsonb,
  pago_id                 uuid,
  created_by              text,
  actor_name              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz,
  constraint choferes_viajes_km_ok check (km_llegada is null or km_salida is null or km_llegada >= km_salida)
);
create index if not exists idx_choferes_viajes_chofer on public.choferes_viajes(chofer_id, fecha_salida desc);
create index if not exists idx_choferes_viajes_estado on public.choferes_viajes(estado);
create index if not exists idx_choferes_viajes_fecha on public.choferes_viajes(fecha_salida desc);
-- Un chofer (y un vehículo) no pueden estar en dos rutas a la vez.
create unique index if not exists choferes_viajes_chofer_en_ruta on public.choferes_viajes(chofer_id) where estado = 'en_ruta';
create unique index if not exists choferes_viajes_vehiculo_en_ruta on public.choferes_viajes(vehiculo_id) where estado = 'en_ruta' and vehiculo_id is not null;
comment on table public.choferes_viajes is 'Choferes / Conductores · orden de ruta: chofer, vehículo, origen, destino, paradas, estados y liquidación de viáticos.';

-- ───────────── Viáticos y caja chica ─────────────
create table if not exists public.choferes_viaticos (
  id              uuid primary key default gen_random_uuid(),
  chofer_id       uuid not null references public.choferes_conductores(id) on delete restrict,
  viaje_id        uuid references public.choferes_viajes(id) on delete set null,
  tipo            text not null check (tipo in ('anticipo', 'gasto', 'devolucion')),
  concepto        text not null,
  monto_usd       numeric not null check (monto_usd > 0),
  moneda          text not null default 'USD' check (moneda in ('USD', 'Bs')),
  monto_moneda    numeric,
  tasa            numeric,
  fecha           date not null default current_date,
  comprobante     text,
  nota            text,
  movimiento_caja_id uuid,
  created_by      text,
  actor_name      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_choferes_viaticos_chofer on public.choferes_viaticos(chofer_id, fecha desc);
create index if not exists idx_choferes_viaticos_viaje on public.choferes_viaticos(viaje_id);
comment on table public.choferes_viaticos is 'Choferes / Conductores · anticipos de viáticos, gastos reales en ruta y devoluciones, en USD (con moneda y tasa si se pagó en Bs).';

-- ───────────── Pagos por viaje (recibo de viaje) ─────────────
create table if not exists public.choferes_pagos (
  id               uuid primary key default gen_random_uuid(),
  numero           text unique,
  chofer_id        uuid not null references public.choferes_conductores(id) on delete restrict,
  detalle          jsonb not null default '[]'::jsonb,
  tarifas_usd      numeric not null default 0,
  reembolsos_usd   numeric not null default 0,
  deducciones_usd  numeric not null default 0,
  bonos_usd        numeric not null default 0,
  otras_deducciones_usd numeric not null default 0,
  otras_deducciones_motivo text,
  neto_usd         numeric not null default 0,
  tasa             numeric,
  neto_bs          numeric,
  estado           text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'anulado')),
  pagado_at        timestamptz,
  pagado_por       text,
  metodo           text,
  movimiento_caja_id uuid,
  nota             text,
  created_by       text,
  actor_name       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);
create index if not exists idx_choferes_pagos_chofer on public.choferes_pagos(chofer_id, created_at desc);
create index if not exists idx_choferes_pagos_estado on public.choferes_pagos(estado);
comment on table public.choferes_pagos is 'Choferes / Conductores · recibo de viaje: tarifas de los viajes, reembolsos y deducciones de la liquidación de viáticos, neto en $ y Bs.';

alter table public.choferes_viajes drop constraint if exists choferes_viajes_pago_fkey;
alter table public.choferes_viajes add constraint choferes_viajes_pago_fkey
  foreign key (pago_id) references public.choferes_pagos(id) on delete set null;

-- ───────────── Correlativos (con candado: dos cargas a la vez no repiten número) ─────────────
create or replace function public.choferes_numero_viaje()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_anio text; v_n int;
begin
  if new.numero is null or btrim(new.numero) = '' then
    perform pg_advisory_xact_lock(hashtext('choferes_viajes_numero'));
    v_anio := to_char(coalesce(new.fecha_salida, now()) at time zone 'America/Caracas', 'YYYY');
    select coalesce(max(substring(numero from '(\d+)$')::int), 0) + 1 into v_n
      from public.choferes_viajes where numero like 'VJ-' || v_anio || '-%';
    new.numero := 'VJ-' || v_anio || '-' || lpad(v_n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_choferes_numero_viaje on public.choferes_viajes;
create trigger trg_choferes_numero_viaje before insert on public.choferes_viajes
  for each row execute function public.choferes_numero_viaje();

create or replace function public.choferes_numero_pago()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_anio text; v_n int;
begin
  if new.numero is null or btrim(new.numero) = '' then
    perform pg_advisory_xact_lock(hashtext('choferes_pagos_numero'));
    v_anio := to_char(now() at time zone 'America/Caracas', 'YYYY');
    select coalesce(max(substring(numero from '(\d+)$')::int), 0) + 1 into v_n
      from public.choferes_pagos where numero like 'RV-' || v_anio || '-%';
    new.numero := 'RV-' || v_anio || '-' || lpad(v_n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_choferes_numero_pago on public.choferes_pagos;
create trigger trg_choferes_numero_pago before insert on public.choferes_pagos
  for each row execute function public.choferes_numero_pago();

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['choferes_conductores', 'choferes_viajes', 'choferes_pagos'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ───────────── Crear el recibo de viaje y marcar sus viajes (una transacción) ─────────────
create or replace function public.choferes_pago_crear(p_pago jsonb, p_viaje_ids uuid[])
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_n int;
begin
  if not public.is_staff() then
    raise exception 'No tienes permiso para registrar pagos de viaje.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.choferes_pagos (
    chofer_id, detalle, tarifas_usd, reembolsos_usd, deducciones_usd, bonos_usd,
    otras_deducciones_usd, otras_deducciones_motivo, neto_usd, tasa, neto_bs, nota, created_by, actor_name
  ) values (
    (p_pago->>'chofer_id')::uuid,
    coalesce(p_pago->'detalle', '[]'::jsonb),
    coalesce((p_pago->>'tarifas_usd')::numeric, 0),
    coalesce((p_pago->>'reembolsos_usd')::numeric, 0),
    coalesce((p_pago->>'deducciones_usd')::numeric, 0),
    coalesce((p_pago->>'bonos_usd')::numeric, 0),
    coalesce((p_pago->>'otras_deducciones_usd')::numeric, 0),
    p_pago->>'otras_deducciones_motivo',
    coalesce((p_pago->>'neto_usd')::numeric, 0),
    (p_pago->>'tasa')::numeric,
    (p_pago->>'neto_bs')::numeric,
    p_pago->>'nota',
    p_pago->>'created_by',
    p_pago->>'actor_name'
  ) returning id into v_id;

  update public.choferes_viajes
     set pago_id = v_id
   where id = any(p_viaje_ids)
     and pago_id is null
     and estado = 'finalizado'
     and chofer_id = (p_pago->>'chofer_id')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> coalesce(array_length(p_viaje_ids, 1), 0) then
    raise exception 'Alguno de los viajes ya tiene recibo, no está finalizado o es de otro chofer. Revisa la lista.';
  end if;
  return v_id;
end $$;
revoke all on function public.choferes_pago_crear(jsonb, uuid[]) from public, anon;
grant execute on function public.choferes_pago_crear(jsonb, uuid[]) to authenticated;

-- Anular un recibo libera sus viajes (nunca se borra: el correlativo queda completo).
create or replace function public.choferes_pago_anular(p_id uuid, p_actor text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_staff() then
    raise exception 'No tienes permiso para anular pagos de viaje.' using errcode = 'insufficient_privilege';
  end if;
  update public.choferes_pagos set estado = 'anulado', nota = concat_ws(' · ', nota, 'Anulado por ' || coalesce(p_actor, 'sistema'))
   where id = p_id and estado <> 'anulado';
  update public.choferes_viajes set pago_id = null where pago_id = p_id;
end $$;
revoke all on function public.choferes_pago_anular(uuid, text) from public, anon;
grant execute on function public.choferes_pago_anular(uuid, text) to authenticated;

-- ───────────── RLS + realtime ─────────────
do $$
declare t text;
begin
  foreach t in array array['choferes_conductores', 'choferes_viajes', 'choferes_viaticos', 'choferes_pagos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || ' read auth', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)', t || ' read auth', t);
    execute format('drop policy if exists %I on public.%I', t || ' write op', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using ((select public.is_staff())) with check ((select public.is_staff()))$p$, t || ' write op', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- Cotejo
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename like 'choferes_%' order by 1;
