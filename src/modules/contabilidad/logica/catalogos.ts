/* ============================================================
   MGG · Contabilidad · Catálogos «Auxiliares y Otros» (lógica pura)

   La ventana de tablas de Galac (galac-capturas-A.md, photo_19; diferencias
   1 y 17): Auxiliar · Cambio · Centro De Costos · Moneda · Moneda Local ·
   País · Tipo de Comprobante. Cada tabla con Insertar, Modificar,
   Consultar, Buscar, Imprimir Lista y Activar / Inactivar. NUNCA se borra
   (usuario, 20/10): lo que tiene asientos encima se inactiva y deja de
   ofrecerse en lo nuevo, sin tocar el pasado. El código no se modifica.
   Reglas del DDL v0.6-v0.8:
   · tipo de comprobante: 2 DÍGITOS, únicos; el 90-98 es del sistema y no
     se inserta, no se edita ni se inactiva (Master, 29/10 05:13; en la base,
     la columna generada `sistema`). Los de los procesos (diferencial, cierre,
     apertura) salen de Parámetros, y no se inactiva el que esté elegido;
   · centro de costo: código único, tipo sede | centro_acopio | area | equipo,
     padre opcional (Galac es plano);
   · auxiliar: único por (tipo, código); RIF opcional, «LETRA-DÍGITOS»;
   · moneda: código de 3 o 4 letras o dígitos (ISO o los de Galac, «1BT»);
   · país: 2 letras ISO;
   · moneda local: país y moneda existentes, moneda anterior opcional,
     factor ≥ 0, vigencia ordenada (sin «hasta» = 06/06/2079, la abierta de
     Galac), única por (país, moneda, desde) y sin solaparse con otra activa
     del mismo país;
   · cambio: moneda existente y distinta de la funcional, una tasa por día.
   Y las de uso: no se inactiva lo que el sistema necesita para trabajar.
   ============================================================ */

import { normalizarRif } from '@/shared/lib/rif';
import type {
  ContAuxiliar, ContCambio, ContCentroCosto, ContMoneda, ContMonedaLocal, ContPais, ContParametros, ContRegla,
  ContTipoComprobante, TipoAuxiliar,
} from '../tipos';

export const TIPOS_AUXILIAR: Array<[TipoAuxiliar, string]> = [
  ['proveedor', 'Proveedor'], ['cliente', 'Cliente'], ['empleado', 'Empleado'], ['banco', 'Banco'],
  ['centro_acopio', 'Centro de acopio'], ['intercompania', 'Intercompañía'], ['otro', 'Otro'],
];
export const nombreTipoAuxiliar = (t: TipoAuxiliar | null): string => TIPOS_AUXILIAR.find(([k]) => k === t)?.[1] ?? '—';

export const TIPOS_CENTRO: Array<[ContCentroCosto['tipo'], string]> = [
  ['sede', 'Sede'], ['centro_acopio', 'Centro de acopio'], ['area', 'Área'], ['equipo', 'Equipo'],
];
export const nombreTipoCentro = (t: ContCentroCosto['tipo']): string => TIPOS_CENTRO.find(([k]) => k === t)?.[1] ?? t;

export const ORIGENES_TIPO: Array<[ContTipoComprobante['origen'], string]> = [
  ['manual', 'Manual'], ['automatico', 'Automático'], ['ambos', 'Manual y automático'],
];

/** Del sistema: el rango 90-98 de Galac (la columna generada del DDL v0.8). No se insertan, no se editan y no se inactivan. */
export const esTipoDelSistema = (codigo: string): boolean => /^9[0-8]$/.test(codigo);

const mayus = (s: string) => s.trim().toUpperCase();
const sinNombre = (n: string) => (n.trim() ? [] : ['Nombre requerido.']);

/* ───────────── Tipos de comprobante ───────────── */

export interface TipoComprobanteInput { codigo: string; nombre: string; origen: ContTipoComprobante['origen'] }

export function validarTipoComprobante(x: TipoComprobanteInput, existentes: ContTipoComprobante[]): string[] {
  const errores: string[] = [];
  const codigo = x.codigo.trim();
  if (!/^\d{2}$/.test(codigo)) errores.push('El código del tipo de comprobante son 2 dígitos (por ejemplo, 07).');
  else if (esTipoDelSistema(codigo)) errores.push(`Los códigos del 90 al 98 son del sistema: el ${codigo} no se puede usar.`);
  else if (existentes.some((t) => t.codigo === codigo)) errores.push(`Ya existe el tipo de comprobante ${codigo}.`);
  errores.push(...sinNombre(x.nombre));
  if (!ORIGENES_TIPO.some(([k]) => k === x.origen)) errores.push('Origen no válido.');
  return errores;
}

