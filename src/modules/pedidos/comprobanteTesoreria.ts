/* ============================================================
   MGG · Compras · ¿Cuál es el comprobante que adjuntó TESORERÍA? · 21-10-2026
   Tesorería sube su adjunto al pagar la OC y queda en `factura_path`. Pero ese mismo
   campo lo pisan «Finalizar orden» (con factura) y «Reemplazar factura / nota», así
   que el comprobante del pago se perdía de la pantalla (el archivo seguía en el
   storage). Esta lógica pura lo recupera, en este orden:
     1) el evento «pagada» del historial (desde hoy guarda la ruta del comprobante);
     2) archivos `pago-*` de la carpeta de la OC (desde hoy Tesorería sube con ese prefijo);
     3) OC viejas: el `factura-*` subido a la hora del pago (a más tardar 5 min después
        de `pagada_en`); lo que el analista sube después, al finalizar, queda fuera.
   ============================================================ */
import type { Orden } from '@/shared/lib/types';

export interface ArchivoOc {
  name: string;
  created_at?: string | null;
}

export interface RefAdjunto {
  path: string;
  nombre: string;
}

/** Holgura entre la subida del archivo y el sello `pagada_en` (se sube ANTES de sellar). */
const HOLGURA_MS = 5 * 60 * 1000;

const ms = (iso?: string | null): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

const sinPrefijo = (name: string): string => name.replace(/^(pago|factura)-/, '');

/** El más reciente por fecha de subida (sin fecha, el último de la lista). */
function masReciente(archivos: ArchivoOc[]): ArchivoOc | null {
  if (!archivos.length) return null;
  const orden = [...archivos].sort((a, b) => (ms(a.created_at) || 0) - (ms(b.created_at) || 0));
  return orden[orden.length - 1] ?? null;
}

export function elegirComprobanteTesoreria(
  o: Pick<Orden, 'id' | 'historial' | 'pagada_en'>,
  archivos: ArchivoOc[] = [],
): RefAdjunto | null {
  // 1) Historial: el último pago con comprobante guardado.
  const pagos = (o.historial ?? []).filter((e) => e.evento === 'pagada');
  for (let i = pagos.length - 1; i >= 0; i--) {
    const e = pagos[i] as unknown as Record<string, unknown>;
    if (typeof e.comprobante_path === 'string' && e.comprobante_path) {
      const nombre = typeof e.comprobante_nombre === 'string' && e.comprobante_nombre
        ? e.comprobante_nombre
        : sinPrefijo(e.comprobante_path.split('/').pop() ?? 'comprobante');
      return { path: e.comprobante_path, nombre };
    }
  }

  const ruta = (a: ArchivoOc): RefAdjunto => ({ path: `${o.id}/${a.name}`, nombre: sinPrefijo(a.name) });

  // 2) Archivos subidos por Tesorería con el prefijo nuevo.
  const pago = masReciente(archivos.filter((a) => a.name.startsWith('pago-')));
  if (pago) return ruta(pago);

  // 3) OC viejas: la «factura» subida al momento del pago.
  const pagadaEn = ms(o.pagada_en);
  if (!Number.isFinite(pagadaEn)) return null;
  const alPagar = archivos.filter((a) => {
    if (!a.name.startsWith('factura-')) return false;
    const t = ms(a.created_at);
    return Number.isFinite(t) && t <= pagadaEn + HOLGURA_MS;
  });
  const vieja = masReciente(alPagar);
  return vieja ? ruta(vieja) : null;
}
