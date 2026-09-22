/* ============================================================
   MGG · RRHH · Documentación del trabajador

   Los papeles de cada persona: el RIF, la cédula y el currículum. Las reglas
   de qué se acepta y qué falta viven acá, sin base de datos y sin pantalla,
   para poder probarlas.

   POR QUÉ SOLO PDF O IMAGEN
   En la práctica estos papeles llegan escaneados o fotografiados con el
   teléfono. Un .docx o un .zip no se puede mirar de un vistazo desde el
   listado, que es justamente para lo que sirve tenerlos cargados.

   POR QUÉ EL DEPÓSITO ES PRIVADO
   Son documentos de identidad. No van al depósito público donde vive la foto
   del carnet: se abren con un enlace que caduca a los 10 minutos.
   ============================================================ */

export type TipoDocumentoPersonal = 'rif' | 'cedula' | 'cv';

export interface DefinicionDocumento {
  key: TipoDocumentoPersonal;
  label: string;
  corto: string;
  icono: string;
  ayuda: string;
}

export const TIPOS_DOCUMENTO_PERSONAL: DefinicionDocumento[] = [
  { key: 'cedula', label: 'Cédula de identidad', corto: 'CI', icono: '🪪', ayuda: 'Ambas caras, escaneadas o fotografiadas.' },
  { key: 'rif', label: 'RIF', corto: 'RIF', icono: '🆔', ayuda: 'El certificado del SENIAT.' },
  { key: 'cv', label: 'Currículum', corto: 'CV', icono: '📄', ayuda: 'El currículum que entregó la persona.' },
];

export function definicionDocumento(t: TipoDocumentoPersonal | string): DefinicionDocumento | null {
  return TIPOS_DOCUMENTO_PERSONAL.find((d) => d.key === t) ?? null;
}

export function labelDocumento(t: TipoDocumentoPersonal | string | null | undefined): string {
  return definicionDocumento(String(t ?? ''))?.label ?? '—';
}

/** Los tipos válidos, para no aceptar cualquier cosa que llegue como texto. */
export function esTipoDocumento(v: unknown): v is TipoDocumentoPersonal {
  return TIPOS_DOCUMENTO_PERSONAL.some((d) => d.key === v);
}

/** Tope de tamaño. Un escaneo normal no llega ni cerca; 10 MB deja margen. */
export const MAX_BYTES_DOCUMENTO = 10 * 1024 * 1024;

export interface ArchivoSubido {
  name: string;
  type: string;
  size: number;
}

/** ¿Es PDF? Se mira el tipo declarado y, si viene vacío, la extensión. */
export function esPdf(file: Pick<ArchivoSubido, 'name' | 'type'>): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

/** ¿Es imagen? Igual: tipo declarado, y si no, la extensión. */
export function esImagen(file: Pick<ArchivoSubido, 'name' | 'type'>): boolean {
  if ((file.type ?? '').startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name ?? '');
}

/**
 * Qué está mal con el archivo, en palabras. `null` si se puede subir.
 * No lanza: el formulario quiere mostrarlo, no explotar.
 */
export function validarArchivoDocumento(file: ArchivoSubido | null | undefined): string | null {
  if (!file) return 'Elegí un archivo.';
  if (!file.name?.trim()) return 'El archivo no tiene nombre.';
  if (!esPdf(file) && !esImagen(file)) {
    return 'El documento tiene que ser un PDF o una imagen (JPG, PNG, HEIC…). Un Word o un ZIP no se puede mirar desde el listado.';
  }
  if (Number(file.size) <= 0) return 'El archivo está vacío.';
  if (Number(file.size) > MAX_BYTES_DOCUMENTO) {
    return `El archivo pesa ${megas(file.size)} y el tope es 10 MB. Si es una foto, sacala con menos resolución o pasala a PDF.`;
  }
  return null;
}

export function archivoDocumentoValido(file: ArchivoSubido | null | undefined): boolean {
  return validarArchivoDocumento(file) === null;
}

/** «2,4 MB» / «812 KB», para decir el tamaño sin hacer pensar al lector. */
export function megas(bytes: unknown): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(Math.round((b / (1024 * 1024)) * 10) / 10).toLocaleString('es-VE')} MB`;
}

/** El nombre, limpio de lo que rompe una ruta de Storage. */
export function nombreSeguro(nombre: string): string {
  const limpio = String(nombre ?? '').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_');
  return limpio.replace(/^_+|_+$/g, '') || 'documento';
}

export interface DocumentoCargado {
  tipo: TipoDocumentoPersonal;
}

/** Qué papeles le faltan a la persona, en el orden en que se piden. */
export function documentosFaltantes(cargados: DocumentoCargado[]): DefinicionDocumento[] {
  const tiene = new Set(cargados.map((d) => d.tipo));
  return TIPOS_DOCUMENTO_PERSONAL.filter((d) => !tiene.has(d.key));
}

/** «2 de 3», para el listado. */
export function resumenDocumentos(cargados: DocumentoCargado[]): string {
  const tiene = new Set(cargados.map((d) => d.tipo));
  return `${tiene.size} de ${TIPOS_DOCUMENTO_PERSONAL.length}`;
}

/** ¿Están los tres? */
export function documentacionCompleta(cargados: DocumentoCargado[]): boolean {
  return documentosFaltantes(cargados).length === 0;
}
