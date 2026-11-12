-- ============================================================
-- MGG · COMPRAS FIJAS (12-11-2026) · traído de Golden Touch (949cb4a8) y adaptado.
--
-- Plantillas de las compras que se repiten: cada cuánto, qué productos (por
-- categoría y/o lista fija), quién solicita, y si va por Solicitud de Pedido
-- (cotización → OC) o por Compra directa. «Generar» arma la solicitud precargada
-- con las cantidades de la última vez. Un aviso diario (pg_cron, 7:00 a. m. de
-- Venezuela) le avisa a Compras cuando a una le llegó la fecha. Solo AVISA: la
-- solicitud la genera Compras con un clic.
--
-- Diferencias con Golden Touch:
--   · Permisos con puede_modulo('pedidos', …) (MGG no tiene puede()/puede_leer()).
--   · Solo MERCADO viene activa. Carnes, Pollo y Papelería llegan como SUGERENCIA
--     (sugerida = true, pausadas): se ven en el tablero, pero no avisan ni se
--     generan hasta que Compras las configura y las guarda.
--   · El aviso evita duplicados con not exists (dedup_key no tiene índice único en MGG).
--   · Quién crea/edita lo pone la base.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================

create table if not exists public.compras_fijas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  icono text not null default '🔁',
  frecuencia text not null default 'mensual' check (frecuencia in ('semanal', 'quincenal', 'mensual', 'cada_dias')),
  cada_dias int check (cada_dias is null or cada_dias between 1 and 365),
  proxima_fecha date not null default ((now() at time zone 'America/Caracas')::date),
  activa boolean not null default true,
  -- 'solicitud' = Solicitud de Pedido (cotización → OC) · 'compra_directa' = Compra directa
  modo text not null default 'solicitud' check (modo in ('solicitud', 'compra_directa')),
  -- En compra directa, también se puede mandar a cotizar como solicitud.
  permite_cotizar boolean not null default true,
  solicitante text,
  unidad_solicitante text,
  finalidad text,
  urgente boolean not null default false,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text,
  -- Palabras de categoría: entra todo producto cuya categoría las contenga (sin tildes).
  categorias text[] not null default '{}',
  -- Productos fijos: [{producto_id, sku, nombre, unidad, cantidad}]
  productos jsonb not null default '[]'::jsonb,
  nota text,
  orden int not null default 0,
  -- Sugerencia que Compras todavía no configuró: no avisa ni se genera.
  sugerida boolean not null default false,
  ultima_ref_tipo text check (ultima_ref_tipo is null or ultima_ref_tipo in ('orden', 'compra_directa')),
  ultima_ref_id uuid,
  ultima_codigo text,
  ultima_generada_en timestamptz,
  -- Para no repetir el aviso del mismo día de compra.
  avisada_para date,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.compras_fijas add column if not exists sugerida boolean not null default false;

alter table public.ordenes add column if not exists compra_fija_id uuid references public.compras_fijas(id) on delete set null;
alter table public.compras_directas add column if not exists compra_fija_id uuid references public.compras_fijas(id) on delete set null;
create index if not exists ordenes_compra_fija_idx on public.ordenes (compra_fija_id, created_at desc) where compra_fija_id is not null;
create index if not exists compras_directas_compra_fija_idx on public.compras_directas (compra_fija_id, created_at desc) where compra_fija_id is not null;

alter table public.compras_fijas enable row level security;
drop policy if exists "compras fijas read" on public.compras_fijas;
create policy "compras fijas read" on public.compras_fijas for select to authenticated
  using ((select public.is_admin())
      or (select public.puede_modulo('pedidos', 'lectura')) or (select public.puede_modulo('pedidos', 'escritura')));
drop policy if exists "compras fijas write" on public.compras_fijas;
create policy "compras fijas write" on public.compras_fijas for all to authenticated
  using ((select public.is_admin()) or (select public.puede_modulo('pedidos', 'escritura')))
  with check ((select public.is_admin()) or (select public.puede_modulo('pedidos', 'escritura')));
grant select, insert, update, delete on public.compras_fijas to authenticated;
revoke all on public.compras_fijas from anon;

