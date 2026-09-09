import { describe, it, expect } from 'vitest';
import { legsDesdeMetodoPago, motivoNoCorregible } from './metodoPagoEdicion';
import type { Orden, PagoMetodo } from '@/shared/lib/types';

const moneda = (m: string) => (m === 'transferencia' || m === 'pago_movil' ? 'Bs' : 'USD');
const orden = (p: Partial<Orden>) => ({ estado: 'oc_aprobada', pagada_en: null, abonado_total: 0, ...p }) as Orden;

describe('legsDesdeMetodoPago', () => {
  it('devuelve el método, la moneda, el monto y los datos que se cargaron', () => {
    const guardado: PagoMetodo[] = [
      { metodo: 'pago_movil', moneda: 'Bs', monto: 120, datos: { banco: '0102', telefono: '04249692172', ci_rif: 'P1131881' } },
    ];
    expect(legsDesdeMetodoPago(guardado, moneda)).toEqual([
      { metodo: 'pago_movil', moneda: 'Bs', monto: 120, datos: { banco: '0102', telefono: '04249692172', ci_rif: 'P1131881' } },
    ]);
  });

  it('copia los datos: editar el formulario no pisa la OC guardada', () => {
    const guardado: PagoMetodo[] = [{ metodo: 'pago_movil', moneda: 'Bs', monto: 0, datos: { telefono: '04249692172' } }];
    const legs = legsDesdeMetodoPago(guardado, moneda);
    legs[0].datos!.telefono = '04141234567';
    expect(guardado[0].datos!.telefono).toBe('04249692172');
  });

  it('conserva las dos patas de un multipago', () => {
    const legs = legsDesdeMetodoPago(
      [{ metodo: 'divisas_efectivo', moneda: 'USD', monto: 50 }, { metodo: 'transferencia', moneda: 'Bs', monto: 4500 }],
      moneda,
    );
    expect(legs.map((l) => l.metodo)).toEqual(['divisas_efectivo', 'transferencia']);
    expect(legs.map((l) => l.monto)).toEqual([50, 4500]);
  });

  it('a una OC vieja sin moneda le rearma la moneda desde el método', () => {
    const legs = legsDesdeMetodoPago([{ metodo: 'transferencia', moneda: '', monto: 0 }], moneda);
    expect(legs[0].moneda).toBe('Bs');
  });

  it('sin método de pago no arma patas', () => {
    expect(legsDesdeMetodoPago(null, moneda)).toEqual([]);
    expect(legsDesdeMetodoPago([], moneda)).toEqual([]);
  });
});

describe('motivoNoCorregible', () => {
  it('deja corregir una OC en Confirmada pagar sin pagar', () => {
    expect(motivoNoCorregible(orden({}))).toBeNull();
  });

  it('no deja corregir una OC ya pagada', () => {
    expect(motivoNoCorregible(orden({ pagada_en: '2026-09-08T12:00:00Z' }))).toMatch(/ya se pagó/);
  });

  it('no deja corregir una OC con abonos', () => {
    expect(motivoNoCorregible(orden({ abonado_total: 30 }))).toMatch(/abonos/);
  });

  it('no deja corregir una OC que todavía no llegó a Confirmada pagar', () => {
    expect(motivoNoCorregible(orden({ estado: 'confirmada_metodo' }))).toMatch(/Confirmada pagar/);
  });
});
