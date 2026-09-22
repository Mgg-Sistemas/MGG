/* ============================================================
   MGG · Respaldos que nadie podía leer — 22/09/2026

   Las 139 tablas del esquema tienen RLS. Pero 17 la tenían ENCENDIDA y SIN
   NINGUNA POLÍTICA, que en Postgres significa «nadie ve nada»: ni el
   administrador desde el sistema. Son respaldos de ajustes de inventario —
   las fotos de cómo estaba todo antes de tocarlo.

   Un respaldo que no se puede consultar no sirve de respaldo. Y estaban así
   por descuido, no por decisión: los respaldos que se crearon después sí
   llevan su política de lectura.

   Se les da lectura a los usuarios registrados, igual que a los otros. NO se
   les da escritura: un respaldo no se edita, esa es toda su gracia.

   webauthn_challenges QUEDA COMO ESTÁ, cerrada a propósito: son los desafíos
   de la huella/clave de acceso. Esa tabla la escribe y la lee el servidor,
   y que un usuario pueda mirarla sería un problema de seguridad, no una
   comodidad.
   ============================================================ */
begin;

do $$
declare
  t text;
  tablas text[] := array[
    'fusiones_existencias_previas_2026_09',
    'almacenes_desactivados_2026_09',
    'proveedores_categorias_respaldo_2026_09_18',
    'almacenes_borrados_2026_09',
    'productos_hogar_repuntado_2026_09',
    'reclasificacion_general_2026_09',
    'duplicados_desactivados_2026_09',
    'fusiones_duplicados_2026_09',
    'unidades_unificadas_2026_09',
    'existencias_sembradas_2026_09',
    'prefijos_categoria_2026_09',
    'nombres_sellados_2026_09',
    'consolidacion_matanza_2026_09',
    'nombres_reparados_2026_09',
    'toallin_unificado_2026_09',
    'casiterita_detalle_respaldo_2026_09_16'
  ];
begin
  foreach t in array tablas loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = t and c.relkind = 'r') then
      raise notice 'No existe %, se saltea.', t;
      continue;
    end if;

    /* Anon nunca: son datos internos. */
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists respaldo_lectura on public.%I', t);
    execute format(
      'create policy respaldo_lectura on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

commit;

/* Verificación: ninguna tabla sin RLS, y ninguna con RLS sin políticas
   salvo webauthn_challenges, que está cerrada a propósito. */
select
  coalesce(string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'ninguna') as sin_rls,
  coalesce(string_agg(c.relname, ', ') filter (
    where c.relrowsecurity
      and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) = 0
  ), 'ninguna') as rls_sin_politicas,
  count(*) as tablas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
