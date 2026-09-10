/* ============================================================
   MGG · Reporte formal de producción · Fundición Matanzas

   El sistema guarda lo que pasó en cada colada, pero no la lectura
   que la gerencia hace del período: cuánto estaño DEBÍA salir según
   el tenor, cuánto salió de verdad, cuánto se perdió y cuánto más se
   podría recuperar reprocesando la escoria.

   Acá viven esas cuentas. Todas se apoyan en dos ideas:

   1) El rendimiento se mide contra el Sn TEÓRICO —la casiterita por su
      tenor—, no contra la masa cargada. Un tenor más alto da un
      rendimiento más bajo: por eso el tenor es una decisión explícita
      del reporte y no un número escondido.

   2) La escoria se recupera cada dos coladas, así que el rendimiento
      REAL del proceso solo cierra agrupando de a pares: una colada sin
      escoria propia parece peor de lo que fue, y la siguiente mejor.

   Todo es puro: entra lo que el usuario eligió, sale lo que el reporte
   imprime. Sin Supabase de por medio.
   ============================================================ */

/** Una colada del período, tal como la tiene el sistema. */
export interface ColadaReporte {
  produccion_id: string;
  colada_num: number;
  fecha: string;                 // YYYY-MM-DD
  turno: string;
  casiterita_kg: number;
  coque_kg: number;
  caliza_kg: number;
  estano_kg: number;
  n_lingotes: number | null;
  escoria_kg: number;
  temp_colada: number | null;
  duracion_horas: number | null;
  /** Ley de laboratorio de esa colada, si la hay (solo informativa). */
  ley_sn_real: number | null;
  responsable: string;
  horno: string;
  observaciones: string;
  /** % de Sn de SU escoria según el ensayo XRF. Lo carga quien arma el reporte. */
  sn_escoria_pct?: number | null;
  /** N° de la muestra de laboratorio de esa escoria. */
  muestra_escoria?: string;
}

/** Una colada con todo lo derivado ya calculado. */
export interface FilaColada extends ColadaReporte {
  mezcla_kg: number;
  sn_teorico_kg: number;
  rendimiento_pct: number | null;
  merma_kg: number;
  peso_prom_lingote: number | null;
  sn_recuperable_kg: number;
}

/** Un ciclo de recuperación de escoria (por defecto, dos coladas). */
export interface GrupoCiclo {
  etiqueta: string;
  coladas: FilaColada[];
  casiterita_kg: number;
  sn_teorico_kg: number;
  estano_kg: number;
  escoria_kg: number;
  sn_recuperable_kg: number;
  estano_potencial_kg: number;
  rendimiento_pct: number | null;
  rendimiento_potencial_pct: number | null;
}

