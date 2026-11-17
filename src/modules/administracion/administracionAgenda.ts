/* ============================================================
   Golden Touch · Administración · Agenda unificada de vencimientos
   El eje «Vencimiento» cruza documentos (vigencia), gastos/cuentas por
   pagar (fecha de pago, independiente del período) y gestiones (fecha
   pactada). Lógica PURA: arma la lista ordenada por urgencia y la filtra.
   ============================================================ */
import type { DocumentoEmpresa, EnvioTesoreria, Gestion, Movimiento, Prioridad, StatusVencimiento } from './admin.repository';
import type { Moneda } from './administracionCalculo';
import { diasRestantes } from './admin.repository';
import { statusConAviso, ordenPrioridad } from './administracionVigencia';
import { estadoGestion } from './administracionHonorarios';

export type OrigenAgenda = 'documento' | 'gasto' | 'gestion';

export interface ItemAgenda {
  origen: OrigenAgenda;
  id: string;
  empresaClave: string;
  centroAcopioId: string | null;
  responsable: string | null;
  titulo: string;
  fecha: string | null;
  status: StatusVencimiento;
  diasRestantes: number | null;
  prioridad: Prioridad | null;
  moneda?: Moneda | null;
  monto?: number | null;
}

/** Urgencia por estado de tiempo: vencido primero, permanente al final. */
const RANGO_URGENCIA: Record<StatusVencimiento, number> = {
  vencido: 0, vencido_en_tramite: 0, por_vencer: 1, vigente: 2, no_vence: 3,
};

export function agendaVencimientos(input: {
  documentos: DocumentoEmpresa[];
  movimientos: Movimiento[];
  gestiones: Gestion[];
  envios?: EnvioTesoreria[];
  hoyRef?: string;
}): ItemAgenda[] {
  const { hoyRef } = input;
  const items: ItemAgenda[] = [];

  for (const d of input.documentos) {
    const fecha = d.fechaVencimiento ?? null;
    items.push({
      origen: 'documento', id: d.id, empresaClave: d.empresaClave, centroAcopioId: d.centroAcopioId ?? null,
      responsable: d.responsable ?? null, titulo: d.nombre, fecha,
      status: statusConAviso(fecha, d.avisoDias, { statusManual: d.statusVencimiento, hoyRef }),
      diasRestantes: diasRestantes(fecha, hoyRef), prioridad: d.prioridad ?? null,
    });
  }

  for (const m of input.movimientos) {
    if (m.estadoPago === 'pagado' || m.estadoPago === 'anulado') continue;
    // La FECHA del movimiento manda (independiente del período): así una cuenta que
    // cruza el cierre de mes no se marca vencida por el período.
    items.push({
      origen: 'gasto', id: m.id, empresaClave: m.empresaClave, centroAcopioId: null,
      responsable: null, titulo: m.concepto, fecha: m.fecha,
      status: statusConAviso(m.fecha, m.avisoDias, { hoyRef }),
      diasRestantes: diasRestantes(m.fecha, hoyRef), prioridad: m.prioridad ?? null,
      moneda: m.moneda, monto: m.monto,
    });
  }

  for (const g of input.gestiones) {
    const est = estadoGestion(g, input.envios ?? []);
    if (est === 'anulada' || est === 'saldada') continue; // nada pendiente que agendar
    const fecha = g.fechaPactada ?? null;
    items.push({
      origen: 'gestion', id: g.id, empresaClave: g.empresaClave, centroAcopioId: g.centroAcopioId ?? null,
      responsable: null, titulo: g.concepto, fecha,
      status: statusConAviso(fecha, g.avisoDias, { hoyRef }),
      diasRestantes: diasRestantes(fecha, hoyRef), prioridad: g.prioridad ?? null,
      moneda: g.moneda, monto: g.costoTotal,
    });
  }

  items.sort((a, b) => {
    const r = RANGO_URGENCIA[a.status] - RANGO_URGENCIA[b.status];
    if (r !== 0) return r;
    // Dentro del grupo: el más próximo a vencer primero (menor díasRestantes); sin fecha, al final.
    const da = a.diasRestantes, db = b.diasRestantes;
    if (da == null && db == null) return ordenPrioridad(a.prioridad) - ordenPrioridad(b.prioridad);
    if (da == null) return 1;
    if (db == null) return -1;
    if (da !== db) return da - db;
    return ordenPrioridad(a.prioridad) - ordenPrioridad(b.prioridad);
  });

  return items;
}

/** Texto corto de la cuenta regresiva, derivado SOLO de diasRestantes (coherente
 *  con el estado calculado con el aviso propio; no recalcula con umbral fijo). */
export function textoDiasRestantes(dias: number | null): string {
  if (dias == null) return 'Sin fecha';
  if (dias < 0) return `Vencido hace ${-dias} d`;
  if (dias === 0) return 'Vence hoy';
  return `Vence en ${dias} d`;
}

export interface ResumenAgenda { vencidos: number; porVencer: number; vigentes: number; }

/** Conteo para los KPIs del tablero de agenda. `no_vence` no se cuenta. */
export function resumenAgenda(items: ItemAgenda[]): ResumenAgenda {
  const r: ResumenAgenda = { vencidos: 0, porVencer: 0, vigentes: 0 };
  for (const i of items) {
    if (i.status === 'vencido' || i.status === 'vencido_en_tramite') r.vencidos += 1;
    else if (i.status === 'por_vencer') r.porVencer += 1;
    else if (i.status === 'vigente') r.vigentes += 1;
  }
  return r;
}

export function filtrarAgenda(
  items: ItemAgenda[],
  f: { empresaClave?: string | null; centroAcopioId?: string | null; responsable?: string | null; origen?: OrigenAgenda | null },
): ItemAgenda[] {
  return items.filter((i) => {
    if (f.empresaClave && i.empresaClave !== f.empresaClave) return false;
    if (f.centroAcopioId && i.centroAcopioId !== f.centroAcopioId) return false;
    if (f.responsable && i.responsable !== f.responsable) return false;
    if (f.origen && i.origen !== f.origen) return false;
    return true;
  });
}
