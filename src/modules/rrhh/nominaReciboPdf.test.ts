import { describe, it, expect } from 'vitest';
import { calcularRecibo } from './sueldoQuincena';
import { bonoEnReal, correlativoBono, fechaDocumento, pagoQuincenalBs, reales, tasaRealTexto, textoConformidad, textoPeriodo, tituloRecibo } from './nominaReciboPdf';

/* Dos recibos por persona (09-10-2026).
   1/2 · RECIBO DE PAGO DE NOMINA (en Bs)
   2/2 · RECIBO DE PAGO BENEFICIO SOCIAL DE CARACTER NO REMUNERATIVO (en divisas) */
describe('recibos de nómina · dos por persona', () => {
  const c = calcularRecibo({
    brutoQuincena: 250, diasTrabajados: 11, diasDescanso: 4, bonosExtra: 20, viaticos: 15,
    deducciones: { ivss: 2.5, prestamos: 30, anticipos: 10 }, tasa: 189.55,
  });

  it('los títulos corresponden a nómina y a beneficio social no remunerativo', () => {
    expect(tituloRecibo('sueldo')).toBe('RECIBO DE PAGO DE NOMINA');
    expect(tituloRecibo('bono')).toBe('RECIBO DE PAGO BENEFICIO SOCIAL DE CARACTER NO REMUNERATIVO');
  });

  it('el correlativo del bono inicia en BNS-YYYY-001', () => {
    const meta = { periodo: { codigo: 'NOM-2026-015', tipo: 'quincena' as const, periodo_desde: '2026-11-01', periodo_hasta: '2026-11-15', tasa_bcv: 189.55 } };
    expect(correlativoBono(0, meta)).toBe('BNS-2026-001');
    expect(correlativoBono(1, meta)).toBe('BNS-2026-002');
  });

  it('el de bolívares certifica el neto en Bs y el período con el texto de la administradora, sin dólares ni bonificación', () => {
    const t = textoConformidad('sueldo', c, '01/10/2026 al 15/10/2026');
    expect(t).toBe('Certifico haber recibido la cantidad de Bs 15.637,88, conforme a la totalidad de mi salario al período del 01/10/2026 al 15/10/2026. Y firmo en señal de conformidad.'); // 82,50 $ x 189,55 = 15.637,875
    expect(textoConformidad('sueldo', c, '—')).not.toContain('período'); // sin período no inventa
    expect(t).not.toContain('$');
    expect(t).not.toContain('tasa');
    expect(t.toLowerCase()).not.toContain('bonificaci');
    expect(t).toContain('conformidad');
  });

  it('el pago quincenal en Bs son los días (trabajados + descanso) y el diario es ÷ 15', () => {
    // La parte en Bs de 250 $ brutos es 50 $ (20 %): 11 + 4 días → 50 $ x 189,55 = 9.477,50 Bs.
    const q = pagoQuincenalBs(c);
    expect(q.quincenal).toBe(9477.5);
    expect(q.diario).toBe(631.83);
  });

  it('el de beneficio social certifica la asignación no remunerativa conforme al art 105 LOTTT', () => {
    const t = textoConformidad('bono', c);
    expect(t).toContain('BENEFICIO SOCIAL DE CARACTER NO REMUNERATIVO');
    expect(t).toContain('artículo 105 de la LOTTT');
    expect(t).toContain('NO REVISTE CARACTER SALARIAL');
    expect(t).toContain('El beneficiario arriba identificado declara haber recibido');
    expect(t).not.toContain('Certifico haber recibido');
    expect(t).not.toContain('Bs');
  });

  it('sin préstamos ni anticipos el de beneficio social mantiene su texto legal LOTTT', () => {
    const sin = calcularRecibo({ brutoQuincena: 250, diasTrabajados: 15, diasDescanso: 0, tasa: 100 });
    expect(textoConformidad('bono', sin)).toContain('artículo 105 de la LOTTT');
    expect(textoConformidad('bono', sin)).not.toContain('menos');
  });

  it('el período sale de la nómina, o del renglón si la nómina no lo trae', () => {
    expect(textoPeriodo({ periodo: { periodo_desde: '2026-10-01', periodo_hasta: '2026-10-15' } })).toBe('01/10/2026 al 15/10/2026');
    expect(textoPeriodo({ periodo: { periodo_desde: '2026-10-15', periodo_hasta: '2026-10-15' } })).toBe('15/10/2026');
    expect(textoPeriodo({ periodo: { periodo_desde: null, periodo_hasta: null } }, { periodo: { codigo: 'X', tipo: 'quincena', periodo_desde: '2026-10-16', periodo_hasta: '2026-10-31' } })).toBe('16/10/2026 al 31/10/2026');
    expect(textoPeriodo({ periodo: { periodo_desde: null, periodo_hasta: null } }, null)).toBe('—');
  });

  it('la fecha del documento es la del pago si ya se pagó, o la de emisión si no', () => {
    expect(fechaDocumento({ estado: 'pagada', pagada_en: '2026-10-16' }, '2026-10-20')).toBe('Pagado el 16 oct. 2026');
    expect(fechaDocumento({ estado: 'por_pagar', pagada_en: null }, '2026-10-15')).toBe('Emitido el 15 oct. 2026');
    // Pagada sin fecha de pago (dato viejo): no inventa; usa la emisión.
    expect(fechaDocumento({ estado: 'pagada', pagada_en: null }, '2026-10-15')).toBe('Emitido el 15 oct. 2026');
  });
});

