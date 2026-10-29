/* ============================================================
   MGG · Contabilidad · Plan de cuentas (lógica pura)

   El árbol se deriva del código: el padre de «1.1.01.01.001» es
   «1.1.01.01». cont_cuentas guarda además padre_id (modelo v0), pero el
   repositorio lo asigna SIEMPRE desde el código, así nunca quedan en
   desacuerdo; si la base algún día los separa, construirArbol sigue
   funcionando con el código.

   Reglas (las de cualquier plan de cuentas):
   · Cada segmento tiene los dígitos que fija la máscara de Parámetros.
   · Una cuenta de nivel > 1 necesita a su padre, y el padre es de título.
   · Una cuenta de movimiento no tiene hijas: es la que recibe asientos.
   · En el último nivel solo hay cuentas de movimiento.
   · El código no se repite.
   ============================================================ */

import type { ClaseCuenta, ContCuenta, CuentaInput, Naturaleza } from '../tipos';

export const segmentos = (codigo: string): string[] => codigo.split('.').filter((s) => s !== '');

export const nivelDe = (codigo: string): number => segmentos(codigo).length;

/** El código del padre, o null en el nivel 1. */
export function codigoPadre(codigo: string): string | null {
  const s = segmentos(codigo);
  return s.length > 1 ? s.slice(0, -1).join('.') : null;
}

/** Ordena por segmentos numéricos: «1.1.02» va antes que «1.1.10» y que «1.2». */
export function compararCodigos(a: string, b: string): number {
  const sa = segmentos(a);
  const sb = segmentos(b);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    const d = Number(sa[i]) - Number(sb[i]);
    if (d !== 0) return d;
  }
  return sa.length - sb.length;
}

/** «9.9.99.99.999» → [1, 1, 2, 2, 3]. */
export const formatoDeMascara = (mascara: string): number[] => mascara.split('.').filter(Boolean).map((g) => g.length);

/** Límites de Galac (F1 p.54-55): hasta 10 niveles y un código de hasta 20 dígitos. */
/** DDL v0.8: cont_parametros.niveles y cont_cuentas.nivel van de 1 a 5 (usuario, 29/10 04:40). */
export const MAX_NIVELES = 5;
export const MAX_DIGITOS = 20;

/** El error de una máscara de niveles, o null si se puede usar. */
export function errorDeMascara(mascara: string): string | null {
  if (!/^9+(\.9+)*$/.test(mascara.trim())) return 'La máscara se escribe con nueves separados por punto, p. ej. 9.9.99.999.';
  const f = formatoDeMascara(mascara);
  if (f.length > MAX_NIVELES) return `La máscara admite ${MAX_NIVELES} niveles como máximo.`;
  const digitos = f.reduce((a, b) => a + b, 0);
  if (digitos > MAX_DIGITOS) return `El código admite ${MAX_DIGITOS} dígitos como máximo (la máscara suma ${digitos}).`;
  return null;
}

/** Galac muestra la naturaleza como Debe / Haber (F1 p.69). */
export const NOMBRE_NATURALEZA: Record<Naturaleza, string> = { deudora: 'Debe', acreedora: 'Haber' };

const CLASE_POR_GRUPO: Record<string, ClaseCuenta> = {
  '1': 'activo', '2': 'pasivo', '3': 'patrimonio', '4': 'ingreso', '5': 'costo', '6': 'gasto',
};

/** La clase que sugiere el primer dígito; del 7 en adelante, cuentas de orden. */
export const claseSugerida = (codigo: string): ClaseCuenta => CLASE_POR_GRUPO[segmentos(codigo)[0]] ?? 'orden';

/** Activo, costo y gasto son deudoras; pasivo, patrimonio e ingreso, acreedoras. Las excepciones (depreciación acumulada) se marcan a mano. */
export function naturalezaSugerida(clase: ClaseCuenta): Naturaleza {
  return clase === 'pasivo' || clase === 'patrimonio' || clase === 'ingreso' ? 'acreedora' : 'deudora';
}

export const NOMBRE_CLASE: Record<ClaseCuenta, string> = {
  activo: 'Activo', pasivo: 'Pasivo', patrimonio: 'Patrimonio', ingreso: 'Ingresos',
  costo: 'Costos', gasto: 'Gastos', orden: 'Cuentas de orden',
};

/** El error del formato del código, o null si está bien. */
export function errorDeFormato(codigo: string, mascara: string): string | null {
  const formato = formatoDeMascara(mascara);
  const c = codigo.trim();
  if (!c) return 'Código requerido.';
  if (!/^[0-9.]+$/.test(c)) return 'El código solo admite dígitos separados por punto.';
  const s = c.split('.');
  if (s.some((x) => x === '')) return 'El código tiene un segmento vacío.';
  if (s.length > formato.length) return `El plan admite ${formato.length} niveles como máximo.`;
  for (let i = 0; i < s.length; i++) {
    if (s[i].length !== formato[i]) {
      return `El nivel ${i + 1} lleva ${formato[i]} dígito(s) (máscara ${mascara}).`;
    }
  }
  return null;
}

