import { describe, it, expect } from 'vitest';
import { calcularRecibo } from './sueldoQuincena';
import { fechaDocumento, pagoQuincenalBs, textoConformidad, textoPeriodo, tituloRecibo } from './nominaReciboPdf';

/* Dos recibos por persona (09-10-2026). Desde el 15-10-2026: el título es solo
   «COMPROBANTE DE PAGO», el de bolívares es SOLO en bolívares y no nombra la
   bonificación, el de la bonificación es SOLO en dólares, y firma solo el trabajador. */
describe('recibos de nómina · dos por persona', () => {
  const c = calcularRecibo({
    brutoQuincena: 250, diasTrabajados: 11, diasDescanso: 4, bonosExtra: 20, viaticos: 15,
    deducciones: { ivss: 2.5, prestamos: 30, anticipos: 10 }, tasa: 189.55,
  });

  it('el título es solo COMPROBANTE DE PAGO en los dos', () => {
    expect(tituloRecibo('sueldo')).toBe('COMPROBANTE DE PAGO');
    expect(tituloRecibo('bono')).toBe('COMPROBANTE DE PAGO');
  });

  it('el de bolívares certifica el neto en Bs y el período con el texto de la administradora, sin dólares ni bonificación', () => {
    const t = textoConformidad('sueldo', c, '01 oct. 2026 al 15 oct. 2026');
    expect(t).toBe('Certifico haber recibido la cantidad de Bs 15.637,88, que conforme a la totalidad de mi salario al período del 01 oct. 2026 al 15 oct. 2026. Y firmo en señal de conformidad.'); // 82,50 $ x 189,55 = 15.637,875
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

  it('el de la bonificación certifica el bono neto solo en dólares, sin bolívares ni el otro recibo', () => {
    const t = textoConformidad('bono', c);
    expect(t).toContain('$ 160,00'); // bono 200 - 30 - 10
    expect(t).toContain('bono de $ 200,00 menos $ 40,00');
    expect(t).not.toContain('Bs');
    expect(t).not.toContain('1 de 2');
    expect(t).not.toContain('totalidad');
  });

  it('sin préstamos ni anticipos el de la bonificación no menciona descuentos', () => {
    const sin = calcularRecibo({ brutoQuincena: 250, diasTrabajados: 15, diasDescanso: 0, tasa: 100 });
    expect(textoConformidad('bono', sin)).not.toContain('menos');
  });

  it('el período sale de la nómina, o del renglón si la nómina no lo trae', () => {
    expect(textoPeriodo({ periodo: { periodo_desde: '2026-10-01', periodo_hasta: '2026-10-15' } })).toBe('01 oct. 2026 al 15 oct. 2026');
    expect(textoPeriodo({ periodo: { periodo_desde: '2026-10-15', periodo_hasta: '2026-10-15' } })).not.toContain(' al ');
    expect(textoPeriodo({ periodo: { periodo_desde: null, periodo_hasta: null } }, { periodo: { codigo: 'X', tipo: 'quincena', periodo_desde: '2026-10-16', periodo_hasta: '2026-10-31' } })).toContain(' al ');
    expect(textoPeriodo({ periodo: { periodo_desde: null, periodo_hasta: null } }, null)).toBe('—');
  });

  it('la fecha del documento es la del pago si ya se pagó, o la de emisión si no', () => {
    expect(fechaDocumento({ estado: 'pagada', pagada_en: '2026-10-16' }, '2026-10-20')).toBe('Pagado el 16 oct. 2026');
    expect(fechaDocumento({ estado: 'por_pagar', pagada_en: null }, '2026-10-15')).toBe('Emitido el 15 oct. 2026');
    // Pagada sin fecha de pago (dato viejo): no inventa; usa la emisión.
    expect(fechaDocumento({ estado: 'pagada', pagada_en: null }, '2026-10-15')).toBe('Emitido el 15 oct. 2026');
  });
});
