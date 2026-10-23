/* ============================================================
   Golden Touch · Retenciones · «Probar la regla» (R7)

   Arma el contexto de una prueba (lo que escribe la persona más los datos de
   la fecha: UT, parámetros, valor de la clasificación, tarifa, régimen de la
   empresa), corre el motor y, al lado, el cálculo de hoy
   (retencionesCalculo.ts) con los mismos datos, para ver si coinciden antes
   de activar la regla. La parte pura se prueba sola; el cargador lee cada
   dato solo si su paquete existe y, si no, usa la configuración de hoy.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import {
  calcularIgtf, calcularRetencionIslr, calcularRetencionIva, calcularRetencionLocal,
  type ConceptoRetencion, type ConfigRetencion,
} from './retencionesCalculo';
import { calcularConRegla, condicionesQueFallan, type ContextoCalculo, type Regla, type ResultadoMotor, type SujetoGt, type Tramo } from './motorReglas';

/** Lo que se escribe en «Probar». */
export interface EntradaPrueba {
  fecha: string;
  direccion: 'practicada' | 'sufrida';
  sujeto: SujetoGt | null;
  moneda: string;
  tasa: number | null;
  pago: number;
  baseImponible: number;
  iva: number;
  supuesto: boolean;
  /** Código elegido de la clasificación de la regla (si la usa). */
  codigo: string | null;
}

/** Los datos de la fecha que hacen falta. */
export interface DatosPrueba {
  ut: number | null;
  parametros: Record<string, number | null>;
  condicionesAgente: string[];
  valorClasificacion: ContextoCalculo['valorClasificacion'];
  clasificacionClave: string | null;
  tarifas: Record<string, { tramos: Tramo[]; unidad: 'UT' | 'Bs' }>;
  config: ConfigRetencion;
}

export interface ResultadoPrueba {
  condicionesQueFallan: string[];
  motor: ResultadoMotor;
  /** Lo que da hoy retencionesCalculo.ts con los mismos datos (null si ese impuesto no tiene cálculo de hoy). */
  hoy: { monto: number; explicacion: string } | null;
  coinciden: boolean | null;
}

/** Las claves de parámetros y la clasificación o tarifa que usa una regla. */
export function loQueUsa(regla: Pick<Regla, 'pasos' | 'condiciones'>): { parametros: string[]; clasificacion: string | null; tarifas: string[] } {
  const parametros = new Set<string>(); const tarifas = new Set<string>(); let clasificacion: string | null = null;
  for (const p of regla.pasos) {
    const v = p.valores ?? {};
    for (const k of ['parametro', 'supuestos']) if (typeof v[k] === 'string') parametros.add(v[k] as string);
    if (typeof v.clasificacion === 'string') clasificacion = v.clasificacion;
    if (typeof v.tarifa === 'string') tarifas.add(v.tarifa);
  }
  for (const c of regla.condiciones) {
    if (c.pieza === 'clasificacion') clasificacion = (c.valor as { clasificacion?: string }).clasificacion ?? clasificacion;
  }
  return { parametros: [...parametros], clasificacion, tarifas: [...tarifas] };
}

/** El contexto del motor con lo escrito y los datos de la fecha. */
export function contextoDePrueba(e: EntradaPrueba, d: DatosPrueba): ContextoCalculo {
  return {
    direccion: e.direccion, sujeto: e.sujeto, condicionesAgente: d.condicionesAgente,
    clasificacion: d.clasificacionClave && e.codigo ? { clave: d.clasificacionClave, codigo: e.codigo } : null,
    montos: { pago: e.pago, base_imponible: e.baseImponible, iva: e.iva, pago_divisas: e.moneda !== 'Bs' ? e.pago : 0, total: e.baseImponible + e.iva },
    moneda: e.moneda, tasa: e.tasa, ut: d.ut,
    parametro: (k) => d.parametros[k] ?? null,
    valorClasificacion: d.valorClasificacion ?? null, supuesto: e.supuesto,
    tarifa: (k) => d.tarifas[k] ?? null,
  };
}

