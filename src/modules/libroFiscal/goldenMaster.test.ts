/* ============================================================
   Golden Touch · Retenciones · Golden-master (F0)

   Blinda el cálculo antes de despertar ninguna regla: prueba, al céntimo, que
   el MOTOR de reglas (tal como lo corre el registro vivo: contextoDePrueba +
   calcularConRegla, vía correrPrueba) da EXACTAMENTE lo mismo que el cálculo
   viejo (calcularRetencionIva/Islr/Local, calcularIgtf), para una matriz amplia
   por impuesto.

   Política ante divergencia: manda el cálculo viejo. Cualquier diferencia > 0
   (ni un céntimo) deja esa regla NO apta para promover; se reconcilia la
   fórmula del motor o la regla, nunca se baja la tolerancia.

   ── REGLAS REALES ──────────────────────────────────────────────────────────
   Las 5 reglas en_prueba REALES (export del Carril BD GT, 2026-10-31, producción
   solo-lectura) están en __fixtures__/F0-reglas-en-prueba.json, con la forma de
   la tabla. Se pasan por aRegla() — el mismo mapeo del repositorio — para obtener
   un Regla idéntico al de producción; no se reconstruyen a mano.

   ── DATOS DE LA FECHA (snapshot 2026-10-31) ─────────────────────────────────
   DatosPrueba se arma a mano con los valores vigentes que entregó BD (UT,
   parámetros R3, valores de clasificación R4). No se llama a cargarDatosPrueba
   (eso pega a la base). Es el mismo puente que usa «Probar la regla».
   ============================================================ */
import { describe, expect, it, vi } from 'vitest';

// aRegla() importa el repositorio, que a su vez importa el cliente de supabase.
// El golden-master es offline y aRegla no toca la base, así que se neutraliza el cliente.
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));

import { calcularConRegla, condicionesQueFallan, type Regla } from './motorReglas';
import { aRegla } from './reglas.repository';
import { contextoDePrueba, correrPrueba, type DatosPrueba, type EntradaPrueba } from './probarRegla';
import { CONFIG_RETENCION_DEFECTO } from './retencionesCalculo';
import filasReglas from './__fixtures__/F0-reglas-en-prueba.json';

type ClaveImp = 'IVA' | 'ISLR' | 'MUNICIPAL' | 'ESTADAL' | 'IGTF';

/* ─────────── Las 5 reglas reales, por aRegla (idénticas a producción) ─────────── */
const REGLAS = Object.fromEntries(
  (filasReglas as Record<string, unknown>[]).map((fila) => [String(fila.impuesto_clave), aRegla(fila) as Regla]),
) as Record<ClaveImp, Regla>;

/* ─────────── Datos de la fecha (snapshot 2026-10-31 de BD) ─────────── */
const UT = 43; // Bs, desde 2025-06-02
const PARAMS = { pct_retencion: 75, pct_retencion_art5: 100, alicuota_municipal: 1, alicuota_estadal: 1, alicuota_igtf: 3 };

// Valores de clasificación del ISLR (retencion_clasificacion_valor), por concepto y sujeto.
// minimoUnidad='UT' ⇒ mínimo en Bs = minimo×UT; sustraendo = (pct/100)×UT×sustraendoFactor.
type VC = NonNullable<DatosPrueba['valorClasificacion']>;
const SIN_MIN: Pick<VC, 'minimo' | 'minimoUnidad' | 'sustraendoFactor'> = { minimo: null, minimoUnidad: null, sustraendoFactor: null };
const CON_MIN: Pick<VC, 'minimo' | 'minimoUnidad' | 'sustraendoFactor'> = { minimo: 83.3334, minimoUnidad: 'UT', sustraendoFactor: 83.3334 };
const VC_ISLR = {
  // Jurídica domiciliada (PJD): sin mínimo ni sustraendo.
  pjd_honorarios: { pct: 5, basePct: 100, ...SIN_MIN } as VC,   // 001
  pjd_servicios: { pct: 2, basePct: 100, ...SIN_MIN } as VC,    // 003
  pjd_transporte_intl: { pct: 5, basePct: 10, ...SIN_MIN } as VC, // 008 (porción de base 10 %)
  // Natural residente (PNR): con mínimo (UT) y sustraendo.
  pnr_honorarios: { pct: 3, basePct: 100, ...CON_MIN } as VC,   // 001
  pnr_servicios: { pct: 1, basePct: 100, ...CON_MIN } as VC,    // 003
};

