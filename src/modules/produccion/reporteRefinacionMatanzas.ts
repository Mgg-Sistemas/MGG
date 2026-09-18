/* ============================================================
   MGG · Reporte formal de producción · Refinación Matanzas
   y reporte encadenado Colada + Refinación

   Refinación: entra estaño CRUDO (de una o varias coladas), salen
   lingotes REFINADOS, dross y merma. El rendimiento se mide contra el
   crudo cargado.

   Colada + Refinación: sigue el estaño de punta a punta. De cada colada
   se toma una parte (o todo) para cada refinación, así que casiterita y
   Sn teórico se ATRIBUYEN en proporción a los kg tomados. Con eso se
   puede decir cuánto rindió la fundición, cuánto la refinación y cuánto
   el proceso completo (refinado ÷ Sn teórico de la casiterita).

   Todo es puro: sin Supabase.
   ============================================================ */
import { r2, rendimientoPct, snTeoricoKg, type ColadaReporte } from './reporteFundicionMatanzas';

export { r2 };

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Una colada (o material) de origen dentro de una refinación. */
export interface OrigenRefinacion {
  produccion_id: string;
  origen: 'colada' | 'refinacion' | 'manual';
  etiqueta: string;
  colada_num: number | null;
  estano_kg: number;          // kg tomados para esta refinación
}

export interface ReactivoUsado {
  nombre: string;
  kg: number;
}

/** Una refinación finalizada, tal como la tiene el sistema. */
export interface RefinacionReporte {
  produccion_id: string;
  refinacion_num: number;
  fecha: string;                 // YYYY-MM-DD
  turno: string;
  responsable: string;
  horno: string;                 // equipo / olla
  origenes: OrigenRefinacion[];
  crudo_kg: number;
  pureza_inicial: number | null;
  reactivos: ReactivoUsado[];
  refinado_kg: number;
  n_lingotes: number | null;
  dross_kg: number;
  pureza_final: number | null;
  temp_colada: number | null;
  duracion_horas: number | null;
  precinto: string;
  costo_total: number;
  observaciones: string;
}

export interface FilaRefinacion extends RefinacionReporte {
  reactivos_kg: number;
  merma_kg: number;              // crudo − refinado − dross (puede dar negativa: ver hallazgos)
  rendimiento_pct: number | null;
  peso_prom_lingote: number | null;
  costo_kg: number | null;
}

export interface TotalesRefinacion {
  refinaciones: number;
  crudo_kg: number;
  reactivos_kg: number;
  refinado_kg: number;
  dross_kg: number;
  merma_kg: number;
  n_lingotes: number;
  costo_total: number;
  costo_kg: number | null;
  rendimiento_pct: number | null;
  duracion_prom_horas: number | null;
  pureza_final_prom: number | null;
}

export function filaRefinacion(r: RefinacionReporte): FilaRefinacion {
  const reactivos_kg = r2(r.reactivos.reduce((a, x) => a + n(x.kg), 0));
  const lingotes = n(r.n_lingotes);
  return {
    ...r,
    reactivos_kg,
    merma_kg: r2(n(r.crudo_kg) - n(r.refinado_kg) - n(r.dross_kg)),
    rendimiento_pct: rendimientoPct(r.refinado_kg, r.crudo_kg),
    peso_prom_lingote: lingotes > 0 ? r2(n(r.refinado_kg) / lingotes) : null,
    costo_kg: n(r.refinado_kg) > 0 ? r2(n(r.costo_total) / n(r.refinado_kg)) : null,
  };
}

const promedio = (xs: number[]): number | null => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function totalesRefinacion(filas: FilaRefinacion[]): TotalesRefinacion {
  const suma = (f: (x: FilaRefinacion) => number) => r2(filas.reduce((a, x) => a + n(f(x)), 0));
  const crudo_kg = suma((f) => f.crudo_kg);
  const refinado_kg = suma((f) => f.refinado_kg);
  const costo_total = suma((f) => f.costo_total);
  return {
    refinaciones: filas.length,
    crudo_kg,
    reactivos_kg: suma((f) => f.reactivos_kg),
    refinado_kg,
    dross_kg: suma((f) => f.dross_kg),
    merma_kg: suma((f) => f.merma_kg),
    n_lingotes: Math.round(filas.reduce((a, f) => a + n(f.n_lingotes), 0)),
    costo_total,
    costo_kg: refinado_kg > 0 ? r2(costo_total / refinado_kg) : null,
    rendimiento_pct: rendimientoPct(refinado_kg, crudo_kg),
    duracion_prom_horas: promedio(filas.filter((f) => n(f.duracion_horas) > 0).map((f) => n(f.duracion_horas))),
    pureza_final_prom: promedio(filas.filter((f) => n(f.pureza_final) > 0).map((f) => n(f.pureza_final))),
  };
}

