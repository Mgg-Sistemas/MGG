/* ============================================================
   Golden Touch · Libro fiscal · Quién y cuándo

   Lo que pasó con cada retención, con las columnas que la tabla ya tiene:
   el registro (actor_name, created_at), la declaración (declarada_por,
   declarada_at) y la anulación (updated_at y su motivo; la tabla no guarda
   quién anuló). Es información de pantalla: nunca va en reportes ni en PDF.
   ============================================================ */
import type { RetencionPracticada } from './retencionesFiscal.repository';

export interface EventoRetencion {
  accion: 'Registró' | 'Declaró' | 'Anuló';
  quien: string | null;
  cuando: string | null;
  detalle?: string | null;
}

type Fuente = Pick<RetencionPracticada, 'actorName' | 'createdAt' | 'declaradaEn' | 'declaradaPor' | 'anulada' | 'anuladaMotivo' | 'updatedAt'>;

export function eventosRetencion(r: Fuente): EventoRetencion[] {
  const xs: EventoRetencion[] = [{ accion: 'Registró', quien: r.actorName, cuando: r.createdAt || null }];
  if (r.declaradaEn) xs.push({ accion: 'Declaró', quien: r.declaradaPor, cuando: r.declaradaEn });
  if (r.anulada) xs.push({ accion: 'Anuló', quien: null, cuando: r.updatedAt, detalle: r.anuladaMotivo });
  return xs.sort((a, b) => String(a.cuando ?? '').localeCompare(String(b.cuando ?? '')));
}

/** «14/10 15:03» en la hora de Venezuela; vacío si no hay fecha. */
export function cuandoCorto(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Caracas',
  }).format(d).replace(',', '');
}

/** La línea terciaria: la última acción, con su verbo si no es el registro. */
export function lineaQuien(r: Fuente): string {
  const xs = eventosRetencion(r);
  const a = xs[xs.length - 1];
  const verbo = a.accion === 'Registró' ? '' : a.accion.toLowerCase();
  const quien = a.quien ? `por ${a.quien}` : '';
  return [verbo, quien, cuandoCorto(a.cuando)].filter(Boolean).join(' · ');
}
