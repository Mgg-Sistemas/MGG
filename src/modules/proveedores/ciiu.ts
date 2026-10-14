/* ============================================================
   MGG · Proveedores · Actividad económica (código CIIU del SENIAT) (14-10-2026)

   El catálogo vive en la base (`actividades_economicas`): las secciones CIIU
   (rangos como «5000-5299») y los códigos puntuales («5110»). Acá está lo que
   no necesita la base: a qué sección pertenece un código, cómo se escribe en
   pantalla, qué se valida al agregar uno nuevo y cómo se arman las opciones
   del desplegable buscable.
   ============================================================ */
import type { SearchOption } from '@/shared/ui/SearchSelect';

export interface ActividadEconomica {
  /** «5110» o una sección «5000-5299». */
  codigo: string;
  descripcion: string;
  activa: boolean;
}

/** Las secciones CIIU, por rango de códigos (estructura del SENIAT). */
export const SECCIONES_CIIU: { desde: number; hasta: number; nombre: string }[] = [
  { desde: 100, hasta: 299, nombre: 'Agricultura, Ganadería, Caza y Silvicultura' },
  { desde: 500, hasta: 599, nombre: 'Pesca y Acuicultura' },
  { desde: 1000, hasta: 1499, nombre: 'Explotación de Minas y Canteras' },
  { desde: 1500, hasta: 3799, nombre: 'Industrias Manufactureras' },
  { desde: 4000, hasta: 4199, nombre: 'Suministros de Electricidad, Gas y Agua' },
  { desde: 4500, hasta: 4599, nombre: 'Construcción' },
  { desde: 5000, hasta: 5299, nombre: 'Comercio al por Mayor y al por Menor; Reparación de Vehículos' },
  { desde: 5500, hasta: 5599, nombre: 'Hoteles y Restaurantes' },
  { desde: 6000, hasta: 6499, nombre: 'Transporte, Almacenamiento y Comunicaciones' },
  { desde: 6500, hasta: 6799, nombre: 'Intermediación Financiera y Seguros' },
  { desde: 7000, hasta: 7499, nombre: 'Actividades Inmobiliarias, Empresariales y de Alquiler' },
  { desde: 7500, hasta: 7599, nombre: 'Administración Pública y Defensa' },
  { desde: 8000, hasta: 8099, nombre: 'Educación' },
  { desde: 8500, hasta: 8599, nombre: 'Servicios Sociales y de Salud' },
  { desde: 9000, hasta: 9399, nombre: 'Otras Actividades de Servicios Comunitarios, Sociales y Personales' },
  { desde: 9500, hasta: 9599, nombre: 'Hogares Privados con Servicio Doméstico' },
  { desde: 9900, hasta: 9999, nombre: 'Organizaciones y Órganos Extraterritoriales' },
];

/** ¿Es una sección (rango) o un código puntual? */
export const esSeccion = (codigo: string) => /^\d{4}-\d{4}$/.test(codigo);

/** Solo dígitos y el guion del rango; «5110», «5000-5299». No rellena con ceros: el código se escribe completo. */
export function normalizarCodigoCiiu(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().replace(/[^0-9-]/g, '').slice(0, 9);
}

export const codigoCiiuValido = (codigo: string) => /^\d{4}(-\d{4})?$/.test(codigo);

/** La sección a la que pertenece un código (o la del inicio del rango). */
export function seccionDeCodigo(codigo: string): string | null {
  const n = Number(codigo.slice(0, 4));
  if (!Number.isFinite(n)) return null;
  return SECCIONES_CIIU.find((s) => n >= s.desde && n <= s.hasta)?.nombre ?? null;
}

/** «5110 · Comercio al por mayor…» (lo que se lee en pantalla y en los PDF). */
export function etiquetaActividad(a: Pick<ActividadEconomica, 'codigo' | 'descripcion'> | null | undefined): string {
  if (!a) return '';
  return `${a.codigo} · ${a.descripcion}`;
}

/** El texto de un código guardado, buscándolo en la lista; si no está, el código pelado. */
export function textoActividad(codigo: string | null | undefined, lista: ActividadEconomica[]): string {
  if (!codigo) return '';
  const a = lista.find((x) => x.codigo === codigo);
  return a ? etiquetaActividad(a) : codigo;
}

/** Opciones del desplegable: puntuales primero (son las que más se usan), después las secciones; se busca por código, descripción o sección. */
export function opcionesActividades(lista: ActividadEconomica[], valorActual?: string | null): SearchOption[] {
  const visibles = lista.filter((a) => a.activa || a.codigo === valorActual);
  const puntuales = visibles.filter((a) => !esSeccion(a.codigo)).sort((a, b) => a.codigo.localeCompare(b.codigo));
  const secciones = visibles.filter((a) => esSeccion(a.codigo)).sort((a, b) => a.codigo.localeCompare(b.codigo));
  return [...puntuales, ...secciones].map((a) => ({
    value: a.codigo,
    label: etiquetaActividad(a),
    hint: esSeccion(a.codigo) ? 'Sección CIIU' : (seccionDeCodigo(a.codigo) ?? undefined),
    keywords: [a.codigo, a.descripcion, seccionDeCodigo(a.codigo) ?? ''],
  }));
}

/** Qué está mal al agregar una actividad nueva, o null si se puede guardar. */
export function validarActividadNueva(codigo: string, descripcion: string, existentes: ActividadEconomica[]): string | null {
  const c = normalizarCodigoCiiu(codigo);
  if (!codigoCiiuValido(c)) return 'El código CIIU lleva 4 dígitos (ej.: 4520) o un rango (ej.: 4500-4599).';
  if (existentes.some((a) => a.codigo === c)) return `El código ${c} ya está en el catálogo: elígelo de la lista.`;
  if (descripcion.trim().length < 3) return 'Indica la descripción de la actividad.';
  return null;
}
