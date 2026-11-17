/* ============================================================
   Golden Touch · Administración · Responsabilidad (lógica pura)
   Responsable efectivo (propio o HEREDADO de la carpeta), imputación al
   vencer/incumplir, carga por analista y «mis responsabilidades».
   Responsables = usuarios del sistema (por email). Herencia keyea sobre el
   campo `carpeta` del documento (string que ya existe; no depende del cutover).
   ============================================================ */
import type { DocumentoEmpresa, ObjetivoResp, Responsabilidad, StatusVencimiento } from './admin.repository';
import type { ItemAgenda } from './administracionAgenda';
import { ordenPrioridad } from './administracionVigencia';

const VENCIDO: StatusVencimiento[] = ['vencido', 'vencido_en_tramite'];

/** Mapa email→nombre para mostrar (cae al email si el nombre viene vacío). */
export function nombrePorEmail(usuarios: { email: string; nombre: string; apellido?: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of usuarios) {
    const nc = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
    const etiqueta = nc || u.email;
    map.set(u.email, etiqueta);
    map.set(u.email.toLowerCase(), etiqueta);
  }
  return map;
}

const ETIQUETA_OBJETIVO: Record<ObjetivoResp, string> = { carpeta: 'Carpeta', documento: 'Documento', gasto: 'Gasto', gestion: 'Gestión' };

/** Etiqueta legible de un objetivo para el front (nunca un uuid crudo): resuelve el
 *  nombre por id cuando lo hay; para carpeta usa su slug; si no, el tipo sin el uuid. */
export function etiquetaObjetivo(tipo: ObjetivoResp, objetivoId: string, nombres: Map<string, string>): string {
  if (tipo === 'carpeta') return `Carpeta: ${objetivoId}`;
  const n = nombres.get(objetivoId);
  return n ? `${ETIQUETA_OBJETIVO[tipo]}: ${n}` : `${ETIQUETA_OBJETIVO[tipo]} sin identificar`;
}

/** Emails distintos responsables de un objetivo concreto. */
export function responsablesDeObjetivo(tipo: ObjetivoResp, objetivoId: string, resp: Responsabilidad[]): string[] {
  const set = new Set<string>();
  for (const r of resp) if (r.objetivoTipo === tipo && r.objetivoId === objetivoId) set.add(r.usuarioEmail);
  return Array.from(set);
}

/** Responsables efectivos de un documento: propios si existen (en tabla de responsabilidad o asignados directamente en el documento); si no, los de su carpeta (en tabla o configurados en la carpeta). */
export function responsablesEfectivosDocumento(
  doc: DocumentoEmpresa,
  resp: Responsabilidad[],
  responsableCarpeta?: string | null,
): { emails: string[]; heredado: boolean } {
  const propios = responsablesDeObjetivo('documento', doc.id, resp);
  if (propios.length > 0) return { emails: propios, heredado: false };
  if (doc.responsable?.trim()) return { emails: [doc.responsable.trim()], heredado: false };
  const deCarpeta = doc.carpeta ? responsablesDeObjetivo('carpeta', doc.carpeta, resp) : [];
  if (deCarpeta.length > 0) return { emails: deCarpeta, heredado: true };
  if (responsableCarpeta?.trim()) return { emails: [responsableCarpeta.trim()], heredado: true };
  return { emails: [], heredado: false };
}

/** Responsables efectivos de cualquier ítem de agenda (documento con herencia; gasto/gestión directos). */
export function responsablesEfectivosItem(
  item: ItemAgenda,
  resp: Responsabilidad[],
  docPorId: Map<string, DocumentoEmpresa>,
  carpetasMap?: Map<string, { responsable?: string | null }>,
): string[] {
  if (item.origen === 'documento') {
    const doc = docPorId.get(item.id);
    const respCarpeta = (doc?.carpeta && carpetasMap) ? carpetasMap.get(doc.carpeta)?.responsable : null;
    if (doc) return responsablesEfectivosDocumento(doc, resp, respCarpeta).emails;
    const deResp = responsablesDeObjetivo('documento', item.id, resp);
    if (deResp.length > 0) return deResp;
    return item.responsable?.trim() ? [item.responsable.trim()] : [];
  }
  const tipo: ObjetivoResp = item.origen === 'gasto' ? 'gasto' : 'gestion';
  const deResp = responsablesDeObjetivo(tipo, item.id, resp);
  if (deResp.length > 0) return deResp;
  return item.responsable?.trim() ? [item.responsable.trim()] : [];
}

