/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · Quién AUTORIZA las ventas

   Toda venta (nota de entrega o factura, venta o permuta) pasa por una
   autorización previa antes de mover dinero. La dan dos personas:
     · JESUS LOZADA  (admin / Gerente)
     · LEYDIS RENGEL (Jefa de administración)

   Son las mismas que aprueban las Órdenes de Compra, así que se toman sus
   correos de `aprobadoresOc.ts` en vez de repetirlos.

   OJO: esto SOLO decide qué botones se ven. Quien de verdad lo hace cumplir
   es la base (`es_autorizador_ventas()` en
   supabase/2026-09-18-ventas-documento-igtf-autorizacion.sql), con los mismos
   dos correos. Si cambia una persona, se cambia en los dos lados.
   ============================================================ */
import { APROBADOR_JESUS_EMAIL, APROBADOR_LEYDIS_EMAIL } from '@/modules/pedidos/aprobadoresOc';
import { autorizadoPara, type UsuarioAutorizado } from '@/modules/usuarios/autorizados';

/* 10/11/2026 · VENTAS COMO COMPRAS: la aprobación es UNA, al despachar, y la dan
   los administradores y la lista «Usuarios autorizados › Aprobar despachos de
   ventas» (`es_autorizador_ventas()` en supabase/2026-11-10-ventas-como-compras.sql).
   Mientras la lista carga se usan los dos correos de siempre. */
export const AUTORIZADORES_VENTAS_TEXTO = 'los autorizados para aprobar despachos';

const AUTORIZADORES = [APROBADOR_JESUS_EMAIL, APROBADOR_LEYDIS_EMAIL].map((e) => e.toLowerCase());

/** ¿Este usuario puede aprobar despachos (y autorizar/rechazar permutas)? */
export function puedeAutorizarVentas(
  email?: string | null, esAdmin = false, lista?: UsuarioAutorizado[] | null,
): boolean {
  if (esAdmin) return true;
  const enLista = autorizadoPara(email, 'despachos', lista ?? undefined);
  if (enLista !== null) return enLista;
  return AUTORIZADORES.includes((email ?? '').trim().toLowerCase());
}
