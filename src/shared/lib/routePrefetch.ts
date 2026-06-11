// Prefetch de los chunks de página (code-splitting por ruta).
//
// Cada página es un import() perezoso (ver App.tsx), así que al hacer clic en un
// módulo del menú hay un micro-retraso mientras baja su chunk. Acá precargamos ese
// chunk cuando el usuario PASA EL MOUSE o ENFOCA el ítem del menú: para cuando
// hace clic, el chunk ya está en caché y la página abre al instante.
//
// Los specifiers son los MISMOS módulos que importa App.tsx (vía alias '@/'), así
// que Rollup los resuelve al mismo chunk: no se duplica nada en el build.

const THUNKS: Record<string, () => Promise<unknown>> = {
  '/app/dashboard': () => import('@/modules/dashboard/DashboardPage'),
  '/app/pedidos': () => import('@/modules/pedidos/PedidosPage'),
  '/app/pedidos/historico': () => import('@/modules/pedidos/HistoricoPage'),
  '/app/proveedores': () => import('@/modules/proveedores/ProveedoresPage'),
  '/app/inventario': () => import('@/modules/inventario/InventarioPage'),
  '/app/produccion': () => import('@/modules/produccion/ProduccionPage'),
  '/app/salidas': () => import('@/modules/salidas/SalidasPage'),
  '/app/combustible': () => import('@/modules/combustible/CombustiblePage'),
  '/app/tesoreria': () => import('@/modules/tesoreria/TesoreriaPage'),
  '/app/retenciones': () => import('@/modules/retenciones/RetencionesPage'),
  '/app/rrhh': () => import('@/modules/rrhh/RrhhPage'),
  '/app/usuarios': () => import('@/modules/usuarios/UsuariosPage'),
  '/app/ajustes': () => import('@/modules/ajustes/AjustesPage'),
};

const yaPrecargado = new Set<string>();

/**
 * Descarga (y cachea) el chunk de la página de `to` en segundo plano. Idempotente:
 * solo descarga una vez por ruta. Pensado para llamarse en onMouseEnter/onFocus del
 * menú. No bloquea ni await: si falla, se reintenta al navegar de verdad.
 */
export function prefetchRoute(to: string): void {
  const thunk = THUNKS[to];
  if (!thunk || yaPrecargado.has(to)) return;
  yaPrecargado.add(to);
  void thunk().catch(() => yaPrecargado.delete(to));
}