/** Imputación: `[]` salvo que el ítem esté vencido/incumplido; entonces sus responsables efectivos. */
export function imputacion(
  item: ItemAgenda,
  resp: Responsabilidad[],
  docPorId: Map<string, DocumentoEmpresa>,
  carpetasMap?: Map<string, { responsable?: string | null }>,
): string[] {
  if (!VENCIDO.includes(item.status)) return [];
  return responsablesEfectivosItem(item, resp, docPorId, carpetasMap);
}

/* ───────── Carga por analista + Mis responsabilidades ───────── */

export interface CargaAnalista {
  usuarioEmail: string;
  total: number;
  alDia: number;
  porVencer: number;
  vencidos: number;
  items: ItemAgenda[];
}

/** Agrega los ítems por responsable efectivo: un ítem compartido cuenta para cada responsable. */
export function cargaPorAnalista(
  items: ItemAgenda[],
  resp: Responsabilidad[],
  docPorId: Map<string, DocumentoEmpresa>,
  carpetasMap?: Map<string, { responsable?: string | null }>,
): CargaAnalista[] {
  const mapa = new Map<string, CargaAnalista>();
  for (const item of items) {
    for (const email of responsablesEfectivosItem(item, resp, docPorId, carpetasMap)) {
      const c = mapa.get(email) ?? { usuarioEmail: email, total: 0, alDia: 0, porVencer: 0, vencidos: 0, items: [] };
      c.total += 1;
      c.items.push(item);
      if (VENCIDO.includes(item.status)) c.vencidos += 1;
      else if (item.status === 'por_vencer') c.porVencer += 1;
      else c.alDia += 1;
      mapa.set(email, c);
    }
  }
  return Array.from(mapa.values()).sort((a, b) => b.vencidos - a.vencidos || b.porVencer - a.porVencer || a.usuarioEmail.localeCompare(b.usuarioEmail));
}

export type OrdenMisResp = 'prioridad' | 'estatus' | 'vigencia_asc' | 'vigencia_desc';
const RANGO_ESTATUS: Record<StatusVencimiento, number> = { vencido: 0, vencido_en_tramite: 0, por_vencer: 1, vigente: 2, no_vence: 3 };

/** Los ítems a cargo de un analista, ordenados según el criterio elegido. */
export function misResponsabilidades(
  usuarioEmail: string,
  items: ItemAgenda[],
  resp: Responsabilidad[],
  docPorId: Map<string, DocumentoEmpresa>,
  orden: OrdenMisResp,
  carpetasMap?: Map<string, { responsable?: string | null }>,
): ItemAgenda[] {
  const mios = items.filter((i) => responsablesEfectivosItem(i, resp, docPorId, carpetasMap).includes(usuarioEmail));
  const dias = (i: ItemAgenda) => (i.diasRestantes == null ? Number.POSITIVE_INFINITY : i.diasRestantes);
  const cmp: Record<OrdenMisResp, (a: ItemAgenda, b: ItemAgenda) => number> = {
    prioridad: (a, b) => ordenPrioridad(a.prioridad) - ordenPrioridad(b.prioridad) || dias(a) - dias(b),
    estatus: (a, b) => RANGO_ESTATUS[a.status] - RANGO_ESTATUS[b.status] || dias(a) - dias(b),
    vigencia_asc: (a, b) => dias(a) - dias(b),
    vigencia_desc: (a, b) => dias(b) - dias(a),
  };
  return [...mios].sort(cmp[orden]);
}