/* Empresas que pagan en Real brasileño (23-10-2026, traído de Golden Touch). */
describe('recibo de la bonificación en Real brasileño', () => {
  const c = calcularRecibo({
    brutoQuincena: 250, diasTrabajados: 11, diasDescanso: 4, bonosExtra: 20, viaticos: 15,
    deducciones: { ivss: 2.5, prestamos: 30, anticipos: 10 }, tasa: 189.55,
  });
  // bono 200 $, préstamo 30, anticipo 10 → neto 160 $.

  it('sin tasa del Real (empresa en dólares) no hay conversión y el recibo sale como siempre', () => {
    expect(bonoEnReal(c, null)).toBeNull();
    expect(bonoEnReal(c, undefined)).toBeNull();
    expect(bonoEnReal(c, 0)).toBeNull();
    expect(bonoEnReal(c, -5)).toBeNull();
    expect(textoConformidad('bono', c)).not.toContain('R$');
  });

  it('pasa el bono y cada descuento a R$ con la tasa y el neto sale de esos importes', () => {
    const r = bonoEnReal(c, 5.0428)!;
    expect(r.tasa).toBe(5.0428);
    expect(r.bono).toBe(1008.56); // 200 x 5,0428
    expect(r.lineas).toEqual([151.28, 50.43]); // 30 y 10 x 5,0428, redondeados uno a uno
    expect(r.deduccion).toBe(201.71);
    expect(r.neto).toBe(806.85);
    expect(r.bono - r.deduccion).toBeCloseTo(r.neto, 2); // la tabla cuadra
  });

  it('un descuento mayor que el bono deja el neto en cero, nunca negativo', () => {
    const justo = calcularRecibo({ brutoQuincena: 100, diasTrabajados: 15, diasDescanso: 0, bonosExtra: 0, viaticos: 0, deducciones: { prestamos: 500 }, tasa: 189.55 });
    const r = bonoEnReal(justo, 5)!;
    expect(r.neto).toBeGreaterThanOrEqual(0);
  });

  it('la conformidad certifica el beneficio social y su equivalente en R$ con la tasa de cambio', () => {
    const t = textoConformidad('bono', c, '', bonoEnReal(c, 5.0428));
    expect(t).toContain('BENEFICIO SOCIAL DE CARACTER NO REMUNERATIVO');
    expect(t).toContain('equivalente a R$ 1.008,56 en Real brasileño');
    expect(t).toContain('1 $ = R$ 5,0428');
  });

  it('el recibo en bolívares no cambia aunque la empresa pague en Real', () => {
    expect(textoConformidad('sueldo', c, '01/10/2026 al 15/10/2026', bonoEnReal(c, 5.0428)))
      .toBe(textoConformidad('sueldo', c, '01/10/2026 al 15/10/2026'));
  });

  it('los formatos: R$ con coma decimal y la tasa con hasta 4 decimales', () => {
    expect(reales(806.85)).toBe('R$ 806,85');
    expect(tasaRealTexto(5.0428)).toBe('5,0428');
  });
});