/** Lo que da hoy retencionesCalculo.ts para el impuesto, con los mismos datos. */
export function calculoDeHoy(impuesto: string, e: EntradaPrueba, d: DatosPrueba): { monto: number; explicacion: string } | null {
  const cfg: ConfigRetencion = {
    ...d.config, valorUt: d.ut ?? d.config.valorUt,
    pctIvaGeneral: d.parametros.pct_retencion ?? d.config.pctIvaGeneral,
    pctIvaEspecial: d.parametros.pct_retencion_art5 ?? d.config.pctIvaEspecial,
    pctIgtf: impuesto === 'IGTF' ? d.parametros.alicuota ?? d.config.pctIgtf : d.config.pctIgtf,
  };
  const vc = d.valorClasificacion;
  const concepto = (pct: number, base = 100, extra: Partial<ConceptoRetencion> = {}): ConceptoRetencion => ({
    id: 'prueba', tipo: 'islr', codigo: e.codigo, nombre: 'prueba', sujeto: 'todos', porcentaje: pct, basePct: base,
    aplicaSustraendo: false, baseMinimaUt: 0, fundamento: null, activo: true, orden: 0, ...extra,
  });
  let c;
  if (impuesto === 'IVA') c = calcularRetencionIva({ baseImponible: e.baseImponible, ivaFactura: e.iva, motivos: e.supuesto ? { ivaNoDiscriminado: true } : {} }, cfg);
  else if (impuesto === 'ISLR') {
    if (!vc || vc.pct == null) return null;
    c = calcularRetencionIslr({
      montoPago: e.pago, moneda: e.moneda, tasa: e.tasa ?? undefined,
      concepto: concepto(vc.pct, vc.basePct, { aplicaSustraendo: vc.sustraendoFactor != null, baseMinimaUt: vc.minimoUnidad === 'UT' ? vc.minimo ?? 0 : 0 }),
    }, cfg);
  } else if (impuesto === 'MUNICIPAL' || impuesto === 'ESTADAL') {
    const pct = d.parametros.alicuota ?? vc?.pct ?? null;
    if (pct == null) return null;
    c = calcularRetencionLocal({ montoPago: e.pago, concepto: concepto(pct, vc?.basePct ?? 100, { tipo: impuesto === 'MUNICIPAL' ? 'municipal' : 'regional' }) }, impuesto === 'MUNICIPAL' ? 'municipal' : 'regional');
  } else if (impuesto === 'IGTF') c = calcularIgtf({ montoPago: e.pago, enDivisas: e.moneda !== 'Bs' }, cfg);
  else return null;
  return { monto: c.montoRetenido, explicacion: c.explicacion };
}

/** Corre la prueba: condiciones, motor y el cálculo de hoy al lado. */
export function correrPrueba(regla: Regla, e: EntradaPrueba, d: DatosPrueba): ResultadoPrueba {
  const ctx = contextoDePrueba(e, d);
  const motor = calcularConRegla(regla, ctx);
  const hoy = calculoDeHoy(regla.impuestoClave, e, d);
  return { condicionesQueFallan: condicionesQueFallan(regla, ctx), motor, hoy, coinciden: hoy ? Math.abs(hoy.monto - motor.monto) < 0.005 : null };
}

/* ───────── Cargar los datos de la fecha ───────── */

