/* ============================================================
   MGG · Retenciones v8 · Las actividades del proveedor y su licencia (lógica pura)

   Las de la maqueta (v7-3-registro-comprobante.js: v6TrasAbrirPerfil,
   pintarActsPerfil; v7-5-parametros.js: v7EstadoLicencia). En la base de
   Retenciones son los archivos en espera de BD (docs/sql/2026-10-20-v8-pantallas,
   después de la v2.2):
   - v8p-04, retencion_proveedor_actividades: varias por proveedor, una sola
     principal abierta, el mismo código abierto una vez, sin borrar (se cierra
     con «hasta» o se desactiva). La principal pasa sola al perfil.
   - v8p-03, retencion_proveedor_licencias (tipo, emisión y vigencia, con
     vence ≥ emision) y el catálogo retencion_licencia_tipos (con
     vigencia_meses para proponer el vencimiento).
   - v8p-05, retencion_avisos_vencimiento(): el umbral de las licencias (30 días).
   ============================================================ */
import { SIN_ACTIVIDAD_MUNICIPIO } from './perfilProveedor';

export interface ActividadProveedor {
  id?: string;
  codigo: string;
  principal: boolean;
  desde: string | null;
  /** Cerrada desde esta fecha (aaaa-mm-dd); null = abierta. */
  hasta: string | null;
}

const ACTIVIDAD = /^[0-9]+(\.[0-9]+){0,5}$/;
const abierta = (x: ActividadProveedor) => !x.hasta;

export function principalDe(xs: readonly ActividadProveedor[]): ActividadProveedor | null {
  return xs.find((x) => x.principal && abierta(x)) ?? null;
}

export function anadirActividad(
  xs: readonly ActividadProveedor[], codigo: string, hoy: string,
): { ok: true; actividades: ActividadProveedor[] } | { ok: false; error: string } {
  const c = codigo.trim();
  if (c !== SIN_ACTIVIDAD_MUNICIPIO && !ACTIVIDAD.test(c)) return { ok: false, error: 'La actividad se indica con su código, como 3.2.14.04 (de 1 a 6 niveles).' };
  if (xs.some((x) => x.codigo === c && abierta(x))) return { ok: false, error: 'Esa actividad ya está en el perfil.' };
  const fuera = c === SIN_ACTIVIDAD_MUNICIPIO;
  const base = fuera ? xs.map((x) => ({ ...x, principal: false })) : xs.map((x) => ({ ...x }));
  base.push({ codigo: c, principal: fuera || !principalDe(xs), desde: hoy, hasta: null });
  return { ok: true, actividades: base };
}

/** Una sola principal, y solo entre las abiertas. */
export function elegirPrincipal(xs: readonly ActividadProveedor[], i: number): ActividadProveedor[] {
  if (!xs[i] || !abierta(xs[i])) return xs.map((x) => ({ ...x }));
  return xs.map((x, j) => ({ ...x, principal: j === i }));
}

/** Cierra con su «hasta»; si era la principal, pasa a la primera abierta (si queda alguna). */
export function cerrarActividad(xs: readonly ActividadProveedor[], i: number, hasta: string): ActividadProveedor[] {
  const ys = xs.map((x, j) => (j === i ? { ...x, hasta, principal: false } : { ...x }));
  if (xs[i]?.principal) {
    const otra = ys.findIndex(abierta);
    if (otra >= 0) ys[otra].principal = true;
  }
  return ys;
}

const DIA = 86_400_000;
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA);

export type EstadoLicencia = 'sin_fecha' | 'vencida' | 'por_vencer' | 'al_dia';

export function estadoLicencia(vence: string | null, hoy: string, umbral: number): { estado: EstadoLicencia; texto: string } {
  if (!vence) return { estado: 'sin_fecha', texto: 'Sin fecha de vigencia: no hay aviso.' };
  const d = dias(hoy, vence);
  if (d < 0) return { estado: 'vencida', texto: `Vencida hace ${-d} día${d === -1 ? '' : 's'}` };
  if (d <= umbral) return { estado: 'por_vencer', texto: d === 0 ? 'Vence hoy' : `Vence en ${d} día${d === 1 ? '' : 's'}` };
  return { estado: 'al_dia', texto: 'Al día' };
}

/** La vigencia propuesta: la emisión más los meses del tipo (al último día del mes si no existe ese día). */
export function venceDesdeEmision(emision: string, meses: number | null): string | null {
  if (!emision || !meses) return null;
  const [y, m, d] = emision.split('-').map(Number);
  const total = m - 1 + meses;
  const anio = y + Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export function validarLicencia(emision: string, vence: string): string | null {
  return emision && vence && vence < emision ? 'La vigencia no puede ser anterior a la emisión.' : null;
}

/** El umbral de las licencias en retenciones.avisos.umbrales (el de la maqueta). */
export const UMBRAL_LICENCIAS = 30;