/** Modificar: solo el nombre y el origen; el código no cambia. */
export function erroresModificarTipo(t: ContTipoComprobante, x: Omit<TipoComprobanteInput, 'codigo'>): string[] {
  if (esTipoDelSistema(t.codigo)) return [`El tipo ${t.codigo} es del sistema: no se modifica.`];
  return [...sinNombre(x.nombre), ...(ORIGENES_TIPO.some(([k]) => k === x.origen) ? [] : ['Origen no válido.'])];
}

export function erroresInactivarTipo(t: ContTipoComprobante, reglas: ContRegla[], parametros: ContParametros): string[] {
  const errores: string[] = [];
  if (esTipoDelSistema(t.codigo)) errores.push(`El tipo ${t.codigo} es del sistema: no se inactiva.`);
  const enParametros = [parametros.tipo_comprobante_defecto_id, parametros.tipo_diferencial_id, parametros.tipo_cierre_id, parametros.tipo_apertura_id];
  if (enParametros.includes(t.id)) errores.push(`El tipo ${t.codigo} está elegido en Parámetros para un proceso: primero se cambia allí.`);
  const usadas = reglas.filter((r) => r.activa && r.tipo_comprobante_id === t.id);
  if (usadas.length) errores.push(`El tipo ${t.codigo} lo usan ${usadas.length} regla(s) de contabilización activa(s) (${usadas.slice(0, 3).map((r) => r.codigo).join(', ')}${usadas.length > 3 ? '…' : ''}).`);
  return errores;
}

/* ───────────── Centros de costo ───────────── */

export interface CentroCostoInput { codigo: string; nombre: string; tipo: ContCentroCosto['tipo']; padre_id: string | null }

function erroresPadre(padreId: string | null, existentes: ContCentroCosto[], propio?: string): string[] {
  if (!padreId) return [];
  if (padreId === propio) return ['Un centro no puede depender de sí mismo.'];
  const padre = existentes.find((c) => c.id === padreId);
  if (!padre) return ['El centro padre ya no existe.'];
  if (!padre.activo) return [`El centro padre ${padre.codigo} está inactivo.`];
  // Sin ciclos: el padre no puede colgar del centro que se modifica.
  for (let p: ContCentroCosto | undefined = padre; p; p = existentes.find((c) => c.id === p!.padre_id)) {
    if (p.id === propio) return ['Ese padre depende del propio centro: se formaría un ciclo.'];
    if (!p.padre_id) break;
  }
  return [];
}

export function validarCentroCosto(x: CentroCostoInput, existentes: ContCentroCosto[]): string[] {
  const errores: string[] = [];
  const codigo = mayus(x.codigo);
  if (!codigo) errores.push('Código requerido.');
  else if (existentes.some((c) => c.codigo === codigo)) errores.push(`Ya existe el centro de costo ${codigo}.`);
  errores.push(...sinNombre(x.nombre));
  if (!TIPOS_CENTRO.some(([k]) => k === x.tipo)) errores.push('Tipo de centro de costo no válido.');
  errores.push(...erroresPadre(x.padre_id, existentes));
  return errores;
}

export function erroresModificarCentro(c: ContCentroCosto, x: Omit<CentroCostoInput, 'codigo'>, existentes: ContCentroCosto[]): string[] {
  return [
    ...sinNombre(x.nombre),
    ...(TIPOS_CENTRO.some(([k]) => k === x.tipo) ? [] : ['Tipo de centro de costo no válido.']),
    ...erroresPadre(x.padre_id, existentes, c.id),
  ];
}

export function erroresInactivarCentro(c: ContCentroCosto, todos: ContCentroCosto[], parametros: ContParametros): string[] {
  const errores: string[] = [];
  if (parametros.centro_costo_defecto_id === c.id) errores.push(`El centro ${c.codigo} es el centro por defecto de Parámetros (lo usan los asientos automáticos): primero se cambia en Compañía.`);
  const hijos = todos.filter((x) => x.padre_id === c.id && x.activo);
  if (hijos.length) errores.push(`El centro ${c.codigo} tiene centros activos que dependen de él (${hijos.map((h) => h.codigo).join(', ')}): se inactivan primero.`);
  return errores;
}

export function erroresActivarCentro(c: ContCentroCosto, todos: ContCentroCosto[]): string[] {
  const padre = c.padre_id ? todos.find((x) => x.id === c.padre_id) : undefined;
  return padre && !padre.activo ? [`El centro padre ${padre.codigo} está inactivo: se activa primero.`] : [];
}

/* ───────────── Auxiliares ───────────── */

export interface AuxiliarInput { tipo: TipoAuxiliar; codigo: string; nombre: string; rif: string }