export interface TotalesPeriodo {
  coladas: number;
  casiterita_kg: number;
  coque_kg: number;
  caliza_kg: number;
  mezcla_kg: number;
  sn_teorico_kg: number;
  estano_kg: number;
  escoria_kg: number;
  n_lingotes: number;
  sn_recuperable_kg: number;
  merma_kg: number;
  rendimiento_pct: number | null;
  rendimiento_potencial_pct: number | null;
  duracion_prom_horas: number | null;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Redondeo a 2 decimales, para comparar e imprimir sin arrastrar coma flotante. */
export const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Masa total que entró al horno: casiterita + fundentes. */
export function mezclaKg(c: Pick<ColadaReporte, 'casiterita_kg' | 'coque_kg' | 'caliza_kg'>): number {
  return r2(n(c.casiterita_kg) + n(c.coque_kg) + n(c.caliza_kg));
}

/** Estaño que la casiterita DEBERÍA contener, según el tenor aplicado. */
export function snTeoricoKg(casiteritaKg: number, tenorPct: number): number {
  return r2(n(casiteritaKg) * (n(tenorPct) / 100));
}

/** Rendimiento: lo obtenido sobre lo teórico. `null` si no hay contra qué medir. */
export function rendimientoPct(obtenidoKg: number, teoricoKg: number): number | null {
  const t = n(teoricoKg);
  if (t <= 0) return null;
  return r2((n(obtenidoKg) / t) * 100);
}

/**
 * Merma de masa: lo que entró al horno menos lo que salió como producto y
 * como escoria. Es masa perdida en el proceso (gases, polvo, adherencias).
 */
export function mermaKg(c: Pick<ColadaReporte, 'casiterita_kg' | 'coque_kg' | 'caliza_kg' | 'estano_kg' | 'escoria_kg'>): number {
  return r2(mezclaKg(c) - n(c.estano_kg) - n(c.escoria_kg));
}

/** Estaño que todavía queda dentro de la escoria, según su ensayo XRF. */
export function snRecuperableKg(escoriaKg: number, snEscoriaPct: number | null | undefined): number {
  const pct = n(snEscoriaPct);
  if (pct <= 0) return 0;
  return r2(n(escoriaKg) * (pct / 100));
}

/** Peso promedio de cada lingote. `null` si no se contaron. */
export function pesoPromLingote(estanoKg: number, lingotes: number | null | undefined): number | null {
  const l = n(lingotes);
  if (l <= 0) return null;
  return r2(n(estanoKg) / l);
}

/** Una colada con todas sus cuentas hechas. */
export function filaColada(c: ColadaReporte, tenorPct: number): FilaColada {
  const sn_teorico_kg = snTeoricoKg(c.casiterita_kg, tenorPct);
  return {
    ...c,
    mezcla_kg: mezclaKg(c),
    sn_teorico_kg,
    rendimiento_pct: rendimientoPct(c.estano_kg, sn_teorico_kg),
    merma_kg: mermaKg(c),
    peso_prom_lingote: pesoPromLingote(c.estano_kg, c.n_lingotes),
    sn_recuperable_kg: snRecuperableKg(c.escoria_kg, c.sn_escoria_pct),
  };
}

/**
 * Arma los ciclos de recuperación de escoria.
 *
 * `porCiclo` es cuántas coladas entran en cada ciclo (2 en Matanzas). Si el
 * período tiene un número impar, el último grupo queda con las que sobren:
 * es un ciclo incompleto, no un error.
 */
export function agruparPorCiclo(filas: FilaColada[], porCiclo = 2): GrupoCiclo[] {
  const tamaño = Math.max(1, Math.floor(porCiclo));
  const grupos: GrupoCiclo[] = [];
  for (let i = 0; i < filas.length; i += tamaño) {
    const trozo = filas.slice(i, i + tamaño);
    const casiterita_kg = r2(trozo.reduce((a, f) => a + n(f.casiterita_kg), 0));
    const sn_teorico_kg = r2(trozo.reduce((a, f) => a + n(f.sn_teorico_kg), 0));
    const estano_kg = r2(trozo.reduce((a, f) => a + n(f.estano_kg), 0));
    const escoria_kg = r2(trozo.reduce((a, f) => a + n(f.escoria_kg), 0));
    const sn_recuperable_kg = r2(trozo.reduce((a, f) => a + n(f.sn_recuperable_kg), 0));
    const estano_potencial_kg = r2(estano_kg + sn_recuperable_kg);
    grupos.push({
      etiqueta: `Grupo ${grupos.length + 1} — ${trozo.map((f) => `Colada #${f.colada_num}`).join(' + ')}`,
      coladas: trozo,
      casiterita_kg,
      sn_teorico_kg,
      estano_kg,
      escoria_kg,
      sn_recuperable_kg,
      estano_potencial_kg,
      rendimiento_pct: rendimientoPct(estano_kg, sn_teorico_kg),
      rendimiento_potencial_pct: rendimientoPct(estano_potencial_kg, sn_teorico_kg),
    });
  }
  return grupos;
}

/** Los totales del período completo. */
export function totalesPeriodo(filas: FilaColada[]): TotalesPeriodo {
  const suma = (f: (x: FilaColada) => number): number => r2(filas.reduce((a, x) => a + n(f(x)), 0));
  const casiterita_kg = suma((f) => f.casiterita_kg);
  const sn_teorico_kg = suma((f) => f.sn_teorico_kg);
  const estano_kg = suma((f) => f.estano_kg);
  const sn_recuperable_kg = suma((f) => f.sn_recuperable_kg);
  const conDuracion = filas.filter((f) => n(f.duracion_horas) > 0);
  return {
    coladas: filas.length,
    casiterita_kg,
    coque_kg: suma((f) => f.coque_kg),
    caliza_kg: suma((f) => f.caliza_kg),
    mezcla_kg: suma((f) => f.mezcla_kg),
    sn_teorico_kg,
    estano_kg,
    escoria_kg: suma((f) => f.escoria_kg),
    n_lingotes: Math.round(filas.reduce((a, f) => a + n(f.n_lingotes), 0)),
    sn_recuperable_kg,
    // Merma del período medida en ESTAÑO, no en masa: lo teórico menos lo que
    // se obtuvo y lo que todavía se puede sacar de la escoria. Restar la masa
    // entera de la escoria daría un balance negativo, porque esa masa es
    // mayormente hierro, tántalo y niobio, no estaño.
    merma_kg: r2(sn_teorico_kg - estano_kg - sn_recuperable_kg),
    rendimiento_pct: rendimientoPct(estano_kg, sn_teorico_kg),
    rendimiento_potencial_pct: rendimientoPct(r2(estano_kg + sn_recuperable_kg), sn_teorico_kg),
    duracion_prom_horas: conDuracion.length
      ? r2(conDuracion.reduce((a, f) => a + n(f.duracion_horas), 0) / conDuracion.length)
      : null,
  };
}

/** Primera y última fecha del período elegido. */
export function periodoDe(filas: Array<{ fecha: string }>): { desde: string; hasta: string } | null {
  const fechas = filas.map((f) => (f.fecha ?? '').trim()).filter(Boolean).sort();
  if (!fechas.length) return null;
  return { desde: fechas[0], hasta: fechas[fechas.length - 1] };
}

/** Deja solo las coladas cuya fecha cae dentro del rango (los bordes incluidos). */
export function enRango<T extends { fecha: string }>(filas: T[], desde: string, hasta: string): T[] {
  const d = (desde ?? '').trim();
  const h = (hasta ?? '').trim();
  return filas.filter((f) => {
    const x = (f.fecha ?? '').trim();
    if (!x) return false;
    if (d && x < d) return false;
    if (h && x > h) return false;
    return true;
  });
}

/**
 * Los hallazgos que el reporte puede afirmar por sí solo, mirando los números.
 *
 * No inventa conclusiones: cada línea sale de una comparación concreta y
 * nombra la colada de la que habla.
 */
export function hallazgos(filas: FilaColada[], grupos: GrupoCiclo[], tot: TotalesPeriodo, tenorPct: number): string[] {
  const out: string[] = [];
  if (!filas.length) return out;

  const conEscoria = filas.filter((f) => n(f.escoria_kg) > 0).map((f) => `#${f.colada_num}`);
  const sinEscoria = filas.filter((f) => n(f.escoria_kg) <= 0).map((f) => `#${f.colada_num}`);
  if (conEscoria.length && sinEscoria.length) {
    out.push(`Se recuperó escoria en las coladas ${conEscoria.join(', ')} y no en ${sinEscoria.join(', ')}. Conviene validar con planta qué criterio define la recuperación, porque no se ajusta a un ciclo fijo.`);
  }

  const conRend = filas.filter((f) => f.rendimiento_pct != null);
  if (conRend.length > 1) {
    const mejor = conRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) > (a.rendimiento_pct ?? 0) ? b : a));
    const peor = conRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) < (a.rendimiento_pct ?? 0) ? b : a));
    out.push(`El mejor rendimiento individual fue el de la colada #${mejor.colada_num} (${mejor.rendimiento_pct} %) y el más bajo el de la #${peor.colada_num} (${peor.rendimiento_pct} %).`);
  }

  const gruposRend = grupos.filter((g) => g.rendimiento_pct != null);
  if (gruposRend.length > 1) {
    const mejorG = gruposRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) > (a.rendimiento_pct ?? 0) ? b : a));
    const peorG = gruposRend.reduce((a, b) => ((b.rendimiento_pct ?? 0) < (a.rendimiento_pct ?? 0) ? b : a));
    out.push(`Por ciclo de escoria, el mejor fue el ${mejorG.etiqueta} (${mejorG.rendimiento_pct} %) y el más bajo el ${peorG.etiqueta} (${peorG.rendimiento_pct} %).`);
  }

  if (tot.sn_recuperable_kg > 0 && tot.estano_kg > 0) {
    const extra = r2((tot.sn_recuperable_kg / tot.estano_kg) * 100);
    out.push(`Las escorias del período contienen ${tot.sn_recuperable_kg} kg de estaño recuperable, un ${extra} % adicional sobre los ${tot.estano_kg} kg ya obtenidos. Reprocesarlas llevaría el rendimiento de ${tot.rendimiento_pct} % a ${tot.rendimiento_potencial_pct} %.`);
  }

  const reales = filas.filter((f) => n(f.ley_sn_real) > 0);
  if (reales.length) {
    const dispares = reales.filter((f) => Math.abs(n(f.ley_sn_real) - n(tenorPct)) >= 1);
    if (dispares.length) {
      out.push(`El reporte usa un tenor fijo de ${tenorPct} %, pero ${dispares.length} de ${filas.length} coladas tienen una ley de laboratorio distinta (${dispares.map((f) => `#${f.colada_num}: ${f.ley_sn_real} %`).join(', ')}). El tenor aplicado impacta directo el rendimiento calculado.`);
    }
  }

  const sinTemp = filas.filter((f) => f.temp_colada == null).map((f) => `#${f.colada_num}`);
  if (sinTemp.length) out.push(`Sin temperatura de colada registrada: ${sinTemp.join(', ')}.`);

  return out;
}
