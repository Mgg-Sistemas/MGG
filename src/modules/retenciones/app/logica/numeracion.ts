/* ============================================================
   MGG · Retenciones · La numeración de los comprobantes

   Cada impuesto numera en su serie, continua y sin reinicio mensual (A2):
   el IVA, AAAAMM + 8 dígitos (el prefijo es el mes del período); ISLR e
   ISAE, 10 dígitos. Un número entregado o retirado no vuelve a usarse (lo
   guarda la base en retencion_numeros).

   «Mixta» (por defecto): MGG propone el siguiente y «Editar número» deja
   poner el del otro sistema, con avisos que no bloquean (D21b).

   «La última de su serie» decide qué pasa al corregir una impresa: si es
   la última, se corrige con el mismo número y se reimprime; si no, se anula
   y se rehace con un número nuevo. Una declarada no se corrige.
   ============================================================ */

import { r2 } from './numeros';

export type ModoNumeracion = 'mixta' | 'mgg' | 'otro';

export interface FormatoSerie {
  /** El número empieza por el período AAAAMM (IVA). */
  prefijoPeriodo: boolean;
  /** Los dígitos del secuencial. */
  digitos: number;
  /** Cómo se le explica al usuario. */
  texto: string;
}

export const FORMATO_IVA: FormatoSerie = { prefijoPeriodo: true, digitos: 8, texto: 'AAAAMM + 8 dígitos' };
export const FORMATO_DIEZ: FormatoSerie = { prefijoPeriodo: false, digitos: 10, texto: '10 dígitos' };

export function numeroValido(numero: string, f: FormatoSerie): boolean {
  const sec = `\\d{${f.digitos}}`;
  return new RegExp(f.prefijoPeriodo ? `^\\d{4}(0[1-9]|1[0-2])${sec}$` : `^${sec}$`).test(numero ?? '');
}

export function secuencial(numero: string, f: FormatoSerie): number {
  return Number(f.prefijoPeriodo ? numero.slice(6) : numero);
}

export function armarNumero(sec: number, f: FormatoSerie, periodo: string): string {
  const s = String(sec).padStart(f.digitos, '0');
  return f.prefijoPeriodo ? `${periodo}${s}` : s;
}

/** El siguiente al último de la serie (de MGG o del otro sistema), saltando los retirados. */
export function siguienteNumero(ultimo: string | null, f: FormatoSerie, periodo: string, retirados: ReadonlySet<string>): string {
  let sec = ultimo ? secuencial(ultimo, f) + 1 : 1;
  while (retirados.has(armarNumero(sec, f, periodo))) sec++;
  return armarNumero(sec, f, periodo);
}

export interface AvisoNumero { nivel: 'fuerte' | 'medio'; texto: string }

/** Los avisos de un número escrito a mano. Avisan; no bloquean (D21b.6 y D21b.7). */
export function avisosNumero(n: string, propuesto: string, f: FormatoSerie, periodoFactura: string, usado: 'no' | 'usado' | 'retirado'): AvisoNumero[] {
  const num = (n ?? '').trim();
  if (!num || num === propuesto) return [];
  const av: AvisoNumero[] = [];
  if (!numeroValido(num, f)) av.push({ nivel: 'fuerte', texto: `Formato de la serie: ${f.texto}.` });
  else {
    const d = secuencial(num, f) - secuencial(propuesto, f);
    const extra = d < 0 ? ': es menor' : d > 50 ? `: salto de ${d} posiciones respecto del último número. Verificar` : '';
    av.push({ nivel: 'medio', texto: `El número no es el siguiente de la serie (${propuesto})${extra}.` });
    if (f.prefijoPeriodo && num.slice(0, 6) !== periodoFactura) {
      av.push({ nivel: 'medio', texto: `El prefijo ${num.slice(0, 6)} no coincide con el período de la factura (${periodoFactura}).` });
    }
  }
  if (usado === 'usado') av.push({ nivel: 'fuerte', texto: 'Número de comprobante ya registrado.' });
  if (usado === 'retirado') av.push({ nivel: 'fuerte', texto: 'Número retirado: no se vuelve a usar.' });
  return av;
}

export type AccionCorreccion =
  | { tipo: 'bloqueada' }
  | { tipo: 'sitio' }
  | { tipo: 'sitio_ultima' }
  | { tipo: 'rehacer'; numero: string };

export function accionCorreccion(r: { numero: string; impresa: boolean; declarada: boolean }, ultimoDeLaSerie: string | null, siguiente: string): AccionCorreccion {
  if (r.declarada) return { tipo: 'bloqueada' };
  if (!r.impresa) return { tipo: 'sitio' };
  if (r.numero === ultimoDeLaSerie) return { tipo: 'sitio_ultima' };
  return { tipo: 'rehacer', numero: siguiente };
}

export interface AfectadaRecalculo {
  id: string;
  tipo: string;
  numero: string;
  periodo: string;
  impresa: boolean;
  declarada: boolean;
  antes: number;
  despues: number;
}

/**
 * Qué pasa con cada retención afectada por un cambio hacia atrás (un %, una
 * regla o un parámetro). Con alguna declarada, el cambio se bloquea. «La última
 * de su serie» se evalúa una vez, antes de procesar, y los números nuevos no se repiten.
 */
export function planRecalculo<T extends AfectadaRecalculo>(
  afectadas: readonly T[],
  ultimos: Readonly<Record<string, string | null>>,
  siguiente: (tipo: string, periodo: string, yaDados: ReadonlySet<string>) => string,
): { bloqueado: boolean; bloqueadas: T[]; filas: (T & { accion: AccionCorreccion })[] } {
  const bloqueadas = afectadas.filter((x) => x.declarada);
  const yaDados = new Set<string>();
  const filas = afectadas
    .filter((x) => !x.declarada && r2(x.antes) !== r2(x.despues))
    .map((x) => {
      const ultimo = ultimos[x.tipo] ?? null;
      const rehace = x.impresa && x.numero !== ultimo;
      const nuevo = rehace ? siguiente(x.tipo, x.periodo, yaDados) : '';
      if (nuevo) yaDados.add(nuevo);
      return { ...x, accion: accionCorreccion(x, ultimo, nuevo) };
    });
  return { bloqueado: bloqueadas.length > 0, bloqueadas, filas };
}
