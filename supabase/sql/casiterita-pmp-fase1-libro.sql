-- ============================================================
-- MGG · Los Pinos · Casiterita — FASE 1: Libro de promedios (PMP)  (12-11-2026)
-- Reemplaza las hojas «Cierre Promedio» del Excel de Los Pinos. El cálculo
-- (saldo global, inventario MGG, resguardo y PMP) lo hace la app recorriendo el
-- libro (src/modules/inventario/casiteritaPmp.ts).
--
-- Este archivo crea SOLO la estructura (tablas, reglas y permisos). Los datos de
-- arranque (procedencias con su % y los movimientos del Excel) son internos y
-- NO van al repositorio: están en docs/casiterita-pmp-semilla-privada.sql
-- (git-ignored). Correr primero este archivo y después la semilla.
--
-- Permisos: lee quien tiene Inventario (lectura); carga y borra quien tiene
-- Inventario (escritura) y responde por Los Pinos (o no tiene sedes asignadas).
-- El autor de cada movimiento lo pone la base. Lo sembrado del Excel no se borra.
-- Idempotente.
-- ============================================================

-- ── % de MGG por procedencia (lo demás es resguardo de los aliados) ──
create table if not exists public.casiterita_procedencias_pmp (
  clave       text primary key,
  nombre      text not null,
  pct_mgg     numeric(5,2) not null default 100 check (pct_mgg >= 0 and pct_mgg <= 100),
  -- Palabras (separadas por |) que reconocen el grupo de recepción: EL BURRO NAVIL → P-MGG11-A.
  patron      text,
  nota        text,
  activo      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by_name text
);

-- Las procedencias y su % MGG se cargan con la semilla privada (ver arriba).


-- ── El libro ──
create table if not exists public.casiterita_libro (
  id               uuid primary key default gen_random_uuid(),
  fecha            date not null,
  tipo             text not null check (tipo in ('apertura','entrada','recuperacion','exportacion','muestra','merma','ajuste','fundicion')),
  descripcion      text not null check (length(trim(descripcion)) > 0),
  -- Salidas, recuperación y ajuste (ajuste negativo = sobrante que entra).
  kg               numeric(14,3),
  -- Apertura y entrada.
  kg_global        numeric(14,3),
  kg_mgg           numeric(18,6),
  costo            numeric(18,4),
  afecta_mgg       boolean not null default true,
  procedencia      text references public.casiterita_procedencias_pmp(clave),
  pct_mgg          numeric(5,2),
  tasa             numeric(12,4),
  recepcion_numero int,
  cierre_id        uuid references public.recepcion_cierres(id) on delete set null,
  lote_id          uuid,
  colada_id        uuid references public.produccion_colada(id) on delete set null,
  origen           text not null default 'sistema' check (origen in ('excel','sistema')),
  orden            bigint generated always as identity,
  nota             text,
  actor            uuid default auth.uid(),
  actor_name       text,
  created_at       timestamptz not null default now(),
  constraint casiterita_libro_campos check (
    case
      when tipo in ('apertura','entrada') then kg_global is not null and kg_mgg is not null and costo is not null
        and kg_global > 0 and kg_mgg >= 0 and kg_mgg <= kg_global + 0.001 and costo >= 0 and kg is null
      when tipo = 'ajuste' then kg is not null and kg <> 0 and kg_global is null
      else kg is not null and kg > 0 and kg_global is null
    end
  )
);

create index if not exists casiterita_libro_fecha_idx on public.casiterita_libro (fecha, orden);
create unique index if not exists casiterita_libro_una_apertura on public.casiterita_libro ((true)) where tipo = 'apertura';
-- Un cierre de recepción entra una sola vez por procedencia.
create unique index if not exists casiterita_libro_cierre_proc on public.casiterita_libro (cierre_id, procedencia) where cierre_id is not null;

-- ── Quién escribe: Inventario (escritura) y Los Pinos entre sus sedes (o sin sedes asignadas) ──
create or replace function public.casiterita_puede_escribir()
returns boolean language sql stable security definer set search_path = public as $$
  select public.puede_modulo('inventario', 'escritura') and exists (
    select 1 from public.usuarios u
     where u.id = auth.uid() and u.estado = 'activo'
       and (u.role = 'admin' or coalesce(cardinality(u.sedes_asignadas), 0) = 0 or 'LOS PINOS' = any(u.sedes_asignadas))
  );
$$;

-- ── Reglas que no dependen de la pantalla ──
create or replace function public.casiterita_libro_guardia()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_apertura date;
  v_neto numeric;
  v_almacen text;
