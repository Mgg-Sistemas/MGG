import { describe, it, expect } from 'vitest';
import { calcularRecibo } from './sueldoQuincena';
import { textoConformidad, tituloRecibo } from './nominaReciboPdf';

/* Dos recibos por persona (09-10-2026): cada conformidad certifica SOLO lo
   que se entrega con ese recibo, nombra al otro, y el 2/2 cierra con el total. */
describe('recibos de nómina · dos por persona', () => {
  const c = calcularRecibo({
    brutoQuincena: 250, diasTrabajados: 11, diasDescanso: 4, bonosExtra: 20, viaticos: 15,
    deducciones: { ivss: 2.5, prestamos: 30, anticipos: 10 }, tasa: 189.55,
  });

  it('los títulos dicen cuál de los dos es y en qué moneda se paga', () => {
    expect(tituloRecibo('sueldo')).toBe('COMPROBANTE DE PAGO 1/2 · PAGO EN BOLÍVARES');
    expect(tituloRecibo('bono')).toBe('COMPROBANTE DE PAGO 2/2 · BONIFICACIÓN EN DIVISAS');
  });

  it('el 1/2 certifica el neto en Bs, sin la palabra sueldo, y remite el bono al 2/2', () => {
    const t = textoConformidad('sueldo', c);
    expect(t.toLowerCase()).not.toContain('sueldo');
    expect(tituloRecibo('sueldo').toLowerCase()).not.toContain('sueldo');
    expect(t).toContain('Bs 15.637,88'); // 82,50 $ x 189,55 = 15.637,875
    expect(t).toContain('$ 82,50');
    expect(t).toContain('recibo 1 de 2');
    expect(t).toContain('recibo 2 de 2');
    expect(t).not.toContain('totalidad');
  });

  it('el 2/2 certifica el bono neto, nombra el 1/2 y cierra con el total de los dos', () => {
    const t = textoConformidad('bono', c);
    expect(t).toContain('$ 160,00'); // bono 200 - 30 - 10
    expect(t).toContain('bono de $ 200,00 menos $ 40,00');
    expect(t).toContain('recibo 1 de 2 (Bs 15.637,88, $ 82,50)');
    expect(t).toContain('totalidad de mi remuneración del período, $ 242,50');
  });

  it('sin préstamos ni anticipos el 2/2 no menciona descuentos', () => {
    const sin = calcularRecibo({ brutoQuincena: 250, diasTrabajados: 15, diasDescanso: 0, tasa: 100 });
    expect(textoConformidad('bono', sin)).not.toContain('menos');
  });
});
