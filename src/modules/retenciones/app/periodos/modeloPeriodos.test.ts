import { describe, expect, it } from 'vitest';
import type { PeriodoRetencion } from '../datos/periodos';
import { atencionDe, avisosPeriodos, corto, diasEntre, estadoFila, etiquetaPeriodo, nombrePeriodo, periodicidadDe, periodosPorAnio } from './modeloPeriodos';

const per = (x: Partial<PeriodoRetencion>): PeriodoRetencion => ({
  id: x.periodo ?? 'p', tipo: 'iva', periodo: '202610', tramo: 1, desde: '2026-10-01', hasta: '2026-10-15', vence: '2026-10-22',
  estado: 'abierto', diasParaVencer: null, declara: 'mgg', declaradoEn: null, declaradoPor: null, declaradoRegistradoEn: null,
  planilla: null, numeroDeclaracion: null, montoEnterado: null, observacion: null, reabiertoPor: null, reabiertoEn: null, reabiertoMotivo: null,
  retencionesVigentes: 0, retenidoBs: 0, retenidoUsd: 0, ...x,
});

describe('los períodos', () => {
  it('nombres y fechas como en la maqueta', () => {
    expect(etiquetaPeriodo(per({}))).toBe('Octubre 2026 · 1.ª quincena');
    expect(nombrePeriodo(per({ tramo: 0, tipo: 'islr' }))).toBe('Octubre de 2026');
    expect(nombrePeriodo(per({ tramo: 2 }))).toBe('2.ª quincena de octubre de 2026');
    expect(corto('2026-10-22')).toBe('22/10');
    expect(diasEntre('2026-10-20', '2026-10-22')).toBe(2);
  });

  it('lo anterior al paso inicial es «Otro sistema», salvo que esté declarado', () => {
    expect(estadoFila(per({ declara: 'otro_sistema', estado: 'vencido' }))).toBe('anterior');
    expect(estadoFila(per({ declara: 'otro_sistema', estado: 'declarado', declaradoEn: '2026-09-10' }))).toBe('declarado');
  });

  it('la atención de un impuesto y los avisos (vencidos y por vencer a 7 días)', () => {
    const ps = [
      per({ periodo: '202609', tramo: 1, desde: '2026-09-01', hasta: '2026-09-15', vence: '2026-09-22', estado: 'vencido' }),
      per({ periodo: '202609', tramo: 2, desde: '2026-09-16', hasta: '2026-09-30', vence: '2026-10-22', estado: 'por_declarar' }),
      per({ periodo: '202610', tramo: 2, desde: '2026-10-16', hasta: '2026-10-31', vence: '2026-11-07', estado: 'abierto' }),
    ];
    const a = atencionDe(ps, 'iva', '2026-10-20');
    expect(a.abierto?.tramo).toBe(2);
    expect(a.vencidos).toHaveLength(1);
    expect(a.porDeclarar).toHaveLength(1);
    expect(avisosPeriodos(ps, ['iva'], '2026-10-20')).toEqual({ vencidos: 1, pronto: 1 });
    expect(avisosPeriodos(ps, ['islr'], '2026-10-20')).toEqual({ vencidos: 0, pronto: 0 });
  });

  it('la tabla por año, con el filtro de estado y lo anterior aparte', () => {
    const ps = [
      per({ periodo: '202510', desde: '2025-10-01', hasta: '2025-10-15', declara: 'otro_sistema', estado: 'vencido' }),
      per({ periodo: '202609', desde: '2026-09-01', hasta: '2026-09-15', estado: 'declarado', declaradoEn: '2026-09-20' }),
      per({ periodo: '202610', desde: '2026-10-01', hasta: '2026-10-15', estado: 'por_declarar' }),
      per({ periodo: '202611', desde: '2026-11-01', hasta: '2026-11-15' }),
    ];
    const t = periodosPorAnio(ps, 'iva', '2026-10-20', '');
    expect(t.map((a) => a.anio)).toEqual([2026, 2025]);
    expect(t[0].filas.map((p) => p.periodo)).toEqual(['202610', '202609']);
    expect(t[1].anteriores).toHaveLength(1);
    expect(periodosPorAnio(ps, 'iva', '2026-10-20', 'declarado')[0].filas).toHaveLength(1);
    expect(periodicidadDe(ps, 'iva')).toBe('Por quincena');
  });
});