const CONFIG = { ...CONFIG_RETENCION_DEFECTO, valorUt: UT };

/** DatosPrueba para un impuesto, con los parámetros/valores que lee su regla. */
function datos(imp: ClaveImp, over: Partial<DatosPrueba> = {}): DatosPrueba {
  const parametros: Record<string, number | null> = {};
  if (imp === 'IVA') { parametros.pct_retencion = PARAMS.pct_retencion; parametros.pct_retencion_art5 = PARAMS.pct_retencion_art5; }
  if (imp === 'MUNICIPAL') parametros.alicuota = PARAMS.alicuota_municipal;
  if (imp === 'ESTADAL') parametros.alicuota = PARAMS.alicuota_estadal;
  if (imp === 'IGTF') parametros.alicuota = PARAMS.alicuota_igtf;
  return {
    ut: UT, parametros,
    // Régimen de GT a 2026-10-31: solo agente de retención (contribuyente_especial=false).
    condicionesAgente: ['agente_retencion'],
    valorClasificacion: imp === 'ISLR' ? VC_ISLR.pnr_honorarios : null,
    clasificacionClave: imp === 'ISLR' ? 'islr_conceptos' : null,
    tarifas: {}, config: { ...CONFIG, pctIgtf: PARAMS.alicuota_igtf },
    ...over,
  };
}

/** EntradaPrueba con valores por defecto neutros. */
function entrada(over: Partial<EntradaPrueba> = {}): EntradaPrueba {
  return {
    fecha: '2026-10-31', direccion: 'practicada', sujeto: null, moneda: 'Bs', tasa: null,
    pago: 0, baseImponible: 0, iva: 0, supuesto: false, codigo: null, ...over,
  };
}

/** Corre motor y viejo con los mismos datos; exige que el monto coincida al céntimo. */
function exigirIgual(imp: ClaveImp, e: EntradaPrueba, d: DatosPrueba) {
  const r = correrPrueba(REGLAS[imp], e, d);
  expect(r.condicionesQueFallan, 'la regla tiene que aplicar a este caso').toEqual([]);
  expect(r.hoy, 'el cálculo viejo tiene que existir para este impuesto').not.toBeNull();
  // Ni un céntimo: el monto del motor y el viejo, redondeados a 2 decimales, idénticos.
  expect(r.motor.monto).toBe(r.hoy!.monto);
  expect(r.coinciden).toBe(true);
  return r;
}