begin
  if tg_op = 'DELETE' then
    if old.origen = 'excel' then
      raise exception 'Los movimientos traídos del Excel no se borran.';
    end if;
    if old.tipo = 'apertura' then
      raise exception 'El saldo inicial no se borra.';
    end if;
    -- Lo de un lote o una colada se borra desde su lote / colada (que avisa la marca).
    if (old.lote_id is not null or old.colada_id is not null)
       and coalesce(current_setting('mgg.casiterita_desde_lote', true), '') <> 'si' then
      raise exception 'Este movimiento es de un lote o de una colada: se deshace desde ahí.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    -- Nadie edita (no hay política de UPDATE); solo se deja pasar que una llave
    -- foránea suelte su vínculo (on delete set null) sin tocar nada más.
    if row(new.fecha, new.tipo, new.descripcion, new.kg, new.kg_global, new.kg_mgg, new.costo, new.afecta_mgg, new.procedencia, new.origen)
         is not distinct from row(old.fecha, old.tipo, old.descripcion, old.kg, old.kg_global, old.kg_mgg, old.costo, old.afecta_mgg, old.procedencia, old.origen)
       and (new.cierre_id is null or new.cierre_id = old.cierre_id)
       and (new.colada_id is null or new.colada_id = old.colada_id)
       and (new.lote_id is null or new.lote_id = old.lote_id) then
      return new;
    end if;
    raise exception 'Un movimiento del libro no se edita: bórralo y cárgalo de nuevo.';
  end if;

  -- INSERT
  if new.origen = 'excel' and coalesce(current_setting('mgg.casiterita_semilla', true), '') <> 'si' then
    raise exception 'Solo la carga inicial marca movimientos como del Excel.';
  end if;
  -- Los vínculos no los pone el cliente a su gusto:
  -- · lote / colada: solo el flujo del lote (función del servidor que marca la transacción);
  -- · cierre de recepción: solo una entrada con los mismos kg que ese cierre metió al almacén de casiterita.
  if (new.lote_id is not null or new.colada_id is not null)
     and coalesce(current_setting('mgg.casiterita_desde_lote', true), '') <> 'si' then
    raise exception 'Los movimientos de un lote o de una colada los crea su propio flujo.';
  end if;
  if new.cierre_id is not null then
    if new.tipo <> 'entrada' then
      raise exception 'Solo una entrada puede venir de un cierre de recepción.';
    end if;
    select neto_seco, almacen_neto into v_neto, v_almacen from public.recepcion_cierres where id = new.cierre_id;
    if not found or coalesce(v_almacen, '') not ilike '%CASITERITA%' or abs(coalesce(v_neto, 0) - new.kg_global) > 0.001 then
      raise exception 'La entrada no coincide con lo que ese cierre de recepción metió al almacén de casiterita.';
    end if;
  end if;
  select fecha into v_apertura from public.casiterita_libro where tipo = 'apertura';
  if new.tipo <> 'apertura' and v_apertura is not null and new.fecha < v_apertura then
    raise exception 'El libro abre el %: no se cargan movimientos anteriores.', to_char(v_apertura, 'DD-MM-YYYY');
  end if;
  -- El autor lo pone la base (no se acepta el que mande el cliente), salvo la carga inicial.
  if new.origen <> 'excel' then
    new.actor := auth.uid();
    select coalesce(nullif(trim(concat_ws(' ', nombre, apellido)), ''), email) into new.actor_name from public.usuarios where id = auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;

create or replace function public.casiterita_libro_saldo_ok()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_global numeric;
begin
  select coalesce(sum(case
           when tipo in ('apertura','entrada') then kg_global
           when tipo = 'recuperacion' then kg
           else -kg end), 0)
    into v_global from public.casiterita_libro;
  if v_global < -0.001 then
    raise exception 'El saldo global quedaría en % kg: no hay tanto en Los Pinos.', round(v_global, 2);
  end if;
  return null;
end $$;

drop trigger if exists casiterita_libro_guardia on public.casiterita_libro;
create trigger casiterita_libro_guardia before insert or update or delete on public.casiterita_libro
  for each row execute function public.casiterita_libro_guardia();
drop trigger if exists casiterita_libro_saldo_ok on public.casiterita_libro;
create trigger casiterita_libro_saldo_ok after insert or delete on public.casiterita_libro
  for each statement execute function public.casiterita_libro_saldo_ok();

create or replace function public.casiterita_proc_autor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  select coalesce(nullif(trim(concat_ws(' ', nombre, apellido)), ''), email) into new.updated_by_name from public.usuarios where id = auth.uid();
  return new;
end $$;
drop trigger if exists casiterita_proc_autor on public.casiterita_procedencias_pmp;
create trigger casiterita_proc_autor before insert or update on public.casiterita_procedencias_pmp
  for each row execute function public.casiterita_proc_autor();

-- ── Seguridad ──
alter table public.casiterita_procedencias_pmp enable row level security;
alter table public.casiterita_libro enable row level security;

drop policy if exists "casi pmp proc read" on public.casiterita_procedencias_pmp;
create policy "casi pmp proc read" on public.casiterita_procedencias_pmp for select
  using ((select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casi pmp proc write" on public.casiterita_procedencias_pmp;
create policy "casi pmp proc write" on public.casiterita_procedencias_pmp for update
  using ((select public.casiterita_puede_escribir()))
  with check ((select public.casiterita_puede_escribir()));
drop policy if exists "casi pmp proc insert" on public.casiterita_procedencias_pmp;
create policy "casi pmp proc insert" on public.casiterita_procedencias_pmp for insert
  with check ((select public.casiterita_puede_escribir()));

drop policy if exists "casi libro read" on public.casiterita_libro;
create policy "casi libro read" on public.casiterita_libro for select
  using ((select public.puede_modulo('inventario', 'lectura')));
drop policy if exists "casi libro insert" on public.casiterita_libro;
create policy "casi libro insert" on public.casiterita_libro for insert
  with check ((select public.casiterita_puede_escribir()));
drop policy if exists "casi libro delete" on public.casiterita_libro;
create policy "casi libro delete" on public.casiterita_libro for delete
  using ((select public.casiterita_puede_escribir()));

grant select, insert, delete on public.casiterita_libro to authenticated;
grant select, insert, update on public.casiterita_procedencias_pmp to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.casiterita_libro; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.casiterita_procedencias_pmp; exception when duplicate_object then null; end;
end $$;

