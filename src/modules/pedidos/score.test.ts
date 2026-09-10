import { describe, it, expect } from 'vitest';
import { montoFinalOferta, costoEfectivo, scoreOfertas } from './score';
import type { OfertaProveedor } from '@/shared/lib/types';
import type { ProveedorStats } from './evaluaciones.repository';

/** Oferta mínima para el cálculo del monto. */
const of = (p: Partial<OfertaProveedor>) => ({
  precio_total: 0, precio_efectivo: null, iva: null, igtf: null, descuento: null, ...p,
}) as OfertaProveedor;

describe('montoFinalOferta', () => {
  it('sin nada, el monto final es la base a BCV', () => {
    expect(montoFinalOferta(of({ precio_total: 100 })).final).toBe(100);
  });

  it('resta el descuento negociado', () => {
    const m = montoFinalOferta(of({ precio_total: 63, descuento: 5 }));
    expect(m.base).toBe(63);
    expect(m.descuento).toBe(5);
    expect(m.final).toBe(58);
  });

  it('suma IVA e IGTF', () => {
    expect(montoFinalOferta(of({ precio_total: 92.4, iva: 14.78 })).final).toBe(107.18);
  });

  it('el orden importa: descuento sobre la base, impuestos después', () => {
    // 100 − 10 = 90, + 16 de IVA = 106. No (100 + 16) − 10 = 106 por casualidad:
    // acá el IVA es un monto fijo cargado en la oferta, no un porcentaje.
    const m = montoFinalOferta(of({ precio_total: 100, descuento: 10, iva: 16 }));
    expect(m.final).toBe(106);
  });

  it('con precio en efectivo menor al BCV, manda el efectivo', () => {
    expect(montoFinalOferta(of({ precio_total: 160, precio_efectivo: 140 })).base).toBe(140);
  });

  it('una oferta solo en USD efectivo usa ese precio como base', () => {
    expect(montoFinalOferta(of({ precio_total: 0, precio_efectivo: 75 })).base).toBe(75);
  });

  it('descuento y efectivo se combinan: primero el efectivo, después el descuento', () => {
    const m = montoFinalOferta(of({ precio_total: 200, precio_efectivo: 150, descuento: 20 }));
    expect(m.base).toBe(150);
    expect(m.final).toBe(130);
  });

  it('el descuento nunca deja la factura en negativo', () => {
    expect(montoFinalOferta(of({ precio_total: 50, descuento: 80 })).final).toBe(0);
  });

  it('ignora un descuento negativo cargado por error', () => {
    expect(montoFinalOferta(of({ precio_total: 50, descuento: -10 })).final).toBe(50);
  });

  it('redondea a 2 decimales, sin colas largas', () => {
    expect(montoFinalOferta(of({ precio_total: 60.07, iva: 0.001 })).final).toBe(60.07);
  });
});

describe('costoEfectivo · el número por el que se ordenan las ofertas', () => {
  it('es el monto final, descuento incluido', () => {
    expect(costoEfectivo(of({ precio_total: 63, descuento: 5 }))).toBe(58);
  });

  it('el caso SP-2026-0138: la oferta con descuento resulta la más barata', () => {
    const ferreteria = of({ precio_total: 60.07 });
    const multiferre = of({ precio_total: 63, descuento: 5 });
    expect(costoEfectivo(multiferre)).toBeLessThan(costoEfectivo(ferreteria));
  });
});

describe('scoreOfertas · a quién recomienda', () => {
  const stats = new Map<string, ProveedorStats>();
  // Sin historial las tres reciben los mismos valores neutros, así que decide el precio.
  const ofertas = [
    of({ id: 'ferreteria', proveedor_id: 'p1', precio_total: 60.07 }),
    of({ id: 'multiferre', proveedor_id: 'p2', precio_total: 63, descuento: 5 }),
    of({ id: 'tercera', proveedor_id: 'p3', precio_total: 92.4, iva: 14.78 }),
  ];

  it('marca «Mejor precio» a la que menos cuesta de verdad', () => {
    const out = scoreOfertas(ofertas, stats);
    expect(out.find((s) => s.mejorPrecio)?.oferta.id).toBe('multiferre');
  });

  it('recomienda la de 58,00 y no la de 60,07', () => {
    const out = scoreOfertas(ofertas, stats);
    expect(out.find((s) => s.recomendada)?.oferta.id).toBe('multiferre');
  });

  it('la más cara con impuestos queda última en el factor precio', () => {
    const out = scoreOfertas(ofertas, stats);
    const tercera = out.find((s) => s.oferta.id === 'tercera');
    expect(tercera?.score.precio).toBe(0);
  });

  it('si todas cuestan lo mismo, ninguna gana por precio', () => {
    const iguales = [
      of({ id: 'a', proveedor_id: 'p1', precio_total: 100 }),
      of({ id: 'b', proveedor_id: 'p2', precio_total: 110, descuento: 10 }),
    ];
    const out = scoreOfertas(iguales, stats);
    expect(out.every((s) => s.score.precio === 1)).toBe(true);
    expect(out.every((s) => s.mejorPrecio)).toBe(true);
  });
});