/** Errores de una cuenta nueva frente al plan actual. Vacío = se puede crear. */
export function validarNuevaCuenta(input: CuentaInput, plan: ContCuenta[], mascara: string): string[] {
  const errores: string[] = [];
  const codigo = input.codigo.trim();
  const formatoMal = errorDeFormato(codigo, mascara);
  if (formatoMal) errores.push(formatoMal);
  if (!input.nombre.trim()) errores.push('Nombre requerido.');
  if (input.exige_auxiliar && !input.tipo_auxiliar) errores.push('Indica el tipo de auxiliar que exige la cuenta.');
  if (!input.es_movimiento && (input.exige_centro_costo || input.exige_auxiliar)) {
    errores.push('Una cuenta de título no recibe asientos: no exige centro de costo ni auxiliar.');
  }
  if (formatoMal) return errores;

  if (plan.some((c) => c.codigo === codigo)) errores.push(`Ya existe la cuenta ${codigo}.`);
  const padre = codigoPadre(codigo);
  if (padre) {
    const p = plan.find((c) => c.codigo === padre);
    if (!p) errores.push(`No existe la cuenta padre ${padre}: se crea primero.`);
    else if (p.es_movimiento) errores.push(`La cuenta padre ${padre} es de movimiento y no admite subcuentas.`);
    else if (!p.activa) errores.push(`La cuenta padre ${padre} está inactiva.`);
  }
  if (!input.es_movimiento && nivelDe(codigo) === formatoDeMascara(mascara).length) {
    errores.push('En el último nivel solo hay cuentas de movimiento.');
  }
  return errores;
}

export interface NodoCuenta {
  cuenta: ContCuenta;
  hijos: NodoCuenta[];
}

/** El árbol del plan. Una cuenta cuyo padre no está queda en la raíz, para que no desaparezca. */
export function construirArbol(plan: ContCuenta[]): NodoCuenta[] {
  const ordenadas = [...plan].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  const porCodigo = new Map<string, NodoCuenta>();
  const raiz: NodoCuenta[] = [];
  for (const cuenta of ordenadas) {
    const nodo: NodoCuenta = { cuenta, hijos: [] };
    porCodigo.set(cuenta.codigo, nodo);
    const padre = codigoPadre(cuenta.codigo);
    const nodoPadre = padre ? porCodigo.get(padre) : undefined;
    if (nodoPadre) nodoPadre.hijos.push(nodo);
    else raiz.push(nodo);
  }
  return raiz;
}

export const normalizarTexto = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filtra el árbol por código o nombre, sin acentos. Una cuenta que coincide
 * se muestra con sus ancestros (para saber dónde está) y con todas sus hijas.
 */
export function filtrarArbol(nodos: NodoCuenta[], texto: string): NodoCuenta[] {
  const q = normalizarTexto(texto.trim());
  if (!q) return nodos;
  const filtrar = (lista: NodoCuenta[]): NodoCuenta[] => {
    const out: NodoCuenta[] = [];
    for (const n of lista) {
      const coincide = n.cuenta.codigo.startsWith(q) || normalizarTexto(n.cuenta.nombre).includes(q);
      if (coincide) { out.push(n); continue; }
      const hijos = filtrar(n.hijos);
      if (hijos.length) out.push({ ...n, hijos });
    }
    return out;
  };
  return filtrar(nodos);
}

/** Los códigos de todos los nodos con hijas: sirve para «Expandir todo». */
export function codigosConHijos(nodos: NodoCuenta[]): string[] {
  const out: string[] = [];
  const recorrer = (lista: NodoCuenta[]) => {
    for (const n of lista) {
      if (n.hijos.length) { out.push(n.cuenta.codigo); recorrer(n.hijos); }
    }
  };
  recorrer(nodos);
  return out;
}

/** Los códigos con hijas hasta un nivel: «Expandir hasta el nivel 2». */
export const codigosHastaNivel = (nodos: NodoCuenta[], nivel: number): string[] =>
  codigosConHijos(nodos).filter((c) => nivelDe(c) < nivel);

export interface ResumenPlan {
  total: number;
  titulos: number;
  movimiento: number;
  inactivas: number;
  niveles: number;
}

export function resumenPlan(plan: ContCuenta[]): ResumenPlan {
  return {
    total: plan.length,
    titulos: plan.filter((c) => !c.es_movimiento).length,
    movimiento: plan.filter((c) => c.es_movimiento).length,
    inactivas: plan.filter((c) => !c.activa).length,
    niveles: plan.reduce((m, c) => Math.max(m, c.nivel), 0),
  };
}

/** El código que sigue entre las hijas de un título: «1.1.01.01» con «.001» y «.002» → «1.1.01.01.003». */
export function siguienteCodigoHijo(padre: string, plan: ContCuenta[], mascara: string): string | null {
  const formato = formatoDeMascara(mascara);
  const nivelHijo = nivelDe(padre) + 1;
  if (nivelHijo > formato.length) return null;
  const digitos = formato[nivelHijo - 1];
  const usados = plan
    .filter((c) => codigoPadre(c.codigo) === padre)
    .map((c) => Number(segmentos(c.codigo)[nivelHijo - 1]));
  const siguiente = (usados.length ? Math.max(...usados) : 0) + 1;
  if (String(siguiente).length > digitos) return null;
  return `${padre}.${String(siguiente).padStart(digitos, '0')}`;
}
