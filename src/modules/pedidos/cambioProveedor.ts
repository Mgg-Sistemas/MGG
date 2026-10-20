/* ============================================================
   MGG · Pedidos · Cambio de proveedor de una OC (20-10-2026).
   Mientras una OC espera «indicar método de pago» se puede cambiar de proveedor; como el
   Gerente la había confirmado con OTRO proveedor, vuelve a «Pendiente por aprobación» y
   todo queda en la traza: quién, cuándo, de quién a quién (con nombre y RIF tal como eran
   ese día), por qué, y qué confirmación se anuló. Antes el evento solo guardaba ids que la
   línea de tiempo no leía y se veía «Cambio de proveedor» a secas. Funciones puras.
   ============================================================ */

export interface ProveedorRef {
  id?: string | null;
  razon_social?: string | null;
  rif?: string | null;
}

/** «RAZÓN SOCIAL · J-12345678-0»; «—» si no hay nada que mostrar. */
export function textoProveedor(p?: ProveedorRef | null): string {
  const nombre = (p?.razon_social ?? '').trim();
  if (!nombre) return '—';
  const rif = (p?.rif ?? '').trim();
  return rif ? `${nombre} · ${rif}` : nombre;
}

export const MOTIVO_MIN = 5;

/** Mensaje de error si el motivo no sirve; null si está bien. */
export function errorMotivoCambio(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim();
  if (!m) return 'Escribí el motivo del cambio de proveedor.';
  if (m.length < MOTIVO_MIN) return `El motivo es muy corto (mínimo ${MOTIVO_MIN} letras).`;
  return null;
}

export interface DatosCambioProveedor {
  anterior: ProveedorRef | null;
  nuevo: ProveedorRef | null;
  motivo?: string | null;
  /** Confirmación del Gerente que se anula al volver a aprobación. */
  confirmadaPor?: string | null;
  confirmadaEn?: string | null;
  total?: number | null;
  moneda?: string | null;
}

/** Campos que se agregan al evento del historial (además de at / evento / actor). */
export function extrasCambioProveedor(d: DatosCambioProveedor): Record<string, unknown> {
  const out: Record<string, unknown> = {
    proveedorAnteriorId: d.anterior?.id ?? null,
    proveedorNuevoId: d.nuevo?.id ?? null,
    proveedorAnterior: textoProveedor(d.anterior),
    proveedorNuevo: textoProveedor(d.nuevo),
    vuelve_a: 'oc_creada',
  };
  const motivo = (d.motivo ?? '').trim();
  if (motivo) out.motivo = motivo;
  if (d.confirmadaPor) out.confirmada_por = d.confirmadaPor;
  if (d.confirmadaEn) out.confirmada_en = d.confirmadaEn;
  if (d.total != null) out.total = d.total;
  if (d.moneda) out.moneda = d.moneda;
  return out;
}

type Evento = Record<string, unknown> & { motivo?: string };
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/**
 * Texto de la línea de tiempo para un evento con cambio de proveedor:
 * « · de A → B · motivo». '' si el evento no trae los dos proveedores.
 * Lee lo guardado en el evento (nombre y RIF de ese día); si no está, busca por id en
 * `resolver` (eventos del 19-10 y antes: guardaban `de` / `a`, o solo los ids).
 */
export function lineaCambioProveedor(h: Evento, resolver: (id: string) => ProveedorRef | null): string {
  const idAnt = str(h.proveedorAnteriorId) || str(h.de);
  const idNue = str(h.proveedorNuevoId) || str(h.a);
  const ant = str(h.proveedorAnterior) || (idAnt ? textoProveedor(resolver(idAnt)) : '');
  const nue = str(h.proveedorNuevo) || (idNue ? textoProveedor(resolver(idNue)) : '');
  if (!ant || ant === '—' || !nue || nue === '—') return '';
  const motivo = str(h.motivo);
  return ` · de ${ant} → ${nue}${motivo ? ` · ${motivo}` : ''}`;
}