/** Lee los datos que usa la regla para la fecha. Cada fuente, solo si su paquete existe; si no, la configuración de hoy. */
export async function cargarDatosPrueba(regla: Regla, e: EntradaPrueba): Promise<DatosPrueba> {
  const usa = loQueUsa(regla);
  const [{ getConfigRetencion, getAlicuotasLocales }, { r3Disponible, parametroEnFecha }, { tablaDisponible }] = await Promise.all([
    import('./retencionesFiscal.repository'), import('./parametros.repository'), import('./disponibilidad'),
  ]);
  const config = await getConfigRetencion();
  const conR3 = await r3Disponible();
  const ut = conR3 ? ((await parametroEnFecha(null, 'ut', e.fecha)) as number | null) : config.valorUt || null;

  const parametros: Record<string, number | null> = {};
  const locales = conR3 ? null : await getAlicuotasLocales().catch(() => null);
  for (const k of usa.parametros) {
    if (conR3) { const v = await parametroEnFecha(regla.impuestoClave, k, e.fecha); parametros[k] = typeof v === 'number' ? v : null; continue; }
    parametros[k] = k === 'pct_retencion' ? config.pctIvaGeneral : k === 'pct_retencion_art5' ? config.pctIvaEspecial
      : k === 'alicuota' ? (regla.impuestoClave === 'IGTF' ? config.pctIgtf : regla.impuestoClave === 'MUNICIPAL' ? locales?.municipal ?? null : regla.impuestoClave === 'ESTADAL' ? locales?.estadal ?? null : null)
        : null;
  }

  const condicionesAgente: string[] = [];
  if (await tablaDisponible('retencion_agente_condiciones')) {
    const { consultarCondicion } = await import('./agenteCondiciones.repository');
    if (await consultarCondicion('IVA', 'agente_retencion', e.fecha)) condicionesAgente.push('agente_retencion');
    if (await consultarCondicion(null, 'contribuyente_especial', e.fecha)) condicionesAgente.push('contribuyente_especial');
  } else {
    if (config.esAgenteRetencionIva) condicionesAgente.push('agente_retencion');
    if (config.esContribuyenteEspecial) condicionesAgente.push('contribuyente_especial');
  }

  let valorClasificacion: DatosPrueba['valorClasificacion'] = null;
  if (usa.clasificacion && e.codigo && (await tablaDisponible('retencion_clasificaciones'))) {
    const { data: k } = await supabase.from('retencion_clasificaciones').select('id').eq('clave', usa.clasificacion).maybeSingle();
    const { data: c } = k ? await supabase.from('retencion_clasificacion_codigos').select('id').eq('clasificacion_id', (k as { id: string }).id).eq('codigo', e.codigo).maybeSingle() : { data: null };
    if (c) {
      const { data: v } = await supabase.rpc('retencion_clasificacion_valor', { p_codigo_id: (c as { id: string }).id, p_sujeto: e.sujeto, p_fecha: e.fecha });
      const fila = (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;
      if (fila) {
        valorClasificacion = {
          pct: fila.pct == null ? null : Number(fila.pct), basePct: Number(fila.base_pct ?? 100),
          minimo: fila.minimo == null ? null : Number(fila.minimo), minimoUnidad: (fila.minimo_unidad as 'UT' | 'Bs' | 'MMV' | null) ?? null,
          sustraendoFactor: fila.sustraendo_factor == null ? null : Number(fila.sustraendo_factor),
        };
        // R5: si el valor usa una tarifa por tramos, sus tramos publicados a la fecha.
        if (fila.tarifa_id && valorClasificacion) {
          const { listTarifas, versionAplicable } = await import('./tarifas.repository');
          const t = (await listTarifas()).find((x) => x.id === String(fila.tarifa_id));
          const v = t ? versionAplicable(t, e.fecha) : null;
          valorClasificacion.tarifa = t && v ? { tramos: v.tramos, unidad: t.unidad } : null;
        }
      }
    }
  }

  const tarifas: DatosPrueba['tarifas'] = {};
  if (usa.tarifas.length && (await tablaDisponible('retencion_tarifas'))) {
    const { listTarifas, versionAplicable } = await import('./tarifas.repository');
    for (const t of await listTarifas()) {
      if (!usa.tarifas.includes(t.clave)) continue;
      const v = versionAplicable(t, e.fecha);
      if (v) tarifas[t.clave] = { tramos: v.tramos, unidad: t.unidad };
    }
  }

  return { ut, parametros, condicionesAgente, valorClasificacion, clasificacionClave: usa.clasificacion, tarifas, config };
}
