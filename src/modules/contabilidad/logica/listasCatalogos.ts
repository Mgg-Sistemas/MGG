/* ============================================================
   MGG · Contabilidad · Las listas de la ventana «Auxiliares y Otros»
   (lógica pura)

   La ventana de tablas de Galac (galac-capturas-A.md, photo_19): un panel
   lateral con Auxiliar · Cambio · Centro De Costos · Moneda · Moneda Local
   · País · Tipo de Comprobante, y a la derecha la rejilla de la tabla
   elegida, con «Buscar» y paginada («Página 1 de 2»). Aquí están las
   columnas y las filas de cada tabla, ya en texto: las comparten la
   pantalla y «Imprimir Lista», así que lo que se ve es lo que se imprime.
   Las reglas de alta, modificación e inactivación están en catalogos.ts.
   ============================================================ */

import { claveMonedaLocal, coincide, esTipoDelSistema, nombreTipoAuxiliar, nombreTipoCentro, ORIGENES_TIPO } from './catalogos';
import type {
  ContAuxiliar, ContCambio, ContCentroCosto, ContMoneda, ContMonedaLocal, ContPais, ContTipoComprobante,
} from '../tipos';

export type TablaCatalogo = 'auxiliar' | 'cambio' | 'centro' | 'moneda' | 'moneda_local' | 'pais' | 'tipo';

/** En el orden del panel de Galac. */
export const TABLAS_CATALOGO: ReadonlyArray<{ clave: TablaCatalogo; titulo: string; singular: string }> = [
  { clave: 'auxiliar', titulo: 'Auxiliar', singular: 'auxiliar' },
  { clave: 'cambio', titulo: 'Cambio', singular: 'cambio' },
  { clave: 'centro', titulo: 'Centro De Costos', singular: 'centro de costos' },
  { clave: 'moneda', titulo: 'Moneda', singular: 'moneda' },
  { clave: 'moneda_local', titulo: 'Moneda Local', singular: 'moneda local' },
  { clave: 'pais', titulo: 'País', singular: 'país' },
  { clave: 'tipo', titulo: 'Tipo de Comprobante', singular: 'tipo de comprobante' },
];

export const tituloTabla = (t: TablaCatalogo): string => TABLAS_CATALOGO.find((x) => x.clave === t)!.titulo;

export interface DatosCatalogos {
  auxiliares: ContAuxiliar[];
  cambios: ContCambio[];
  centros: ContCentroCosto[];
  monedas: ContMoneda[];
  monedasLocales: ContMonedaLocal[];
  paises: ContPais[];
  tipos: ContTipoComprobante[];
}

export interface FilaCatalogo {
  /** El id de la fila (en Moneda y País, el código; en Moneda Local, país|moneda|desde). */
  id: string;
  celdas: string[];
  activo: boolean;
  /** Del sistema: no se modifica ni se inactiva (tipos 90-98 y los de proceso). */
  sistema: boolean;
}

const fecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
/** Tasas y factores con hasta 4 decimales, como los guarda el sistema. */
const decimal = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const estado = (activo: boolean) => (activo ? 'Activo' : 'Inactivo');

const COLUMNAS: Record<TablaCatalogo, string[]> = {
  auxiliar: ['Tipo', 'Código', 'Nombre', 'RIF', 'Estado'],
  cambio: ['Moneda', 'Fecha', 'Cambio (Bs por unidad)', 'Estado'],
  centro: ['Código', 'Nombre', 'Tipo', 'Depende de', 'Estado'],
  moneda: ['Código', 'Nombre', 'Símbolo', 'Estado'],
  moneda_local: ['País', 'Moneda', 'Factor de Conversión', 'Moneda Anterior', 'Vigencia Desde', 'Vigencia Hasta', 'Estado'],
  pais: ['Código', 'Nombre', 'Estado'],
  tipo: ['Código', 'Nombre', 'Origen', 'Estado'],
};

export const columnasDe = (t: TablaCatalogo): string[] => COLUMNAS[t];

/** Las columnas numéricas (van a la derecha). */
export const columnasNumericas = (t: TablaCatalogo): number[] => (t === 'cambio' ? [2] : t === 'moneda_local' ? [2] : []);

export function filasDe(t: TablaCatalogo, d: DatosCatalogos): FilaCatalogo[] {
  switch (t) {
    case 'auxiliar':
      return [...d.auxiliares]
        .sort((a, b) => a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo))
        .map((a) => ({ id: a.id, celdas: [nombreTipoAuxiliar(a.tipo), a.codigo, a.nombre, a.rif ?? '', estado(a.activo)], activo: a.activo, sistema: false }));
    case 'cambio':
      return [...d.cambios]
        .sort((a, b) => a.moneda.localeCompare(b.moneda) || b.fecha.localeCompare(a.fecha))
        .map((c) => ({ id: c.id, celdas: [c.moneda, fecha(c.fecha), decimal(c.tasa_ves), estado(c.activo)], activo: c.activo, sistema: false }));
    case 'centro': {
      const codigo = new Map(d.centros.map((c) => [c.id, c.codigo]));
      return [...d.centros]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((c) => ({
          id: c.id, celdas: [c.codigo, c.nombre, nombreTipoCentro(c.tipo), c.padre_id ? codigo.get(c.padre_id) ?? '' : '', estado(c.activo)],
          activo: c.activo, sistema: false,
        }));
    }
    case 'moneda':
      return [...d.monedas]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((m) => ({ id: m.codigo, celdas: [m.codigo, m.nombre, m.simbolo, estado(m.activa)], activo: m.activa, sistema: false }));
    case 'moneda_local':
      return [...d.monedasLocales]
        .sort((a, b) => a.codigo_pais.localeCompare(b.codigo_pais) || a.vigencia_desde.localeCompare(b.vigencia_desde))
        .map((l) => ({
          id: claveMonedaLocal(l),
          celdas: [l.codigo_pais, l.codigo_moneda, decimal(l.factor_conversion), l.codigo_moneda_anterior ?? '', fecha(l.vigencia_desde), fecha(l.vigencia_hasta), estado(l.activo)],
          activo: l.activo, sistema: false,
        }));
    case 'pais':
      return [...d.paises]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((p) => ({ id: p.codigo, celdas: [p.codigo, p.nombre, estado(p.activo)], activo: p.activo, sistema: false }));
    case 'tipo':
      return [...d.tipos]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((x) => ({
          id: x.id,
          celdas: [x.codigo, x.nombre, ORIGENES_TIPO.find(([k]) => k === x.origen)?.[1] ?? x.origen, estado(x.activo)],
          activo: x.activo, sistema: x.sistema || esTipoDelSistema(x.codigo),
        }));
  }
}

/** «Buscar» de Galac sobre cualquier columna, sin acentos ni mayúsculas; los inactivos solo si se piden. */
export function filtrarFilas(filas: FilaCatalogo[], texto: string, verInactivos: boolean): FilaCatalogo[] {
  return filas.filter((f) => (verInactivos || f.activo) && coincide(texto, ...f.celdas));
}

/** Filas por página de la rejilla. */
export const FILAS_POR_PAGINA = 20;

export function paginar<T>(filas: T[], pagina: number): { filas: T[]; pagina: number; paginas: number } {
  const paginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_PAGINA));
  const p = Math.min(Math.max(0, pagina), paginas - 1);
  return { filas: filas.slice(p * FILAS_POR_PAGINA, (p + 1) * FILAS_POR_PAGINA), pagina: p, paginas };
}
