/* ============================================================
   MGG · Correos de quienes aprueban (traído de Golden Touch, 11-11-2026)

   Ventas (flujo de GT) los usa como respaldo mientras carga la lista
   «Usuarios autorizados › Aprobar despachos de ventas». Son las mismas dos
   personas que autorizan Salidas en MGG.
   ============================================================ */

/** JESUS LOZADA — Gerente / admin. */
export const APROBADOR_JESUS_EMAIL = 'mineralgroupguayanaca@gmail.com';
/** LEYDIS RENGEL — Jefa de administración. */
export const APROBADOR_LEYDIS_EMAIL = 'jhzgcontabilidad@gmail.com';

/** MARIANA TOVAR — Analista de Compras: ELABORA las Órdenes de Compra. */
export const ELABORADOR_OC = {
  nombre: 'MARIANA TOVAR',
  cargo: 'Analista de Compras',
  ci: 'V-27.293.907',
} as const;