describe('golden-master · reglas REALES en_prueba (snapshot BD 2026-10-31)', () => {
  it('las 5 reglas se cargan por aRegla y son las esperadas', () => {
    expect(Object.keys(REGLAS).sort()).toEqual(['ESTADAL', 'IGTF', 'ISLR', 'IVA', 'MUNICIPAL']);
    for (const r of Object.values(REGLAS)) expect(r.estado).toBe('en_prueba');
  });

  describe('IVA', () => {
    it('75 % general del IVA de la factura', () => {
      const r = exigirIgual('IVA', entrada({ baseImponible: 1000, iva: 160 }), datos('IVA'));
      expect(r.motor.monto).toBe(120);
    });
    it('100 % (supuesto art. 5): coincide porque los 5 supuestos reales tienen pct 100', () => {
      const r = exigirIgual('IVA', entrada({ baseImponible: 1000, iva: 160, supuesto: true }), datos('IVA'));
      expect(r.motor.monto).toBe(160);
    });
    it('IVA = 0: no hay sobre qué retener, da 0 igual que hoy', () => {
      exigirIgual('IVA', entrada({ baseImponible: 1000, iva: 0 }), datos('IVA'));
    });
    it('empresa NO agente: la regla no aplica (condición falla) → en producción se queda el viejo', () => {
      const ctx = contextoDePrueba(entrada({ baseImponible: 1000, iva: 160 }), datos('IVA', { condicionesAgente: [] }));
      expect(condicionesQueFallan(REGLAS.IVA, ctx).length).toBeGreaterThan(0);
    });
    it('montos con decimales: redondeo a 2 idéntico', () => {
      exigirIgual('IVA', entrada({ baseImponible: 1234.56, iva: 197.53 }), datos('IVA'));
    });
  });

  describe('ISLR', () => {
    const codigo = (cod: string, over: Partial<EntradaPrueba> = {}) => entrada({ codigo: cod, ...over });
    it('PNR Honorarios (001): mínimo en UT y sustraendo en Bs', () => {
      const r = exigirIgual('ISLR', codigo('001', { pago: 10000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_honorarios }));
      expect(r.motor.monto).toBe(192.5); // 3% de 10000 − (3/100·43·83,3334)
      expect(r.motor.sustraendo).toBeGreaterThan(0);
    });
    it('PNR Servicios (003): pct 1, mismo mínimo y sustraendo', () => {
      exigirIgual('ISLR', codigo('003', { pago: 20000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_servicios }));
    });
    it('PJD Honorarios (001): pct 5, sin mínimo ni sustraendo', () => {
      const r = exigirIgual('ISLR', codigo('001', { pago: 5000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pjd_honorarios }));
      expect(r.motor.sustraendo).toBe(0);
    });
    it('PJD Servicios (003): pct 2', () => {
      exigirIgual('ISLR', codigo('003', { pago: 5000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pjd_servicios }));
    });
    it('PJD Transporte internacional (008): pct 5 sobre el 10 % de la base', () => {
      const r = exigirIgual('ISLR', codigo('008', { pago: 30000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pjd_transporte_intl }));
      expect(r.motor.base).toBe(3000); // 10 % de 30000
    });
    it('PNR bajo el mínimo: no se retiene (0), igual que hoy', () => {
      const r = exigirIgual('ISLR', codigo('001', { pago: 3000 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_honorarios }));
      expect(r.motor.monto).toBe(0);
      expect(r.motor.aplica).toBe(false);
    });
    it('PNR EN DIVISAS: base en la moneda, mínimo y sustraendo en Bs (tasa BCV de la factura)', () => {
      const r = exigirIgual('ISLR', codigo('001', { pago: 100, moneda: 'USD', tasa: 40 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_honorarios }));
      expect(r.motor.baseBs).toBe(4000);
      expect(r.motor.montoBs).toBe(Math.round(r.motor.monto * 40 * 100) / 100);
    });
    it('PNR en divisas bajo el mínimo (base en Bs no llega): 0, igual que hoy', () => {
      exigirIgual('ISLR', codigo('001', { pago: 50, moneda: 'USD', tasa: 40 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_honorarios }));
    });
    it('PNR decimales en divisas: redondeo a 2 idéntico', () => {
      exigirIgual('ISLR', codigo('001', { pago: 137.77, moneda: 'USD', tasa: 38.42 }), datos('ISLR', { valorClasificacion: VC_ISLR.pnr_honorarios }));
    });
  });

  describe('MUNICIPAL (ISAE)', () => {
    for (const pct of [1, 0.5, 2, 3.75]) {
      it(`alícuota ${pct} %`, () => {
        exigirIgual('MUNICIPAL', entrada({ pago: 8500 }), datos('MUNICIPAL', { parametros: { alicuota: pct } }));
      });
    }
  });

  describe('ESTADAL (timbre fiscal)', () => {
    for (const pct of [1, 0.25, 0.5]) {
      it(`alícuota ${pct} % (aunque GT lo deshabilite, se cubre)`, () => {
        exigirIgual('ESTADAL', entrada({ pago: 12000 }), datos('ESTADAL', { parametros: { alicuota: pct } }));
      });
    }
  });

  describe('IGTF', () => {
    it('3 % sobre lo pagado en divisas', () => {
      const r = exigirIgual('IGTF', entrada({ pago: 100, moneda: 'USD', tasa: 40 }), datos('IGTF'));
      expect(r.motor.monto).toBe(3);
    });
    it('sin condición «practicada»: no se apaga por dirección (aplica igual en «sufrida»)', () => {
      const d = datos('IGTF');
      expect(condicionesQueFallan(REGLAS.IGTF, contextoDePrueba(entrada({ pago: 100, moneda: 'USD', tasa: 40 }), d))).toEqual([]);
      const ctxSuf = contextoDePrueba(entrada({ pago: 100, moneda: 'USD', tasa: 40, direccion: 'sufrida' }), d);
      expect(condicionesQueFallan(REGLAS.IGTF, ctxSuf)).toEqual([]);
      expect(calcularConRegla(REGLAS.IGTF, ctxSuf).monto).toBe(3);
    });
    it('pago en Bs: no causa IGTF (pago_divisas = 0), da 0 igual que hoy', () => {
      exigirIgual('IGTF', entrada({ pago: 100, moneda: 'Bs' }), datos('IGTF'));
    });
    it('decimales: redondeo a 2 idéntico', () => {
      exigirIgual('IGTF', entrada({ pago: 733.37, moneda: 'USD', tasa: 1 }), datos('IGTF'));
    });
  });
});
