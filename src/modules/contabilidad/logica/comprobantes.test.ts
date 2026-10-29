import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import type { ContComprobante } from '../tipos';
import {
  codigoComprobante, cuadreDe, descripcionReverso, erroresDeComprobante, ladoDe, montosDeRenglon, periodoDeFecha,
  renglonesDeReverso, siguienteNumero, statusDe, tasaVigente, totalesDe,
  type CabeceraBorrador, type ContextoValidacion, type RenglonBorrador,
} from './comprobantes';

const e = estadoDePrueba();
const ctx: ContextoValidacion = {
  cuentas: e.cont_cuentas, centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
  periodos: e.cont_periodos, parametros: e.cont_parametros, hoy: '2026-10-20',
};
const cab = (x: Partial<CabeceraBorrador> = {}): CabeceraBorrador => ({
  tipo_id: 'tc-09', fecha: '2026-10-01', concepto: 'PRUEBA', moneda_documento: 'USD', tasa: 186, origen_ref: '', ...x,
});
const r = (cuenta: string, lado: 'debe' | 'haber', monto: number, x: Partial<RenglonBorrador> = {}): RenglonBorrador => ({
  cuenta_id: `cta-${cuenta}`, fecha_referencia: null, referencia: '', auxiliar_id: null, centro_costo_id: null,
  descripcion: '', moneda: 'USD', monto_moneda: monto, lado, tasa: 186, ...x,
});

describe('doble moneda', () => {
  it('un renglón en USD guarda el monto en USD y monto × tasa en Bs', () => {
    expect(montosDeRenglon({ moneda: 'USD', monto_moneda: 100, lado: 'debe', tasa: 186 }, 186))
      .toEqual({ debe_ves: 18600, haber_ves: 0, debe_usd: 100, haber_usd: 0 });
  });

  it('un renglón en Bs pasa a USD con la tasa del comprobante', () => {
    expect(montosDeRenglon({ moneda: 'VES', monto_moneda: 1000, lado: 'haber', tasa: 1 }, 186))
      .toEqual({ debe_ves: 0, haber_ves: 1000, debe_usd: 0, haber_usd: 5.38 });
  });

  it('un renglón en USDT pasa a Bs con su tasa y de Bs a USD con la del dólar', () => {
    expect(montosDeRenglon({ moneda: 'USDT', monto_moneda: 100, lado: 'debe', tasa: 193.44 }, 186))
      .toEqual({ debe_ves: 19344, haber_ves: 0, debe_usd: 104, haber_usd: 0 });
  });

  it('el cuadre se mide en las dos monedas con la tolerancia', () => {
    const t = totalesDe([
      montosDeRenglon({ moneda: 'VES', monto_moneda: 1000, lado: 'debe', tasa: 1 }, 186),
      montosDeRenglon({ moneda: 'VES', monto_moneda: 1000, lado: 'haber', tasa: 1 }, 186),
    ]);
    expect(t.dif_ves).toBe(0);
    expect(cuadreDe(t, 0.01).cuadra).toBe(true);
    expect(cuadreDe({ ...t, dif_usd: 0.01 }, 0.01).cuadra_usd).toBe(true);
    expect(cuadreDe({ ...t, dif_usd: 0.02 }, 0.01).cuadra_usd).toBe(false);
  });

  it('los redondeos de varios renglones en Bs pueden descuadrar el USD aunque el Bs cuadre', () => {
    // 3 × 333,33 Bs contra 999,99 Bs: el Bs cuadra; en USD cada tercio redondea a 1,79 (5,37) y el total a 5,38.
    const lineas = [
      ...[1, 2, 3].map(() => montosDeRenglon({ moneda: 'VES', monto_moneda: 333.33, lado: 'debe', tasa: 1 }, 186)),
      montosDeRenglon({ moneda: 'VES', monto_moneda: 999.99, lado: 'haber', tasa: 1 }, 186),
    ];
    const t = totalesDe(lineas);
    expect(t.dif_ves).toBe(0);
    expect(t.dif_usd).toBe(-0.01);
    expect(cuadreDe(t, 0.01).cuadra).toBe(true); // dentro de la tolerancia del modelo
  });
});