/** Reactivos del período sumados por nombre, con su consumo por tonelada de crudo. */
export function reactivosDelPeriodo(filas: FilaRefinacion[]): Array<{ nombre: string; kg: number; kg_por_ton: number | null }> {
  const m = new Map<string, number>();
  filas.forEach((f) => f.reactivos.forEach((x) => m.set(x.nombre, (m.get(x.nombre) ?? 0) + n(x.kg))));
  const crudoTon = filas.reduce((a, f) => a + n(f.crudo_kg), 0) / 1000;
  return [...m.entries()]
    .map(([nombre, kg]) => ({ nombre, kg: r2(kg), kg_por_ton: crudoTon > 0 ? r2(kg / crudoTon) : null }))
    .sort((a, b) => b.kg - a.kg);
}

/** Hallazgos que salen de comparar los números (nombra la refinación de la que habla). */
export function hallazgosRefinacion(filas: FilaRefinacion[], tot: TotalesRefinacion): string[] {
  const out: string[] = [];
  if (!filas.length) return out;
  const conRend = filas.filter((f) => f.rendimiento_pct != null);
  if (conRend.length > 1) {
    const mejor = conRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) > (a.rendimiento_pct ?? 0) ? b : a));
    const peor = conRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) < (a.rendimiento_pct ?? 0) ? b : a));
    out.push(`El mejor rendimiento fue el de la refinación #${mejor.refinacion_num} (${mejor.rendimiento_pct} %) y el más bajo el de la #${peor.refinacion_num} (${peor.rendimiento_pct} %).`);
  }
  const negativas = filas.filter((f) => f.merma_kg < 0);
  if (negativas.length) {
    out.push(`En ${negativas.map((f) => `#${f.refinacion_num} (${f.merma_kg} kg)`).join(', ')} el refinado más el dross supera al crudo cargado. Suele pasar cuando el dross se pesa con reactivos o carbón adheridos: conviene revisar el pesaje del dross o registrar su humedad.`);
  }
  if (tot.dross_kg > 0 && tot.crudo_kg > 0) {
    out.push(`El dross del período fue ${tot.dross_kg} kg, un ${r2((tot.dross_kg / tot.crudo_kg) * 100)} % del crudo cargado. El estaño que contiene se puede recuperar reprocesándolo.`);
  }
  const sinPureza = filas.filter((f) => f.pureza_final == null).map((f) => `#${f.refinacion_num}`);
  if (sinPureza.length) out.push(`Sin pureza final registrada: ${sinPureza.join(', ')}. Sin ese dato no se puede certificar la calidad del lingote.`);
  const sinTemp = filas.filter((f) => f.temp_colada == null).map((f) => `#${f.refinacion_num}`);
  if (sinTemp.length) out.push(`Sin temperatura de colada registrada: ${sinTemp.join(', ')}.`);
  return out;
}

/* ───────────── Colada + Refinación (cadena del estaño) ───────────── */

/** Una colada dentro de una refinación, con lo que se le atribuye por los kg tomados. */
export interface TramoCadena {
  colada_num: number | null;
  etiqueta: string;
  origen: OrigenRefinacion['origen'];
  fecha_colada: string;
  tomado_kg: number;
  /** Fracción de la colada que fue a esta refinación (tomado ÷ estaño de la colada). */
  fraccion: number | null;
  casiterita_kg: number | null;   // atribuida
  sn_teorico_kg: number | null;   // atribuido
  estano_colada_kg: number | null;
  rendimiento_fundicion_pct: number | null;
}