const erroresRif = (rif: string) => (rif.trim() && !normalizarRif(rif) ? ['El RIF no tiene dígitos: se escribe como J-123456789.'] : []);

export function validarAuxiliar(x: AuxiliarInput, existentes: ContAuxiliar[]): string[] {
  const errores: string[] = [];
  const codigo = mayus(x.codigo);
  if (!TIPOS_AUXILIAR.some(([k]) => k === x.tipo)) errores.push('Tipo de auxiliar no válido.');
  if (!codigo) errores.push('Código requerido.');
  else if (existentes.some((a) => a.tipo === x.tipo && a.codigo === codigo)) errores.push(`Ya existe el auxiliar ${codigo} entre los de tipo ${nombreTipoAuxiliar(x.tipo)}.`);
  errores.push(...sinNombre(x.nombre), ...erroresRif(x.rif));
  return errores;
}

/** Modificar: nombre y RIF; el tipo y el código no cambian (Galac tiene «Cambiar Código» aparte). */
export const erroresModificarAuxiliar = (x: Pick<AuxiliarInput, 'nombre' | 'rif'>): string[] => [...sinNombre(x.nombre), ...erroresRif(x.rif)];

/** Cómo se guarda: código en mayúsculas, nombre sin espacios de más, RIF «LETRA-DÍGITOS» o nulo. */
export const normalizarAuxiliar = (x: AuxiliarInput) => ({ tipo: x.tipo, codigo: mayus(x.codigo), nombre: x.nombre.trim().toUpperCase(), rif: normalizarRif(x.rif) || null });

/* ───────────── Monedas, países y monedas locales ───────────── */

export interface MonedaInput { codigo: string; nombre: string; simbolo: string }

export function validarMoneda(x: MonedaInput, existentes: ContMoneda[]): string[] {
  const codigo = mayus(x.codigo);
  const errores: string[] = [];
  if (!/^[A-Z0-9]{3,4}$/.test(codigo)) errores.push('El código de la moneda son 3 o 4 letras o dígitos (por ejemplo, EUR o USDT).');
  else if (existentes.some((m) => m.codigo === codigo)) errores.push(`Ya existe la moneda ${codigo}.`);
  return [...errores, ...sinNombre(x.nombre)];
}

export function erroresInactivarMoneda(m: ContMoneda, parametros: ContParametros, locales: ContMonedaLocal[]): string[] {
  const errores: string[] = [];
  if (m.codigo === parametros.moneda_funcional || m.codigo === parametros.moneda_referencia) {
    errores.push(`La moneda ${m.codigo} es la ${m.codigo === parametros.moneda_funcional ? 'funcional' : 'de referencia'} de la compañía: no se inactiva.`);
  }
  const usada = locales.filter((l) => l.activo && l.codigo_moneda === m.codigo);
  if (usada.length) errores.push(`La moneda ${m.codigo} es la moneda local de ${usada.map((l) => l.codigo_pais).join(', ')}: primero se inactiva esa moneda local.`);
  return errores;
}

export interface PaisInput { codigo: string; nombre: string }

export function validarPais(x: PaisInput, existentes: ContPais[]): string[] {
  const codigo = mayus(x.codigo);
  const errores: string[] = [];
  if (!/^[A-Z]{2}$/.test(codigo)) errores.push('El código del país son 2 letras (ISO, por ejemplo VE).');
  else if (existentes.some((p) => p.codigo === codigo)) errores.push(`Ya existe el país ${codigo}.`);
  return [...errores, ...sinNombre(x.nombre)];
}

/** La vigencia abierta de Galac: el valor por defecto de cont_monedas_locales.vigencia_hasta. */
export const VIGENCIA_ABIERTA = '2079-06-06';

/** La clave de una moneda local (la PK del DDL v0.8): país, moneda y vigencia desde. */
export const claveMonedaLocal = (l: Pick<ContMonedaLocal, 'codigo_pais' | 'codigo_moneda' | 'vigencia_desde'>): string =>
  `${l.codigo_pais}|${l.codigo_moneda}|${l.vigencia_desde}`;

export interface MonedaLocalInput {
  codigo_pais: string; codigo_moneda: string; factor_conversion: number;
  /** Vacío = ninguna. */
  codigo_moneda_anterior: string | null;
  vigencia_desde: string;
  /** Vacío = la vigencia abierta (06/06/2079). */
  vigencia_hasta: string;
}

/** Como se guarda: sin «hasta», la vigencia abierta; sin moneda anterior, nulo. */
export const normalizarMonedaLocal = (x: MonedaLocalInput): Omit<ContMonedaLocal, 'activo'> => ({
  codigo_pais: x.codigo_pais.trim().toUpperCase(), codigo_moneda: x.codigo_moneda.trim().toUpperCase(), factor_conversion: x.factor_conversion,
  codigo_moneda_anterior: x.codigo_moneda_anterior?.trim() ? x.codigo_moneda_anterior.trim().toUpperCase() : null,
  vigencia_desde: x.vigencia_desde, vigencia_hasta: x.vigencia_hasta || VIGENCIA_ABIERTA,
});

