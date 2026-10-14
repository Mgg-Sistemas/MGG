-- ============================================================
-- MGG · Proveedores · Actividad económica (código CIIU del SENIAT) (14-10-2026)
-- Catálogo `actividades_economicas` semillado con las secciones CIIU y los
-- códigos que pasó la administradora; se pueden agregar más desde el propio
-- desplegable (cotización o ficha del proveedor). El proveedor guarda el código
-- en `proveedores.actividad_economica`. Idempotente. No borra nada.
-- ============================================================

create table if not exists public.actividades_economicas (
  codigo      text primary key check (codigo ~ '^[0-9]{4}(-[0-9]{4})?$'),
  descripcion text not null check (length(btrim(descripcion)) >= 3),
  activa      boolean not null default true,
  actor       text,
  actor_name  text,
  created_at  timestamptz not null default now()
);
alter table public.actividades_economicas enable row level security;
revoke all on public.actividades_economicas from anon;
drop policy if exists "actividades read auth" on public.actividades_economicas;
create policy "actividades read auth" on public.actividades_economicas for select using ((select auth.role()) = 'authenticated');
drop policy if exists "actividades write modulo" on public.actividades_economicas;
create policy "actividades write modulo" on public.actividades_economicas for all
  using ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura')))
  with check ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura')));
grant select, insert, update on public.actividades_economicas to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='actividades_economicas') then
    alter publication supabase_realtime add table public.actividades_economicas; end if;
end $$;

-- Secciones CIIU (rangos) + códigos puntuales.
insert into public.actividades_economicas (codigo, descripcion) values
  ('0100-0299', 'Agricultura, Ganadería, Caza y Silvicultura'),
  ('0500-0599', 'Pesca y Acuicultura'),
  ('1000-1499', 'Explotación de Minas y Canteras (Petróleo, Carbón, Hierro)'),
  ('1500-3799', 'Industrias Manufactureras (Alimentos, Bebidas, Químicos, Textiles)'),
  ('4000-4199', 'Suministros de Electricidad, Gas y Agua'),
  ('4500-4599', 'Construcción (Edificaciones e infraestructura civil)'),
  ('5000-5299', 'Comercio al por Mayor y al por Menor; Reparación de Vehículos'),
  ('5500-5599', 'Hoteles y Restaurantes (Alojamiento y Expendio de comidas)'),
  ('6000-6499', 'Transporte, Almacenamiento y Comunicaciones'),
  ('6500-6799', 'Intermediación Financiera y Seguros'),
  ('7000-7499', 'Actividades Inmobiliarias, Empresariales y de Alquiler (Servicios jurídicos, contables, software)'),
  ('7500-7599', 'Administración Pública y Defensa; Afiliación Obligatoria'),
  ('8000-8099', 'Educación (Privada y pública)'),
  ('8500-8599', 'Servicios Sociales y de Salud (Clínicas, laboratorios, veterinarias)'),
  ('9000-9399', 'Otras Actividades de Servicios Comunitarios, Sociales y Personales (Desechos, peluquerías)'),
  ('9500-9599', 'Hogares Privados con Servicio Doméstico'),
  ('9900-9999', 'Organizaciones y Órganos Extraterritoriales'),
  ('5110', 'Comercio al por mayor a cambio de una retribución o por contrata'),
  ('5122', 'Comercio al por mayor de alimentos, bebidas y tabaco'),
  ('5141', 'Comercio al por mayor de combustibles sólidos, líquidos y gaseosos'),
  ('5211', 'Comercio al por menor en comercios no especializados (Supermercados/Abastos)'),
  ('5231', 'Comercio al por menor de productos farmacéuticos y médicos'),
  ('5239', 'Comercio al por menor de otros productos en almacenes especializados (Hardware, tecnología)'),
  ('7220', 'Consultores en programas de informática y suministro de programas de informática (Desarrollo de Software)'),
  ('7411', 'Actividades jurídicas (Servicios de abogados)'),
  ('7412', 'Actividades de contabilidad, teneduría de libros y auditoría; asesoramiento fiscal'),
  ('7414', 'Actividades de asesoramiento empresarial y en materia de gestión'),
  ('7494', 'Actividades de fotografía')
on conflict (codigo) do nothing;

-- El proveedor guarda el código.
alter table public.proveedores add column if not exists actividad_economica text references public.actividades_economicas(codigo) on update cascade;
create index if not exists proveedores_actividad_idx on public.proveedores (actividad_economica);

-- Desde la cotización (módulo Pedidos) se puede fijar la actividad del proveedor
-- aunque no se tenga el módulo Proveedores: es el único dato que se toca.
create or replace function public.proveedor_fijar_actividad(p_proveedor uuid, p_codigo text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not ((select public.puede_modulo('proveedores', 'escritura')) or (select public.puede_modulo('pedidos', 'escritura'))) then
    raise exception 'No autorizado.' using errcode = 'insufficient_privilege';
  end if;
  if p_codigo is not null and not exists (select 1 from public.actividades_economicas where codigo = p_codigo) then
    raise exception 'La actividad económica % no está en el catálogo.', p_codigo using errcode = 'check_violation';
  end if;
  update public.proveedores set actividad_economica = p_codigo where id = p_proveedor;
end $$;
revoke execute on function public.proveedor_fijar_actividad(uuid, text) from anon, public;
grant execute on function public.proveedor_fijar_actividad(uuid, text) to authenticated;

-- Cotejo:
-- select count(*) from actividades_economicas;
-- select column_name from information_schema.columns where table_name='proveedores' and column_name='actividad_economica';