export interface Cadena {
  refinacion: FilaRefinacion;
  tramos: TramoCadena[];
  casiterita_kg: number;
  sn_teorico_kg: number;
  /** Crudo que no viene de una colada conocida (manual o 2ª refinación): no tiene casiterita atrás. */
  crudo_sin_trazar_kg: number;
  rendimiento_fundicion_pct: number | null;   // crudo trazado ÷ Sn teórico
  rendimiento_refinacion_pct: number | null;  // refinado ÷ crudo
  rendimiento_global_pct: number | null;      // refinado atribuible ÷ Sn teórico
}

export interface TotalesCadena {
  casiterita_kg: number;
  sn_teorico_kg: number;
  crudo_kg: number;
  crudo_trazado_kg: number;
  refinado_kg: number;
  dross_kg: number;
  rendimiento_fundicion_pct: number | null;
  rendimiento_refinacion_pct: number | null;
  rendimiento_global_pct: number | null;
}

/** Arma la cadena de cada refinación contra sus coladas de origen. */
export function cadenas(refinaciones: FilaRefinacion[], coladas: ColadaReporte[], tenorPct: number): Cadena[] {
  const porId = new Map(coladas.map((c) => [c.produccion_id, c]));
  return refinaciones.map((ref) => {
    const tramos: TramoCadena[] = ref.origenes.map((o) => {
      const c = o.origen === 'colada' ? porId.get(o.produccion_id) : undefined;
      if (!c) {
        return {
          colada_num: o.colada_num, etiqueta: o.etiqueta, origen: o.origen, fecha_colada: '',
          tomado_kg: r2(o.estano_kg), fraccion: null, casiterita_kg: null, sn_teorico_kg: null,
          estano_colada_kg: null, rendimiento_fundicion_pct: null,
        };
      }
      const fr = n(c.estano_kg) > 0 ? Math.min(1, n(o.estano_kg) / n(c.estano_kg)) : null;
      const snTeo = snTeoricoKg(c.casiterita_kg, tenorPct);
      return {
        colada_num: c.colada_num, etiqueta: o.etiqueta || `Colada #${c.colada_num}`, origen: 'colada', fecha_colada: c.fecha,
        tomado_kg: r2(o.estano_kg),
        fraccion: fr == null ? null : Math.round(fr * 10000) / 10000,
        casiterita_kg: fr == null ? null : r2(n(c.casiterita_kg) * fr),
        sn_teorico_kg: fr == null ? null : r2(snTeo * fr),
        estano_colada_kg: r2(c.estano_kg),
        rendimiento_fundicion_pct: rendimientoPct(c.estano_kg, snTeo),
      };
    });
    const trazados = tramos.filter((t) => t.sn_teorico_kg != null);
    const casiterita_kg = r2(trazados.reduce((a, t) => a + n(t.casiterita_kg), 0));
    const sn_teorico_kg = r2(trazados.reduce((a, t) => a + n(t.sn_teorico_kg), 0));
    const crudoTrazado = r2(trazados.reduce((a, t) => a + n(t.tomado_kg), 0));
    const crudoTotal = r2(tramos.reduce((a, t) => a + n(t.tomado_kg), 0)) || n(ref.crudo_kg);
    // Del refinado, la parte que viene de crudo trazado (en proporción).
    const refinadoTrazado = crudoTotal > 0 ? r2(n(ref.refinado_kg) * (crudoTrazado / crudoTotal)) : 0;
    return {
      refinacion: ref,
      tramos,
      casiterita_kg,
      sn_teorico_kg,
      crudo_sin_trazar_kg: r2(crudoTotal - crudoTrazado),
      rendimiento_fundicion_pct: rendimientoPct(crudoTrazado, sn_teorico_kg),
      rendimiento_refinacion_pct: ref.rendimiento_pct,
      rendimiento_global_pct: rendimientoPct(refinadoTrazado, sn_teorico_kg),
    };
  });
}