/** `propia`: la clave de la fila que se modifica o se activa (no choca consigo misma). */
export function validarMonedaLocal(entrada: MonedaLocalInput, existentes: ContMonedaLocal[], paises: ContPais[], monedas: ContMoneda[], propia?: string): string[] {
  const x = normalizarMonedaLocal(entrada);
  const errores: string[] = [];
  if (!paises.some((p) => p.codigo === x.codigo_pais && p.activo)) errores.push(`El país ${x.codigo_pais || '(vacío)'} no existe o está inactivo.`);
  if (!monedas.some((m) => m.codigo === x.codigo_moneda)) errores.push(`La moneda ${x.codigo_moneda || '(vacía)'} no existe en Moneda.`);
  if (x.codigo_moneda_anterior && !monedas.some((m) => m.codigo === x.codigo_moneda_anterior)) errores.push(`La moneda anterior ${x.codigo_moneda_anterior} no existe en Moneda.`);
  if (!(x.factor_conversion >= 0)) errores.push('El factor de conversión no puede ser negativo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.vigencia_desde)) errores.push('La vigencia «desde» es obligatoria.');
  else if (x.vigencia_desde > x.vigencia_hasta) errores.push('La vigencia «desde» es posterior a la vigencia «hasta».');
  else {
    const otras = existentes.filter((l) => claveMonedaLocal(l) !== propia);
    if (otras.some((l) => claveMonedaLocal(l) === claveMonedaLocal(x))) {
      errores.push(`Ya existe la moneda local ${x.codigo_moneda} de ${x.codigo_pais} con vigencia desde ${x.vigencia_desde}.`);
    } else {
      const choca = otras.find((l) => l.activo && l.codigo_pais === x.codigo_pais && l.vigencia_desde <= x.vigencia_hasta && x.vigencia_desde <= l.vigencia_hasta);
      if (choca) errores.push(`La vigencia se solapa con la de ${choca.codigo_moneda} (${choca.vigencia_desde} a ${choca.vigencia_hasta}) en ${x.codigo_pais}.`);
    }
  }
  return errores;
}

/* ───────────── Cambio ───────────── */

export interface CambioInput { moneda: string; fecha: string; tasa_ves: number }

export function validarCambio(x: CambioInput, existentes: ContCambio[], monedas: ContMoneda[], parametros: ContParametros, propioId?: string): string[] {
  const errores: string[] = [];
  if (!monedas.some((m) => m.codigo === x.moneda && m.activa)) errores.push(`La moneda ${x.moneda || '(vacía)'} no existe o está inactiva.`);
  else if (x.moneda === parametros.moneda_funcional) errores.push(`La moneda funcional (${x.moneda}) no lleva tasa: vale 1.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.fecha)) errores.push('Fecha de vigencia requerida.');
  if (!(x.tasa_ves > 0)) errores.push('El cambio tiene que ser mayor que cero (bolívares por unidad).');
  if (existentes.some((c) => c.id !== propioId && c.activo && c.moneda === x.moneda && c.fecha === x.fecha)) {
    errores.push(`Ya hay un cambio de ${x.moneda} para el ${x.fecha}: se modifica ese.`);
  }
  return errores;
}

/**
 * Las tasas con las que trabaja Contabilidad: las del sistema (cont_tasas) más las manuales (Cambio).
 * La manual MANDA en su fecha (Master, 29/10 05:13): si las dos caen el mismo día, queda la manual. Lo
 * demás no cambia: el motor y el cierre buscan la del día o la última de los 7 días previos sobre esta
 * unión, así que la manual vale hasta la siguiente, dentro de ese tope.
 */
export function tasasConCambios<T extends { moneda: string; fecha: string }>(tasas: T[], cambios: ContCambio[], comoTasa: (c: ContCambio) => T): T[] {
  const activos = cambios.filter((c) => c.activo);
  const manual = new Set(activos.map((c) => `${c.moneda}|${c.fecha}`));
  return [...tasas.filter((t) => !manual.has(`${t.moneda}|${t.fecha}`)), ...activos.map(comoTasa)];
}

/* ───────────── Buscar ───────────── */

/** «Buscar» de Galac: sin acentos ni mayúsculas, en el código o el nombre. */
export function coincide(texto: string, ...campos: Array<string | null | undefined>): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const q = n(texto);
  return !q || campos.some((c) => c && n(c).includes(q));
}
