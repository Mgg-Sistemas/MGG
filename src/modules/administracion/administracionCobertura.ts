/* ============================================================
   Golden Touch · Administración · Cobertura por centro (lógica pura)
   Fase por centro = N de M: de los documentos REQUERIDOS del centro (checklist
   editable), cuántos tiene vigentes/por vencer (ni vencidos ni ausentes).
   Coexiste con la etiqueta de fase operativa; no la reemplaza.
   ============================================================ */
import type { CentroRequerido, DocumentoEmpresa, TipoDocumento } from './admin.repository';
import { statusConAviso } from './administracionVigencia';

export interface CoberturaCentro {
  centroId: string;
  nombre: string;
  requeridos: number;
  cubiertos: number;
  pct: number;
  faltantes: TipoDocumento[];
}

/** Un documento «cubre» si está vigente, por vencer o es permanente (no vencido/ausente). */
function docCubre(doc: DocumentoEmpresa, hoyRef?: string): boolean {
  const st = statusConAviso(doc.fechaVencimiento, doc.avisoDias, { statusManual: doc.statusVencimiento, hoyRef });
  return st === 'vigente' || st === 'por_vencer' || st === 'no_vence';
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** Centro EFECTIVO del documento: el propio, o el de su carpeta (herencia), como ya
 *  hace `calcularMatrizCentrosAcopio`. Puede venir como id o como nombre del centro. */
function perteneceAlCentro(
  doc: DocumentoEmpresa,
  centro: { id: string; nombre: string },
  centroDeCarpeta: Map<string, string>,
): boolean {
  const efectivo = norm(doc.centroAcopioId) || norm(centroDeCarpeta.get(doc.carpeta));
  if (!efectivo) return false;
  return efectivo === norm(centro.id) || efectivo === norm(centro.nombre);
}

export function coberturaCentro(
  centros: { id: string; nombre: string }[],
  requeridos: CentroRequerido[],
  documentos: DocumentoEmpresa[],
  hoyRef?: string,
  carpetas?: { id: string; centroAcopioId?: string | null }[],
): CoberturaCentro[] {
  const centroDeCarpeta = new Map<string, string>();
  for (const c of carpetas ?? []) if (c.centroAcopioId) centroDeCarpeta.set(c.id, c.centroAcopioId);

  return centros.map((centro) => {
    const tipos = requeridos.filter((r) => r.centroId === centro.id).map((r) => r.tipoDocumento);
    const faltantes: TipoDocumento[] = [];
    let cubiertos = 0;
    for (const tipo of tipos) {
      const cubierto = documentos.some((d) => d.tipo === tipo && perteneceAlCentro(d, centro, centroDeCarpeta) && docCubre(d, hoyRef));
      if (cubierto) cubiertos += 1;
      else faltantes.push(tipo);
    }
    const M = tipos.length;
    const pct = M > 0 ? Math.round((cubiertos / M) * 100) : 100;
    return { centroId: centro.id, nombre: centro.nombre, requeridos: M, cubiertos, pct, faltantes };
  });
}
