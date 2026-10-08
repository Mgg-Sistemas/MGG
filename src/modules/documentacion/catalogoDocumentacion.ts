/* ============================================================
   MGG · Documentación · Catálogos de la nota de envío (lógica pura)

   Lo que se escribe en una nota de envío se repite en la siguiente: la misma
   empresa, la misma persona de atención, la misma condición («Copias»), los
   mismos conceptos de renglón. Antes se ofrecían como sugerencias sacadas de
   las notas viejas; desde el 08-10-2026 son CATÁLOGOS: se agregan, se editan
   y se borran desde el módulo, y lo usado en una nota se recuerda solo.

   Acá vive lo que se puede probar sin pantalla: limpieza, validación y
   búsqueda. La base y los modales están en el repositorio y en los .tsx.
   ============================================================ */
import { norm } from './notaEnvio';

/** Los tres catálogos de texto de la nota de envío. */
export type ScopeCatalogoDoc = 'condicion' | 'concepto' | 'atencion';

export const SCOPES_CATALOGO_DOC: Array<{ key: ScopeCatalogoDoc; label: string; icon: string; ayuda: string }> = [
  { key: 'condicion', label: 'Condiciones', icon: '🏷', ayuda: 'En qué se entregan los documentos: copias, originales…' },
  { key: 'concepto', label: 'Conceptos de renglón', icon: '📋', ayuda: 'Lo que se escribe en «Descripción / concepto» de cada renglón.' },
  { key: 'atencion', label: 'Personas de atención', icon: '👤', ayuda: 'A quién va dirigida la entrega («Atención a»).' },
];

export function labelScopeCatalogoDoc(s: ScopeCatalogoDoc | string): string {
  return SCOPES_CATALOGO_DOC.find((x) => x.key === s)?.label ?? String(s);
}

/** Un renglón de cualquiera de los tres catálogos. */
export interface ItemCatalogoDocBase {
  scope: ScopeCatalogoDoc;
  nombre: string;
  usos?: number;
}

/** Espacios de más fuera; dobles espacios adentro, a uno. */
export function limpiarNombreCatalogo(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Por qué no se puede guardar ese nombre, o null si está bien. */
export function errorNombreCatalogo(nombre: unknown): string | null {
  const n = limpiarNombreCatalogo(nombre);
  if (!n) return 'Escribí el texto.';
  if (n.length > 200) return 'Es demasiado largo (máximo 200 caracteres).';
  return null;
}

/** ¿Ya existe ese nombre en ese catálogo? Sin distinguir mayúsculas ni acentos. */
export function existeEnCatalogo<T extends ItemCatalogoDocBase>(items: T[], scope: ScopeCatalogoDoc, nombre: unknown, exceptoId?: string): boolean {
  const n = norm(limpiarNombreCatalogo(nombre));
  return items.some((it) => it.scope === scope && norm(it.nombre) === n && (exceptoId == null || (it as { id?: string }).id !== exceptoId));
}

/** Busca por texto (todas las palabras, sin acentos). Los más usados primero. */
export function filtrarCatalogo<T extends ItemCatalogoDocBase>(items: T[], scope: ScopeCatalogoDoc, q: string): T[] {
  const palabras = norm(q).split(/\s+/).filter(Boolean);
  return items
    .filter((it) => it.scope === scope && palabras.every((p) => norm(it.nombre).includes(p)))
    .sort((a, b) => (b.usos ?? 0) - (a.usos ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

/* ───────── Destinatarios ───────── */

export interface DatosDestinatario {
  razon_social: string;
  rif?: string | null;
  direccion?: string | null;
  atencion_a?: string | null;
  telefono?: string | null;
}

/** Deja los campos prolijos: sin espacios de más, RIF en mayúsculas, vacíos a null. */
export function limpiarDestinatario(d: DatosDestinatario): Required<DatosDestinatario> {
  const t = (v: unknown) => limpiarNombreCatalogo(v) || null;
  return {
    razon_social: limpiarNombreCatalogo(d.razon_social),
    rif: t(d.rif)?.toUpperCase() ?? null,
    direccion: t(d.direccion),
    atencion_a: t(d.atencion_a),
    telefono: t(d.telefono),
  };
}

/** Por qué no se puede guardar el destinatario, o null si está bien. */
export function errorDestinatario(d: DatosDestinatario): string | null {
  const l = limpiarDestinatario(d);
  if (!l.razon_social) return 'La razón social / departamento es obligatoria.';
  if (l.razon_social.length > 200) return 'La razón social es demasiado larga.';
  return null;
}
