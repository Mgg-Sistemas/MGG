import { MODULES, type ModuleKey } from '@/modules/usuarios/permisos.repository';
import type { Notificacion } from '@/shared/lib/types';
import type { PermLevel } from '@/modules/auth/PermissionsContext';

/**
 * Deduce el módulo del sistema al que pertenece una notificación.
 * Examina:
 * 1. El link (ruta `/app/<modulo>` o hash `#/app/<modulo>`).
 * 2. El `dedup_key` (prefijos conocidos como `restock:`, `maq-`, `retencion-`, etc.).
 * 3. Palabras clave del título y cuerpo del mensaje.
 */
export function moduloDeNotificacion(
  n: Pick<Notificacion, 'link' | 'title' | 'message' | 'dedup_key'>
): ModuleKey | null {
  // 1. Análisis por enlace directo
  if (n.link && n.link !== '#') {
    const limpia = n.link
      .trim()
      .replace(/^[#/?]+/, '')
      .replace(/^app\/?/, '')
      .split('?')[0]
      .split('#')[0]
      .toLowerCase();

    // Coincidencia exacta o prefijo de ruta configurada en MODULES
    for (const m of MODULES) {
      if (m.path) {
        const p = m.path.toLowerCase();
        if (limpia === p || limpia.startsWith(p + '/')) {
          return m.key;
        }
      }
    }

    // Primer segmento de la ruta (ej: "retenciones/telefono" -> "retenciones")
    const primerSegmento = limpia.split('/')[0];
    const modDirecto = MODULES.find((m) => m.key.toLowerCase() === primerSegmento);
    if (modDirecto) {
      return modDirecto.key;
    }

    // Rutas alias comunes
    if (primerSegmento === 'flota') return 'maquinaria';
    if (primerSegmento === 'compras') return 'pedidos';
  }

  // 2. Análisis por dedup_key
  if (n.dedup_key) {
    const k = n.dedup_key.toLowerCase();
    if (k.startsWith('restock:')) return 'inventario';
    if (k.startsWith('maq-')) return 'maquinaria';
    if (k.includes('retencion')) return 'retenciones';
    if (k.startsWith('oc-') || k.startsWith('pedido-') || k.startsWith('compra-')) return 'pedidos';
    if (k.startsWith('salida-') || k.startsWith('traslado-')) return 'salidas';
    if (k.startsWith('tesoreria-') || k.startsWith('cierre-')) return 'tesoreria';
    if (k.startsWith('venta-')) return 'ventas';
    if (k.startsWith('rrhh-') || k.startsWith('nomina-')) return 'rrhh';
    if (k.startsWith('user-') || k.startsWith('rol-')) return 'usuarios';
    if (k.startsWith('prov-')) return 'proveedores';
    if (k.startsWith('cocina-')) return 'cocina';
    if (k.startsWith('combustible-')) return 'combustible';
  }

  // 3. Análisis heurístico por título y mensaje
  const texto = `${n.title ?? ''} ${n.message ?? ''}`.toLowerCase();

  if (/retenci[oó]n|seniat|islr|\biva\b|factura\s+externa/.test(texto)) return 'retenciones';
  if (/tesorer[ií]a|cuenta\s+por\s+pagar|cuenta\s+por\s+cobrar|tasa\s+binance|tasa\s+bcv|billetera|gasto\s+registrado|traslado\s+interno/.test(texto)) return 'tesoreria';
  if (/orden\b|cotizaci[oó]n|solicitud\s+de\s+almac[eé]n|compra\s+directa|\boc\s+\d+|servicio\s+directo/.test(texto)) return 'pedidos';
  if (/salida\s+de\s+material|salida\s+de\s+dinero|traslado\s+de\s+material|\bsalida\b|\btraslado\b/.test(texto)) return 'salidas';
  if (/stock|reabastecimiento|almac[eé]n|producto/.test(texto)) return 'inventario';
  if (/venta|factura\s+de\s+venta|nota\s+de\s+entrega/.test(texto)) return 'ventas';
  if (/maquinaria|veh[ií]culo|flota|od[oó]metro|hor[oó]metro/.test(texto)) return 'maquinaria';
  if (/n[oó]mina|sueldo|pr[eé]stamo|descanso|rrhh|personal/.test(texto)) return 'rrhh';
  if (/usuario|rol\b|roles|permiso|clave\s+reseteada|autorizado\s+para\s+aprobar|firma\s+cargada/.test(texto)) return 'usuarios';
  if (/proveedor/.test(texto)) return 'proveedores';
  if (/cocina|comedor|alimentaci[oó]n|desayuno|almuerzo|cena/.test(texto)) return 'cocina';
  if (/combustible|surtidor|tanque/.test(texto)) return 'combustible';
  if (/colada|fundici[oó]n|producci[oó]n/.test(texto)) return 'produccion';
  if (/refinaci[oó]n/.test(texto)) return 'refinacion';
  if (/recepci[oó]n|romana/.test(texto)) return 'recepciones';
  if (/acopio/.test(texto)) return 'acopio';
  if (/chofer|conductor/.test(texto)) return 'choferes';
  if (/asignaci[oó]n/.test(texto)) return 'asignaciones';
  if (/contabilidad|libro\s+mayor/.test(texto)) return 'contabilidad';

  return null;
}

/**
 * Determina si el usuario actual tiene permisos para ver o recibir una notificación.
 * - Administradores: ven todas las notificaciones.
 * - Si la notificación está explícitamente destinada a su `user_id` o `role`: permitida.
 * - Si pertenece a un módulo: permitida únicamente si tiene lectura sobre ese módulo.
 * - Si no pertenece a ningún módulo identificable y el usuario no es admin: no se muestra.
 */
export function puedeVerNotificacion(
  n: Notificacion,
  can: (module: ModuleKey, level?: PermLevel) => boolean,
  isAdmin: boolean,
  role?: string | null,
  userId?: string | null
): boolean {
  if (isAdmin) return true;

  // Notificación con destinatario directo
  if (userId && n.destino === userId) return true;
  if (role && n.destino === role) return true;

  const modulo = moduloDeNotificacion(n);
  if (!modulo) {
    // Si no está asociada a ningún módulo y es para 'all', solo el admin la ve
    return false;
  }

  // Submódulos de acopio
  if (modulo.startsWith('acopio') && can('acopio', 'lectura')) {
    return true;
  }

  return can(modulo, 'lectura');
}