describe('status de Galac', () => {
  const t = (debe: number, haber: number) => totalesDe([
    montosDeRenglon({ moneda: 'USD', monto_moneda: debe, lado: 'debe', tasa: 186 }, 186),
    montosDeRenglon({ moneda: 'USD', monto_moneda: haber, lado: 'haber', tasa: 186 }, 186),
  ]);
  it('Contabilizado si cuadra, Descuadrado si no', () => {
    expect(statusDe(t(10, 10), 0.01)).toBe('contabilizado');
    expect(statusDe(t(10, 9), 0.01)).toBe('descuadrado');
  });
  it('sin montos es Descuadrado (no hay nada que contabilizar)', () => {
    expect(statusDe(totalesDe([]), 0.01)).toBe('descuadrado');
  });
});

describe('fecha, período y tasa', () => {
  it('el período sale de la fecha y nunca es el 13', () => {
    expect(periodoDeFecha('2026-07-15', e.cont_periodos)?.codigo).toBe('202607');
    expect(periodoDeFecha('2026-12-31', e.cont_periodos)?.codigo).toBe('202612');
    expect(periodoDeFecha('2027-01-01', e.cont_periodos)).toBeNull();
  });

  it('la tasa es la del día o la última anterior; VES vale 1', () => {
    const tasas = [{ fecha: '2026-10-01', moneda: 'USD' as const, tasa_ves: 185 }, { fecha: '2026-10-03', moneda: 'USD' as const, tasa_ves: 187 }];
    expect(tasaVigente(tasas, 'USD', '2026-10-02')).toBe(185);
    expect(tasaVigente(tasas, 'USD', '2026-10-03')).toBe(187);
    expect(tasaVigente(tasas, 'USD', '2026-09-30')).toBeNull();
    expect(tasaVigente(tasas, 'VES', '2026-01-01')).toBe(1);
  });
});

describe('erroresDeComprobante (lo que impide grabar)', () => {
  it('un asiento bien escrito no tiene errores, cuadre o no', () => {
    expect(erroresDeComprobante(cab(), [r('6.2.01.01.001', 'debe', 25), r('1.1.01.01.002', 'haber', 25)], ctx)).toEqual([]);
    expect(erroresDeComprobante(cab(), [r('6.2.01.01.001', 'debe', 25), r('1.1.01.01.002', 'haber', 20)], ctx)).toEqual([]);
  });

  it('exige descripción y al menos un asiento', () => {
    const errores = erroresDeComprobante(cab({ concepto: ' ' }), [], ctx);
    expect(errores).toContain('Descripción del comprobante requerida.');
    expect(errores).toContain('El comprobante no tiene asientos.');
  });

  it('la cuenta tiene que ser de movimiento, activa y de la moneda que fija', () => {
    const errores = erroresDeComprobante(cab(), [r('1.1.01.01', 'debe', 25), r('1.1.01.01.002', 'haber', 25, { moneda: 'VES', tasa: 1 })], ctx).join(' ');
    expect(errores).toMatch(/1\.1\.01\.01 es Cuenta Título/);
    expect(errores).toMatch(/1\.1\.01\.01\.002 solo se mueve en USD/);
  });

  it('centro de costo y auxiliar obligatorios cuando la cuenta lo exige, y del tipo correcto', () => {
    const sinNada = erroresDeComprobante(cab(), [r('6.1.02.01.001', 'debe', 10), r('2.1.01.01.001', 'haber', 10)], ctx).join(' ');
    expect(sinNada).toMatch(/6\.1\.02\.01\.001 exige centro de costo/);
    expect(sinNada).toMatch(/2\.1\.01\.01\.001 exige un auxiliar \(proveedor\)/);
    const malTipo = erroresDeComprobante(cab(), [
      r('6.1.02.01.001', 'debe', 10, { centro_costo_id: 'cc-CC-05' }),
      r('2.1.01.01.001', 'haber', 10, { auxiliar_id: 'aux-CLI-001' }),
    ], ctx).join(' ');
    expect(malTipo).toMatch(/CLI-001 no es del tipo proveedor/);
  });

  it('no admite fecha futura, un mes cerrado ni una fecha de referencia mal escrita', () => {
    const asiento = [r('6.2.01.01.001', 'debe', 25), r('1.1.01.01.002', 'haber', 25)];
    expect(erroresDeComprobante(cab({ fecha: '2026-11-02' }), asiento, ctx)).toContain('La fecha no puede ser futura.');
    const cerrados = ctx.periodos.map((p) => (p.codigo === '202609' ? { ...p, estado: 'cerrado' as const } : p));
    expect(erroresDeComprobante(cab({ fecha: '2026-09-10' }), asiento, { ...ctx, periodos: cerrados }))
      .toContain('El mes 09/2026 está cerrado: no se puede ingresar ni modificar.');
    expect(erroresDeComprobante(cab(), [r('6.2.01.01.001', 'debe', 25, { fecha_referencia: '01/10/2026' }), asiento[1]], ctx).join(' '))
      .toMatch(/fecha de referencia no es válida/);
  });
});

