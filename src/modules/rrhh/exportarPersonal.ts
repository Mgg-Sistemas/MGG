/* ============================================================
   MGG · RRHH · Exportar los datos del personal (05-10-2026)

   El usuario marca con casillas QUÉ datos quiere (por ejemplo, solo
   nombre y cédula) y a QUIÉNES, y lo descarga en Excel o en PDF para
   imprimir. Acá vive la parte pura: qué campos hay y cómo se arma cada
   fila. Los archivos se generan en `exportarPersonalArchivos.ts`.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';
import { antiguedad, labelEstadoCivil, labelGenero, labelGradoInstruccion, textoEdad } from './fichaPersonal';

export type GrupoCampo = 'identidad' | 'trabajo' | 'personales' | 'contacto' | 'salud';

export interface CampoExport {
  key: string;
  label: string;
  grupo: GrupoCampo;
  /** Ancho sugerido en Excel (caracteres). */
  ancho: number;
  valor: (p: Personal) => string | number;
}

export const GRUPOS_CAMPO: { key: GrupoCampo; label: string }[] = [
  { key: 'identidad', label: 'Identificación' },
  { key: 'trabajo', label: 'Trabajo' },
  { key: 'personales', label: 'Datos personales' },
  { key: 'contacto', label: 'Contacto' },
  { key: 'salud', label: 'Salud' },
];

const t = (v: unknown): string => (v == null ? '' : String(v).trim());
/** dd/mm/aaaa sin pasar por zona horaria (las fechas de la ficha son días, no instantes). */
export function fechaCorta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
const siNo = (b: boolean | null | undefined, detalle: string | null | undefined): string =>
  b == null ? '' : b ? `Sí${t(detalle) ? `: ${t(detalle)}` : ''}` : 'No';

export const CAMPOS_EXPORT: CampoExport[] = [
  { key: 'numero_ficha', label: 'N° ficha', grupo: 'identidad', ancho: 10, valor: (p) => t(p.numero_ficha) },
  { key: 'nombre_completo', label: 'Nombre y apellido', grupo: 'identidad', ancho: 32, valor: (p) => `${t(p.nombre)} ${t(p.apellido)}`.trim() },
  { key: 'nombre', label: 'Nombres', grupo: 'identidad', ancho: 20, valor: (p) => t(p.nombre) },
  { key: 'apellido', label: 'Apellidos', grupo: 'identidad', ancho: 20, valor: (p) => t(p.apellido) },
  { key: 'cedula', label: 'Cédula', grupo: 'identidad', ancho: 14, valor: (p) => t(p.cedula) },
  { key: 'rif', label: 'RIF', grupo: 'identidad', ancho: 16, valor: (p) => t(p.rif) },

  { key: 'cargo', label: 'Cargo', grupo: 'trabajo', ancho: 22, valor: (p) => t(p.cargo) },
  { key: 'departamento', label: 'Departamento', grupo: 'trabajo', ancho: 20, valor: (p) => t(p.departamento) },
  { key: 'fecha_ingreso', label: 'Fecha de ingreso', grupo: 'trabajo', ancho: 14, valor: (p) => fechaCorta(p.fecha_ingreso) },
  { key: 'antiguedad', label: 'Antigüedad', grupo: 'trabajo', ancho: 16, valor: (p) => (p.fecha_ingreso ? antiguedad(p.fecha_ingreso) : '') },
  { key: 'estado', label: 'Estado', grupo: 'trabajo', ancho: 10, valor: (p) => (p.activo ? 'Activo' : 'Inactivo') },
  { key: 'sueldo_base', label: 'Sueldo mensual ($)', grupo: 'trabajo', ancho: 14, valor: (p) => Number(p.sueldo_base) || 0 },

  { key: 'genero', label: 'Género', grupo: 'personales', ancho: 11, valor: (p) => (p.genero ? labelGenero(p.genero) : '') },
  { key: 'estado_civil', label: 'Estado civil', grupo: 'personales', ancho: 12, valor: (p) => (p.estado_civil ? labelEstadoCivil(p.estado_civil) : '') },
  { key: 'fecha_nacimiento', label: 'Fecha de nacimiento', grupo: 'personales', ancho: 14, valor: (p) => fechaCorta(p.fecha_nacimiento) },
  { key: 'edad', label: 'Edad', grupo: 'personales', ancho: 8, valor: (p) => (p.fecha_nacimiento ? textoEdad(p.fecha_nacimiento) : '') },
  { key: 'nacionalidad', label: 'Nacionalidad', grupo: 'personales', ancho: 14, valor: (p) => t(p.nacionalidad) },
  { key: 'grado_instruccion', label: 'Grado de instrucción', grupo: 'personales', ancho: 18, valor: (p) => (p.grado_instruccion ? labelGradoInstruccion(p.grado_instruccion) : '') },
  { key: 'titulo_obtenido', label: 'Título', grupo: 'personales', ancho: 22, valor: (p) => t(p.titulo_obtenido) },

  { key: 'telefono', label: 'Teléfono', grupo: 'contacto', ancho: 15, valor: (p) => t(p.telefono) },
  { key: 'correo', label: 'Correo', grupo: 'contacto', ancho: 26, valor: (p) => t(p.correo) },
  { key: 'direccion', label: 'Dirección', grupo: 'contacto', ancho: 34, valor: (p) => t(p.direccion) },
  { key: 'contacto_emergencia', label: 'Contacto de emergencia', grupo: 'contacto', ancho: 22, valor: (p) => t(p.contacto_emergencia) },
  { key: 'contacto_emergencia_parentesco', label: 'Parentesco (emergencia)', grupo: 'contacto', ancho: 14, valor: (p) => t(p.contacto_emergencia_parentesco) },
  { key: 'contacto_emergencia_tlf', label: 'Teléfono de emergencia', grupo: 'contacto', ancho: 15, valor: (p) => t(p.contacto_emergencia_tlf) },

  { key: 'grupo_sanguineo', label: 'Grupo sanguíneo', grupo: 'salud', ancho: 10, valor: (p) => t(p.grupo_sanguineo) },
  { key: 'alergias', label: 'Alergias', grupo: 'salud', ancho: 22, valor: (p) => siNo(p.tiene_alergias, p.alergias_detalle) },
  { key: 'enfermedad', label: 'Enfermedades', grupo: 'salud', ancho: 22, valor: (p) => siNo(p.tiene_enfermedad, p.enfermedad_detalle) },
];

/** Lo que viene marcado la primera vez: nombre y cédula. */
export const CAMPOS_POR_DEFECTO = ['nombre_completo', 'cedula'];

/** Los campos elegidos, en el orden de la lista (no en el orden en que se marcaron). */
export function camposElegidos(keys: readonly string[]): CampoExport[] {
  const set = new Set(keys);
  return CAMPOS_EXPORT.filter((c) => set.has(c.key));
}

/** Encabezado y filas listos para Excel o PDF. La primera columna es el N° de ítem. */
export function tablaExport(personas: readonly Personal[], keys: readonly string[]): { head: string[]; filas: (string | number)[][] } {
  const campos = camposElegidos(keys);
  return {
    head: ['N°', ...campos.map((c) => c.label)],
    filas: personas.map((p, i) => [i + 1, ...campos.map((c) => c.valor(p))]),
  };
}
