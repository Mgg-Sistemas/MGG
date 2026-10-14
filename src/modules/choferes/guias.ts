/* ============================================================
   MGG · Choferes · Guías (PDF) (14-10-2026)
   Lo que no necesita la base: validar el PDF y los datos de la guía, filtrar
   por fecha y buscar por texto, y escribir el tamaño del archivo.
   ============================================================ */

export interface Guia {
  id: string;
  fecha: string;              // YYYY-MM-DD
  numero: string | null;
  descripcion: string;
  conductor_id: string | null;
  path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  nota: string | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export const MAX_BYTES_GUIA = 15 * 1024 * 1024;

/** Solo PDF y hasta 15 MB. Devuelve el texto del error o null. */
export function validarPdfGuia(file: { type: string; size: number; name: string } | null | undefined): string | null {
  if (!file) return 'Elige el PDF de la guía.';
  const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!esPdf) return 'La guía tiene que ser un PDF.';
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MAX_BYTES_GUIA) return 'El PDF pesa más de 15 MB.';
  return null;
}

export interface DatosGuia {
  fecha: string;
  numero: string;
  descripcion: string;
  conductorId: string;
  nota: string;
}

export const DATOS_GUIA_VACIOS: DatosGuia = { fecha: '', numero: '', descripcion: '', conductorId: '', nota: '' };

/** Qué falta en el formulario, o null si se puede guardar. */
export function validarGuia(d: DatosGuia): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return 'Indica la fecha de la guía.';
  if (d.descripcion.trim().length < 2) return 'Indica de qué es la guía (descripción).';
  return null;
}

export interface FiltroGuias {
  desde: string;
  hasta: string;
  q: string;
}

const norm = (s: string | null | undefined) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filtra por rango de fechas (los dos extremos adentro) y por texto: número,
 * descripción, nota, nombre del archivo, conductor y quién la cargó.
 */
export function filtrarGuias(lista: Guia[], f: FiltroGuias, nombreConductor: (id: string | null) => string): Guia[] {
  const q = norm(f.q).trim();
  return lista.filter((g) => {
    if (f.desde && g.fecha < f.desde) return false;
    if (f.hasta && g.fecha > f.hasta) return false;
    if (!q) return true;
    const texto = norm([g.numero, g.descripcion, g.nota, g.filename, nombreConductor(g.conductor_id), g.actor_name, g.fecha].join(' '));
    return q.split(/\s+/).every((p) => texto.includes(p));
  });
}

/** «1,2 MB», «340 KB». */
export function tamanoLegible(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0;
  if (n <= 0) return '—';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Nombre con el que se descarga: «Guía 0452 · 14-10-2026.pdf». */
export function nombreDescargaGuia(g: Pick<Guia, 'numero' | 'fecha' | 'descripcion'>): string {
  const [y, m, d] = g.fecha.split('-');
  const base = g.numero ? `Guia ${g.numero}` : g.descripcion.slice(0, 40);
  return `${base} · ${d}-${m}-${y}.pdf`.replace(/[\\/:*?"<>|]/g, '');
}
