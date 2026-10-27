/* ============================================================
   Golden Touch · Control de Maquinaria · Detalle de un estado
   Reglas puras (sin Supabase) de la ventana de detalle que se abre
   desde «Averías y estados» y desde el expediente: cómo se reconoce
   un cambio de estado que vino de la carga de informes técnicos,
   cuál de los documentos es el informe y cómo se muestran las notas.
   ============================================================ */
import { norm } from '@/shared/lib/texto';

export interface EventoReconocible {
  motivo?: string | null;
  nota?: string | null;
  actor?: string | null;
}

/**
 * ¿El cambio de estado vino de la carga de informes técnicos? La carga deja la
 * nota «Carga de informes técnicos en PDF» y el motivo termina en «(informe
 * técnico dd/mm/aaaa)». Se compara sin acentos ni mayúsculas.
 */
export function esEventoInforme(ev: EventoReconocible | null | undefined): boolean {
  if (!ev) return false;
  const nota = norm(ev.nota);
  if (/carga de informes? tecnicos?/.test(nota)) return true;
  return /\(informe tecnico \d{1,2}\/\d{1,2}\/\d{4}\)/.test(norm(ev.motivo));
}

export interface DocumentoReconocible {
  nombre: string;
  content_type: string | null;
  archivo?: string | null;
  espacio?: number;
}

const esPdf = (d: DocumentoReconocible) => (d.content_type ?? '').includes('pdf') || /\.pdf$/i.test(d.archivo ?? '');
export const esImagenDocumento = (d: DocumentoReconocible) => (d.content_type ?? '').startsWith('image/');

/**
 * El documento del informe técnico entre los del equipo: primero el que se llama
 * «INFORME TÉCNICO», si no cualquier PDF cuyo nombre diga «informe».
 */
export function documentoInforme<T extends DocumentoReconocible>(docs: T[]): T | null {
  const conNombre = docs.filter((d) => norm(d.nombre).includes('informe'));
  return conNombre.find((d) => norm(d.nombre) === 'informe tecnico' && esPdf(d))
    ?? conNombre.find(esPdf)
    ?? null;
}

/** Las imágenes de los documentos (foto del equipo, de la placa…), en el orden de sus espacios. */
export function imagenesDocumentos<T extends DocumentoReconocible>(docs: T[]): T[] {
  return docs.filter(esImagenDocumento).sort((a, b) => (a.espacio ?? 0) - (b.espacio ?? 0));
}

export interface BloqueNotas {
  /** «Informe técnico · recibido 09/10/2026», si el bloque empieza así. */
  titulo: string | null;
  /** Una línea por oración, para leerlas sin el bloque de texto corrido. */
  lineas: string[];
}

const CABECERA_INFORME = /^INFORME T[ÉE]CNICO\s*\(recibido\s+([^)]+)\)\s*:?\s*/i;

/**
 * Las notas del equipo, legibles: respeta los saltos de línea que ya tenían,
 * separa la cabecera «INFORME TÉCNICO (recibido …):» como título y pone cada
 * oración en su línea (sin partir abreviaturas como «n.º» ni números «12,302.0»).
 */
export function bloquesNotas(notas: string | null | undefined): BloqueNotas[] {
  const texto = (notas ?? '').replace(/\r\n?/g, '\n').trim();
  if (!texto) return [];
  return texto.split(/\n\s*\n/).map((bloque) => {
    let cuerpo = bloque.trim();
    let titulo: string | null = null;
    const m = CABECERA_INFORME.exec(cuerpo);
    if (m) {
      titulo = `Informe técnico · recibido ${m[1].trim()}`;
      cuerpo = cuerpo.slice(m[0].length);
    }
    const lineas = cuerpo
      .split('\n')
      .flatMap((l) => l.split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ«"\d])/u))
      .map((l) => l.trim())
      .filter(Boolean);
    return { titulo, lineas };
  }).filter((b) => b.titulo || b.lineas.length);
}

/** El motivo del evento en una sola frase (lo que se corta con «…» en la lista). */
export function resumenEvento(ev: { motivo?: string | null; material?: string | null; nota?: string | null; actor?: string | null; actor_name?: string | null }): string {
  return [ev.motivo, ev.material ? `falta ${ev.material}` : null, ev.nota, ev.actor_name || ev.actor]
    .map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');
}

/** El último evento de cada equipo (la lista llega de la más reciente a la más vieja, pero no se confía en eso). */
export function ultimoEventoPorEquipo<T extends { equipo_id: string; created_at: string }>(eventos: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const ev of eventos) {
    const prev = m.get(ev.equipo_id);
    if (!prev || ev.created_at > prev.created_at) m.set(ev.equipo_id, ev);
  }
  return m;
}
