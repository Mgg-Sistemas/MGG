/* ============================================================
   Golden Touch · Proveedores · Actividad económica (CIIU · SENIAT) (14/10/2026)

   Catálogo compartido (tabla `actividades_economicas`): las secciones por rango
   (0100-0299 Agricultura…) y las actividades puntuales (5110, 7412…). Se elige
   al registrar la cotización en Compras y queda en la ficha del proveedor. Si
   no está, se agrega desde el mismo selector.
   ============================================================ */

export type TipoActividad = 'seccion' | 'actividad';

export interface ActividadEconomica {
  codigo: string;
  descripcion: string;
  tipo: TipoActividad;
  activa: boolean;
}

/** "0100 - 0299" → "0100-0299"; "5110" → "5110". Null si no es un código CIIU válido
 *  (4 dígitos, o un rango de dos códigos de 4 dígitos). */
export function normalizarCodigoActividad(raw: string): string | null {
  const s = (raw ?? '').replace(/\s+/g, '').replace(/[–—]/g, '-');
  return /^[0-9]{4}(-[0-9]{4})?$/.test(s) ? s : null;
}

/** Texto para listas y PDF: «5110 · Comercio al por mayor…». */
export function etiquetaActividad(a: Pick<ActividadEconomica, 'codigo' | 'descripcion' | 'tipo'>): string {
  return `${a.tipo === 'seccion' ? 'Sección ' : ''}${a.codigo} · ${a.descripcion}`;
}

/** Etiqueta de un código guardado (si ya no está en el catálogo, el código solo). */
export function textoActividad(codigo: string | null | undefined, lista: ActividadEconomica[]): string {
  if (!codigo) return '—';
  const a = lista.find((x) => x.codigo === codigo);
  return a ? etiquetaActividad(a) : codigo;
}

/** Por código: las secciones (rangos) y las actividades quedan intercaladas en su lugar. */
export function ordenarActividades(lista: ActividadEconomica[]): ActividadEconomica[] {
  return [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es-VE', { numeric: true }));
}

/** Revisa una actividad nueva antes de guardarla. Devuelve el error o null. */
export function validarActividadNueva(codigoRaw: string, descripcion: string, lista: ActividadEconomica[]): string | null {
  const codigo = normalizarCodigoActividad(codigoRaw);
  if (!codigo) return 'El código debe tener 4 dígitos (por ejemplo 5110), o ser un rango como 0100-0299.';
  if (descripcion.trim().length < 3) return 'Escribe la descripción de la actividad.';
  const ya = lista.find((a) => a.codigo === codigo);
  if (ya) return `El código ${codigo} ya existe: ${ya.descripcion}.`;
  return null;
}
