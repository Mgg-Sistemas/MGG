/* ============================================================
   Golden Touch · Administración · Resumen del tablero (lógica pura)
   Agrega lo que ya calculan las fases 2-4 en los KPIs de apertura del módulo:
   agenda (vencimientos), pendiente por profesional, cuentas por enviar, carga
   por analista y cobertura por centro. POR MONEDA NATIVA (sin reconvertir).
   ============================================================ */
import type { CentroRequerido, DocumentoEmpresa, EnvioTesoreria, Gestion, Movimiento, Profesional, Responsabilidad } from './admin.repository';
import type { Moneda } from './administracionCalculo';
import { agendaVencimientos, resumenAgenda } from './administracionAgenda';
import { estadoCuentaProfesional, disponibleParaEnviar } from './administracionHonorarios';
import { cargaPorAnalista } from './administracionResponsabilidad';
import { coberturaCentro, type CoberturaCentro } from './administracionCobertura';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Semáforo de cobertura por centro: 100% al día, 60-99 atención, <60 crítico. */
export function colorSemaforoCobertura(pct: number): 'critico' | 'atencion' | 'al_dia' {
  if (pct >= 100) return 'al_dia';
  if (pct >= 60) return 'atencion';
  return 'critico';
}

export interface ResumenTablero {
  agenda: { vencidos: number; porVencer: number; vigentes: number };
  pendientePorMoneda: { moneda: Moneda; saldo: number }[];
  porEnviar: { moneda: Moneda; monto: number; n: number }[];
  cargaTop: { usuarioEmail: string; vencidos: number; total: number }[];
  cobertura: CoberturaCentro[];
}

function sumarPorMoneda<T>(filas: T[], moneda: (x: T) => Moneda, valor: (x: T) => number): Map<Moneda, number> {
  const m = new Map<Moneda, number>();
  for (const f of filas) m.set(moneda(f), r2((m.get(moneda(f)) ?? 0) + valor(f)));
  return m;
}

export function resumenTablero(input: {
  documentos: DocumentoEmpresa[];
  movimientos: Movimiento[];
  gestiones: Gestion[];
  envios: EnvioTesoreria[];
  profesionales: Profesional[];
  responsabilidades: Responsabilidad[];
  centros: { id: string; nombre: string }[];
  requeridos: CentroRequerido[];
  /** Carpetas con su centro asociado y responsable: el documento HEREDA de su carpeta. */
  carpetas?: { id: string; centroAcopioId?: string | null; responsable?: string | null }[];
  hoyRef?: string;
  topCarga?: number;
}): ResumenTablero {
  const { documentos, movimientos, gestiones, envios, profesionales, responsabilidades, centros, requeridos, carpetas, hoyRef } = input;
  const items = agendaVencimientos({ documentos, movimientos, gestiones, envios, hoyRef });
  const agenda = resumenAgenda(items);

  // Pendiente por moneda = Σ saldos de cada profesional (ya separados por moneda).
  const pendMapa = new Map<Moneda, number>();
  for (const p of profesionales) {
    for (const sub of estadoCuentaProfesional(p.id, gestiones, envios).porMoneda) {
      pendMapa.set(sub.moneda, r2((pendMapa.get(sub.moneda) ?? 0) + sub.saldo));
    }
  }
  const pendientePorMoneda = Array.from(pendMapa.entries())
    .filter(([, saldo]) => saldo > 0)
    .map(([moneda, saldo]) => ({ moneda, saldo }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));

  // Por enviar = gestiones no anuladas con disponible > 0, por moneda.
  const porEnviarGest = gestiones
    .filter((g) => g.estado !== 'anulada')
    .map((g) => ({ moneda: g.moneda, disponible: disponibleParaEnviar(g, envios) }))
    .filter((x) => x.disponible > 0);
  const montoMapa = sumarPorMoneda(porEnviarGest, (x) => x.moneda, (x) => x.disponible);
  const nMapa = sumarPorMoneda(porEnviarGest, (x) => x.moneda, () => 1);
  const porEnviar = Array.from(montoMapa.entries())
    .map(([moneda, monto]) => ({ moneda, monto, n: nMapa.get(moneda) ?? 0 }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));

  const docPorId = new Map(documentos.map((d) => [d.id, d]));
  const carpetasMap = carpetas ? new Map(carpetas.map((c) => [c.id, { responsable: c.responsable ?? null }])) : undefined;
  const cargaTop = cargaPorAnalista(items, responsabilidades, docPorId, carpetasMap)
    .slice(0, input.topCarga ?? 5)
    .map((c) => ({ usuarioEmail: c.usuarioEmail, vencidos: c.vencidos, total: c.total }));

  const cobertura = coberturaCentro(centros, requeridos, documentos, hoyRef, carpetas);

  return { agenda, pendientePorMoneda, porEnviar, cargaTop, cobertura };
}
