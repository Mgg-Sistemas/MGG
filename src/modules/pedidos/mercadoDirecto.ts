/* ============================================================
   MGG · Pedidos de mercado van DIRECTO a Compras (09-11-2026)
   Con la revisión de almacén prendida, la SP de productos nace «En revisión de
   almacén». Los pedidos de MERCADO no: entran directo a Compras («pendiente»),
   sin que el almacenista los confirme. Es mercado:
     · la que se monta con 🛒 Solicitud de Mercado (finalidad de mercado), y
     · la que se carga con «+ Nueva orden» a nombre de la COCINA o de ALIMENTACION
       (pedido de la administradora: SP-2026-0249 papel aluminio de la cocina
       quedó esperando a Almacén).
   ============================================================ */

/** Finalidad general de un pedido de reposición de mercado. */
export const FINALIDAD_MERCADO = 'PEDIDO PARA RESTABLECER EL MERCADO';

/** Unidades solicitantes cuyos pedidos son de mercado. */
export const UNIDADES_MERCADO = ['COCINA', 'ALIMENTACION'] as const;

const normal = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** ¿Es un pedido de mercado (va directo a Compras, sin revisión de almacén)? */
export function esPedidoMercado(o: { finalidad?: string | null; solicitante?: string | null }): boolean {
  if (normal(o.finalidad) === normal(FINALIDAD_MERCADO)) return true;
  const u = normal(o.solicitante);
  return UNIDADES_MERCADO.some((m) => u === m || u.startsWith(`${m} `));
}
