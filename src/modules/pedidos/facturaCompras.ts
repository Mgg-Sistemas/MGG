/* ============================================================
   MGG · Compras · ¿El archivo de `factura_path` es la FACTURA que cargó Compras? (12-11-2026)

   `factura_path` lo comparten dos momentos:
     · Tesorería al pagar (su comprobante de pago; desde el 21-10-2026 con prefijo `pago-`
       y anotado en el evento «pagada» del historial).
     · Compras al FINALIZAR la OC (o con «Reemplazar factura / nota»): pisa el anterior.
   Conciliación necesita contar solo la factura de Compras. Esta lógica pura decide,
   en este orden:
     1) el historial lo dice (desde hoy «finalizada» / «factura_cargada» guardan la ruta);
     2) es el comprobante anotado en el pago → Tesorería;
     3) prefijo `pago-` → Tesorería;
     4) Tesorería ya anotó su comprobante aparte, o la OC nunca pasó por el pago de
        Tesorería → lo que queda en `factura_path` lo puso Compras;
     5) OC viejas: la hora de subida del archivo. Subido después del pago (más de
        5 min) → Compras; a la hora del pago → Tesorería.
   Si no se sabe sin mirar el storage, devuelve 'desconocido'.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';

export type OrigenFactura = 'ninguno' | 'compras' | 'tesoreria' | 'desconocido';

export interface ArchivoStorage {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Holgura entre la subida del archivo y el sello `pagada_en` (se sube ANTES de sellar). */
const HOLGURA_MS = 5 * 60 * 1000;
const EVENTOS_PAGO = new Set(['pagada', 'pagada_sin_caja']);
const EVENTOS_COMPRAS = new Set(['finalizada', 'factura_cargada']);

const ms = (iso?: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

export const nombreArchivo = (path: string): string => path.split('/').pop() ?? path;

type OrdenFactura = Pick<Orden, 'factura_path' | 'historial' | 'pagada_en'>;

/** Origen del archivo en `factura_path`, sin mirar el storage salvo que se pase `archivo`. */
export function origenFactura(o: OrdenFactura, archivo?: ArchivoStorage | null): OrigenFactura {
  const path = o.factura_path;
  if (!path) return 'ninguno';
  const evs = (Array.isArray(o.historial) ? o.historial : []) as unknown as Array<Record<string, unknown>>;
  // 1) Compras dejó la ruta en el historial al finalizar o al reemplazar la factura.
  if (evs.some((e) => EVENTOS_COMPRAS.has(String(e?.evento)) && e.factura_path === path)) return 'compras';
  // 2) Es el comprobante anotado en el pago.
  const pagos = evs.filter((e) => EVENTOS_PAGO.has(String(e?.evento)));
  if (pagos.some((e) => e.comprobante_path === path)) return 'tesoreria';
  // 3) Subido por Tesorería con el prefijo nuevo.
  if (nombreArchivo(path).startsWith('pago-')) return 'tesoreria';
  // 4) Tesorería anotó el suyo aparte (y no es este), o nunca hubo pago de Tesorería.
  if (pagos.some((e) => typeof e.comprobante_path === 'string' && e.comprobante_path)) return 'compras';
  const pagadaEn = ms(o.pagada_en);
  if (!Number.isFinite(pagadaEn)) return 'compras';
  // 5) OC viejas: la hora de subida.
  if (!archivo) return 'desconocido';
  const subido = ms(archivo.updated_at) || ms(archivo.created_at);
  if (!Number.isFinite(subido)) return 'desconocido';
  return subido > pagadaEn + HOLGURA_MS ? 'compras' : 'tesoreria';
}

/** El archivo de `factura_path` dentro del listado de la carpeta de la OC. */
export function archivoDeFactura(o: Pick<Orden, 'factura_path'>, archivos: ArchivoStorage[]): ArchivoStorage | null {
  if (!o.factura_path) return null;
  const n = nombreArchivo(o.factura_path);
  return archivos.find((a) => a.name === n) ?? null;
}
