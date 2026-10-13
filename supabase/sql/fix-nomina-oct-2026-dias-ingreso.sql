-- ============================================================
-- MGG · Corrección de datos · Nómina «Primera quincena de octubre 2026»
-- (período 6c999718-462b-448f-aca8-7092a60eb5f0, cargada el 13-10-2026, sin pagos)
--
-- Cinco personas con fecha de ingreso 11-10-2026 quedaron con la quincena
-- completa (11 trabajados + 4 descanso = 15 días). Desde su ingreso al 15 son
-- 5 días, todos trabajados y sin descanso. Ninguno de los renglones está
-- pagado, así que se corrigen y se recalcula el total del período.
-- Lo corre la administradora en el SQL Editor de Supabase (una sola vez).
-- ============================================================
begin;

with fix as (
  update public.nomina_renglones r
     set dias_trabajados = 5,
         dias_descanso   = 0,
         salario_bruto   = round(sueldo_base_mensual / 30 * 5, 2),
         neto_usd        = round(sueldo_base_mensual / 30 * 5, 2) + asignaciones + viaticos
                           - deduc_anticipos - deduc_prestamos - deduc_ivss - deduc_faov - deduc_rpe - deduc_sindicato - deduc_otros
   where r.periodo_id = '6c999718-462b-448f-aca8-7092a60eb5f0'
     and r.estado = 'por_pagar'
     and r.dias_trabajados = 11 and r.dias_descanso = 4
     and r.personal_id in (
       'b30498ae-69bb-43fc-b651-6a9063a1d1dc', -- ALEXAED JISETH CAMARGOMONIN · 800 → 133,33
       '19896769-f712-4bb2-949a-59110e38ad77', -- LUIS MIGUEL HERRERA HERRERA · 480 → 80
       'aeca4cb1-653d-4084-a668-48355cc36c41', -- LETTIMER RODRIGUEZ           · 480 → 80
       'b0a84fa2-88e3-46f9-a759-065abd91bdb1', -- EMANUEL RODRIGUEZ            · 480 → 80
       'bc762052-a795-4e67-93bb-efba3521b509'  -- JAVIER ANTONIO SALAZAR ACOSTA · 720 → 120
     )
   returning r.id
)
select count(*) as renglones_corregidos from fix;

update public.nomina_periodos np
   set total_usd = (select coalesce(sum(neto_usd), 0) from public.nomina_renglones r where r.periodo_id = np.id and r.eliminado_en is null),
       notas = concat_ws(' · ', nullif(btrim(coalesce(notas, '')), ''),
                         'Corrección 13-10-2026: 5 ingresos del 11-10 pasan de 15 a 5 días (desde su fecha de ingreso).')
 where np.id = '6c999718-462b-448f-aca8-7092a60eb5f0';

-- Cotejo: debe dar 5 filas con 5/0 y el total del período en 12.118,33.
select r.nombre, r.dias_trabajados, r.dias_descanso, r.salario_bruto, r.neto_usd
  from public.nomina_renglones r
 where r.periodo_id = '6c999718-462b-448f-aca8-7092a60eb5f0' and r.dias_trabajados = 5
 order by r.nombre;
select codigo, nombre, total_usd, notas from public.nomina_periodos where id = '6c999718-462b-448f-aca8-7092a60eb5f0';

commit;