describe('numeración de Galac', () => {
  const per = (codigo: string) => e.cont_periodos.find((p) => p.codigo === codigo)!;
  const tipo = (codigo: string) => e.cont_tipos_comprobante.find((t) => t.codigo === codigo)!;
  const comp = (t: string, p: string, numero: number): ContComprobante => ({ ...e.cont_comprobantes[0], tipo_id: `tc-${t}`, periodo_id: `per-${p}`, numero });
  const lista = [comp('01', '202607', 1), comp('09', '202607', 2), comp('01', '202608', 1), comp('01', '202608', 2)];

  it('Mes-Consecutivo: correlativo por mes, sin importar el tipo · «07-000003»', () => {
    expect(siguienteNumero(lista, { tipo_id: 'tc-01', periodo_id: 'per-202607' }, 'mes_consecutivo', e.cont_periodos)).toBe(3);
    expect(codigoComprobante('mes_consecutivo', tipo('01'), per('202607'), 3)).toBe('07-000003');
  });

  it('Consecutivo: un solo correlativo en el ejercicio · «000005»', () => {
    expect(siguienteNumero(lista, { tipo_id: 'tc-10', periodo_id: 'per-202610' }, 'consecutivo', e.cont_periodos)).toBe(3);
    expect(codigoComprobante('consecutivo', tipo('10'), per('202610'), 5)).toBe('000005');
  });

  it('Tipo-Mes-Número: correlativo por tipo y mes · «EG-08-000003»', () => {
    expect(siguienteNumero(lista, { tipo_id: 'tc-01', periodo_id: 'per-202608' }, 'tipo_mes_numero', e.cont_periodos)).toBe(3);
    expect(siguienteNumero(lista, { tipo_id: 'tc-09', periodo_id: 'per-202608' }, 'tipo_mes_numero', e.cont_periodos)).toBe(1);
    expect(codigoComprobante('tipo_mes_numero', tipo('01'), per('202608'), 3)).toBe('01-08-000003');
  });
});

describe('reverso', () => {
  it('cambia Debe por Haber en las dos monedas', () => {
    const lineas = e.cont_comprobante_lineas.filter((l) => l.comprobante_id === e.cont_comprobantes[1].id);
    const rev = renglonesDeReverso(lineas, 'x');
    rev.forEach((l, i) => {
      expect(l.debe_ves).toBe(lineas[i].haber_ves);
      expect(l.haber_usd).toBe(lineas[i].debe_usd);
      expect(ladoDe(l)).not.toBe(ladoDe(lineas[i]));
    });
  });

  it('la descripción lleva el número del original y el motivo', () => {
    expect(descripcionReverso('07-000001', ' cobro duplicado ')).toBe('REVERSO DE Nº 07-000001 · COBRO DUPLICADO');
  });
});

describe('datos de ejemplo', () => {
  it('el status de cada comprobante coincide con su cuadre', () => {
    for (const c of e.cont_comprobantes) {
      const cuadra = Math.abs(c.total_debe_ves - c.total_haber_ves) <= 0.01 && Math.abs(c.total_debe_usd - c.total_haber_usd) <= 0.01;
      expect(c.estado).toBe(cuadra ? 'contabilizado' : 'descuadrado');
    }
  });

  it('numeración Mes-Consecutivo, un reversado con su reverso y un descuadrado', () => {
    expect(e.cont_comprobantes[0].codigo).toBe('01-000001');
    const reverso = e.cont_comprobantes.find((c) => c.origen === 'reverso')!;
    expect(reverso.codigo).toBe('07-000002');
    expect(reverso.concepto).toBe('REVERSO DE Nº 07-000001 · SE REGISTRÓ DOS VECES: EL BANCO COBRÓ UNA SOLA COMISIÓN');
    expect(e.cont_comprobantes.filter((c) => c.estado === 'descuadrado').map((c) => c.codigo)).toEqual(['10-000001']);
  });
});