export function totalesCadena(cs: Cadena[]): TotalesCadena {
  const suma = (f: (c: Cadena) => number) => r2(cs.reduce((a, c) => a + n(f(c)), 0));
  const sn_teorico_kg = suma((c) => c.sn_teorico_kg);
  const crudo_kg = suma((c) => c.refinacion.crudo_kg);
  const crudo_trazado_kg = suma((c) => c.tramos.filter((t) => t.sn_teorico_kg != null).reduce((a, t) => a + t.tomado_kg, 0));
  const refinado_kg = suma((c) => c.refinacion.refinado_kg);
  const refinadoTrazado = suma((c) => {
    const tot = c.tramos.reduce((a, t) => a + t.tomado_kg, 0) || c.refinacion.crudo_kg;
    const traz = c.tramos.filter((t) => t.sn_teorico_kg != null).reduce((a, t) => a + t.tomado_kg, 0);
    return tot > 0 ? c.refinacion.refinado_kg * (traz / tot) : 0;
  });
  return {
    casiterita_kg: suma((c) => c.casiterita_kg),
    sn_teorico_kg,
    crudo_kg,
    crudo_trazado_kg,
    refinado_kg,
    dross_kg: suma((c) => c.refinacion.dross_kg),
    rendimiento_fundicion_pct: rendimientoPct(crudo_trazado_kg, sn_teorico_kg),
    rendimiento_refinacion_pct: rendimientoPct(refinado_kg, crudo_kg),
    rendimiento_global_pct: rendimientoPct(refinadoTrazado, sn_teorico_kg),
  };
}

/** Estaño bruto de cada colada que todavía no pasó por ninguna refinación del sistema. */
export function brutoSinRefinar(coladas: ColadaReporte[], todasLasRefinaciones: RefinacionReporte[]): Array<{ colada_num: number; fecha: string; estano_kg: number; refinado_desde_kg: number; pendiente_kg: number }> {
  const usado = new Map<string, number>();
  todasLasRefinaciones.forEach((r) => r.origenes.forEach((o) => {
    if (o.origen === 'colada') usado.set(o.produccion_id, (usado.get(o.produccion_id) ?? 0) + n(o.estano_kg));
  }));
  return coladas
    .map((c) => {
      const u = r2(usado.get(c.produccion_id) ?? 0);
      return { colada_num: c.colada_num, fecha: c.fecha, estano_kg: r2(c.estano_kg), refinado_desde_kg: u, pendiente_kg: Math.max(0, r2(n(c.estano_kg) - u)) };
    })
    .filter((x) => x.pendiente_kg > 0);
}

/** Hallazgos del reporte encadenado: pérdidas por etapa y datos que no cierran. */
export function hallazgosCadena(cs: Cadena[], tot: TotalesCadena, tenorPct: number): string[] {
  const out: string[] = [];
  if (!cs.length) return out;
  if (tot.rendimiento_global_pct != null) {
    out.push(`De cada 100 kg de estaño que la casiterita debía contener (tenor ${tenorPct} %), ${tot.rendimiento_global_pct} kg terminaron como lingote refinado: la fundición rindió ${tot.rendimiento_fundicion_pct ?? '—'} % y la refinación ${tot.rendimiento_refinacion_pct ?? '—'} %.`);
    const perdFund = tot.rendimiento_fundicion_pct != null ? r2(100 - tot.rendimiento_fundicion_pct) : null;
    const perdRef = tot.rendimiento_refinacion_pct != null ? r2(100 - tot.rendimiento_refinacion_pct) : null;
    if (perdFund != null && perdRef != null) {
      out.push(perdFund >= perdRef
        ? `La mayor pérdida está en la FUNDICIÓN (${perdFund} % del Sn teórico no llega a estaño bruto), antes que en la refinación (${perdRef} % del crudo).`
        : `La mayor pérdida está en la REFINACIÓN (${perdRef} % del crudo no llega a lingote), más que en la fundición (${perdFund} %).`);
    }
  }
  const sinTrazar = cs.filter((c) => c.crudo_sin_trazar_kg > 0);
  if (sinTrazar.length) {
    out.push(`Parte del crudo no viene de una colada del sistema (material manual o segunda refinación): ${sinTrazar.map((c) => `#${c.refinacion.refinacion_num} (${c.crudo_sin_trazar_kg} kg)`).join(', ')}. Ese crudo no tiene casiterita atrás y queda fuera del rendimiento global.`);
  }
  const fechas = cs.flatMap((c) => c.tramos
    .filter((t) => t.fecha_colada && c.refinacion.fecha && c.refinacion.fecha < t.fecha_colada)
    .map((t) => `refinación #${c.refinacion.refinacion_num} (${c.refinacion.fecha}) antes que su ${t.etiqueta} (${t.fecha_colada})`));
  if (fechas.length) out.push(`Fechas que no cierran: ${fechas.join('; ')}. Revisá la fecha cargada en la refinación o en la colada.`);
  return out;
}
