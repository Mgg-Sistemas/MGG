import { describe, expect, it } from 'vitest';
import { comprobanteDeEjemplo, relacionDeEjemplo } from './ejemplos';

describe('los datos inventados del «🖨 Ejemplo de impresión» (solo en local)', () => {
  it('un comprobante de cada impuesto, con datos de ejemplo de la maqueta', () => {
    for (const imp of ['iva', 'islr', 'isae'] as const) {
      const d = comprobanteDeEjemplo(imp);
      expect(d.impuesto).toBe(imp);
      expect(d.sujeto.nombre).toBe('Proveedor Alfa C.A.');
      expect(d.agente.razon).toBe('Empresa de Ejemplo C.A.');
      expect(d.filas.length).toBeGreaterThan(0);
    }
    expect(comprobanteDeEjemplo('islr').filas).toHaveLength(2); // dos líneas de concepto
  });

  it('una relación de IVA de un mes con 30 líneas, para que pagine', () => {
    const r = relacionDeEjemplo();
    expect(r.impuesto).toBe('iva');
    expect(r.filas).toHaveLength(30);
    expect(r.desde).toBe('2026-09-01');
    expect(r.hasta).toBe('2026-09-30');
  });

  it('ningún RIF de ejemplo es de verdad: todos con ceros', () => {
    const rifs = [comprobanteDeEjemplo('iva').sujeto.rif, comprobanteDeEjemplo('iva').agente.rif, ...relacionDeEjemplo().filas.map((f) => f.rif)];
    for (const rif of rifs) expect(rif).toMatch(/^J-0000000\d-0$/);
  });
});