-- Quién y cuándo lo pone la base.
create or replace function public.compras_fijas_autor()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_by := lower(nullif(auth.jwt()->>'email', ''));
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := new.updated_by; new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists compras_fijas_autor on public.compras_fijas;
create trigger compras_fijas_autor before insert or update on public.compras_fijas
  for each row execute function public.compras_fijas_autor();
revoke all on function public.compras_fijas_autor() from public, anon, authenticated;

-- Aviso diario: a Compras (escritura/full en Pedidos) y admin, una vez por fecha de compra.
-- Las sugeridas y las pausadas no avisan.
create or replace function public.compras_fijas_avisar()
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy date := (now() at time zone 'America/Caracas')::date;
  r public.compras_fijas;
  v_n int := 0;
begin
  for r in select * from public.compras_fijas
            where activa and not sugerida and proxima_fecha <= v_hoy
              and avisada_para is distinct from proxima_fecha loop
    insert into public.notificaciones (destino, kind, title, message, link, dedup_key)
    select rp.role, 'info',
           r.icono || ' Toca la compra fija: ' || r.nombre,
           case when r.proxima_fecha < v_hoy
                then 'Estaba para el ' || to_char(r.proxima_fecha, 'DD/MM/YYYY') || '. Genérala desde Compras › Compras fijas.'
                else 'Es hoy. Genérala desde Compras › Compras fijas (sale con las cantidades de la última vez).' end,
           '#/app/pedidos?comprasFijas=1',
           'compra-fija-' || r.id::text || '-' || r.proxima_fecha::text || '-' || rp.role
      from public.roles_permisos rp
     where (rp.role = 'admin'
        or coalesce((rp.permisos -> 'pedidos' ->> 'escritura')::boolean, false)
        or coalesce((rp.permisos -> 'pedidos' ->> 'full')::boolean, false))
       and not exists (select 1 from public.notificaciones n
                        where n.dedup_key = 'compra-fija-' || r.id::text || '-' || r.proxima_fecha::text || '-' || rp.role);
    update public.compras_fijas set avisada_para = r.proxima_fecha where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.compras_fijas_avisar() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'compras-fijas-aviso') then
      perform cron.unschedule('compras-fijas-aviso');
    end if;
    -- 11:00 UTC = 7:00 a. m. en Venezuela.
    perform cron.schedule('compras-fijas-aviso', '0 11 * * *', 'select public.compras_fijas_avisar()');
  end if;
end $$;

-- Plantillas iniciales (solo si no existen). Mercado lista; las demás, sugerencias por configurar.
insert into public.compras_fijas (nombre, icono, frecuencia, modo, permite_cotizar, solicitante, unidad_solicitante, finalidad, urgente, categorias, orden, activa, sugerida)
select * from (values
  ('Mercado', '🛒', 'semanal', 'solicitud', true, 'COCINA', 'COCINA', 'PEDIDO PARA RESTABLECER EL MERCADO', true,
     array['viver', 'proteina', 'hortaliza', 'legumbre', 'limpieza', 'higiene'], 1, true, false),
  ('Carnes', '🥩', 'semanal', 'compra_directa', true, 'COCINA', 'COCINA', 'COMPRA FIJA DE CARNES', false,
     array['carne'], 2, false, true),
  ('Pollo', '🍗', 'semanal', 'solicitud', true, 'COCINA', 'COCINA', 'COMPRA FIJA DE POLLO', false,
     array['pollo'], 3, false, true),
  ('Papelería', '📎', 'mensual', 'solicitud', true, 'ADMINISTRACIÓN', 'ADMINISTRACIÓN', 'COMPRA FIJA DE PAPELERÍA', false,
     array['papel', 'materiales de oficina'], 4, false, true)
) as v(nombre, icono, frecuencia, modo, permite_cotizar, solicitante, unidad_solicitante, finalidad, urgente, categorias, orden, activa, sugerida)
where not exists (select 1 from public.compras_fijas c where lower(c.nombre) = lower(v.nombre));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'compras_fijas') then
    alter publication supabase_realtime add table public.compras_fijas;
  end if;
end $$;

-- Comprobación
select nombre, activa, sugerida, frecuencia, proxima_fecha,
       exists (select 1 from cron.job where jobname = 'compras-fijas-aviso') as aviso_programado
  from public.compras_fijas order by orden;
