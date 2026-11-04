import { describe, expect, it } from 'vitest';
import { mensajeRecepcion, totalRecepcion } from './recepcionReporte';

describe('aviso de una recepción (04-11-2026)', () => {
  const d = {
    codigo: 'OC-2026-0238', documento: 'OC-2026-0238', proveedor: 'FERREINVICTA C.A.', almacen: 'Los Pinos', at: '2026-11-04T15:00:00Z',
    quien: 'ISNER ORENCE', delivery: 'HECTOR ALAGAL · entregó en LOS PINOS', fotos: 2,
    items: [
      { nombre: 'BREAKER 2X40', unidad: 'UND', cantidad: 1, pedido: 1, precio: 20 },
      { nombre: 'CABLE 10', unidad: 'M', cantidad: 8, pedido: 10, precio: 1.5 },
    ],
  };
  it('lista los materiales, lo que faltó, el delivery, el valor y quién recibió', () => {
    const t = mensajeRecepcion(d).split('\n');
    expect(t[0]).toBe('📥 *RECEPCIÓN EN ALMACÉN*');
    expect(t).toContain('🛵 *Delivery:* HECTOR ALAGAL · entregó en LOS PINOS');
    expect(t).toContain('• CABLE 10: 8 M (de 10)');
    expect(t).toContain('💵 *Valor recibido:* $32,00');
    expect(t).toContain('👷 *Recibido por:* ISNER ORENCE');
    expect(t).toContain('📷 *Fotos:* 2');
  });
  it('el valor solo cuenta lo que tiene precio', () => {
    expect(totalRecepcion([{ nombre: 'A', unidad: null, cantidad: 3, precio: null }, { nombre: 'B', unidad: null, cantidad: 2, precio: 5 }])).toBe(10);
  });
});
