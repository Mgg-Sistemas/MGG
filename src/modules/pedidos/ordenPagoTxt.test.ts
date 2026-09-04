import { describe, it, expect } from 'vitest';
import { textoOrdenPago } from './ordenPagoTxt';
import type { Orden } from '@/shared/lib/types';

const base = {
  id: 'o1', codigo: 'SP-2026-0126', oc_codigo: 'OC-2026-0088',
  solicitante_persona: 'ENDER MEJIAS', solicitante: 'FUNDICION',
  solicitante_email: 'ender@mgg.com', proveedor_id: 'p1', estado: 'oc_aprobada',
  total: 25.54, moneda: 'USD',
  items: [{ sku: 'REP-012', nombre: 'FILTRO DE ACEITE CL-01090', cantidad: 2, precio: 12.77, unidad: 'UNIDAD' }],
  metodo_pago: [{
    metodo: 'transferencia', moneda: 'Bs', monto: 4500,
    datos: { nombre: 'JUAN PEREZ', ci: 'V-12345678', banco: '0134', cuenta: '01340123012301230123' },
  }],
} as unknown as Orden;

const txt = (o: Partial<Orden> = {}) =>
  textoOrdenPago({ ...base, ...o } as Orden, 'MODELO PARTS', new Date('2026-09-04T14:00:00Z'));

describe('textoOrdenPago', () => {
  it('lleva las cinco cosas que se piden: quién, unidad, qué, proveedor y cómo se paga', () => {
    const t = txt();
    expect(t).toContain('ENDER MEJIAS');
    expect(t).toContain('FUNDICION');
    expect(t).toContain('FILTRO DE ACEITE CL-01090');
    expect(t).toContain('MODELO PARTS');
    expect(t).toContain('Transferencia');
  });

  it('los datos del beneficiario van uno por línea, para copiarlos sin equivocarse', () => {
    const t = txt();
    expect(t).toMatch(/Titular\s+: JUAN PEREZ/);
    expect(t).toMatch(/CI \/ RIF\s+: V-12345678/);
    expect(t).toMatch(/Cuenta\s+: 01340123012301230123/);
    // El código SUDEBAN se traduce a nombre: nadie transfiere a «0134».
    expect(t).not.toMatch(/Banco\s+: 0134$/m);
  });

  it('el monto va junto al método, en la moneda de esa pata', () => {
    expect(txt()).toContain('Bs 4.500,00');
  });

  it('multipago: lista todas las patas numeradas', () => {
    const t = txt({ metodo_pago: [
      { metodo: 'transferencia', moneda: 'Bs', monto: 3000, datos: { nombre: 'A', ci: 'V-1', banco: '0134', cuenta: '0'.repeat(20) } },
      { metodo: 'zelle', moneda: 'USD', monto: 20, datos: { nombre: 'B', email: 'b@c.com' } },
    ] } as Partial<Orden>);
    expect(t).toContain('[1/2]');
    expect(t).toContain('[2/2]');
    expect(t).toContain('b@c.com');
  });

  it('sin método indicado lo dice, no deja el hueco en blanco', () => {
    expect(txt({ metodo_pago: null })).toContain('todavía sin método de pago indicado');
  });

  it('un renglón no marcado para comprar no se factura', () => {
    const t = txt({ items: [
      { sku: 'A', nombre: 'SI VA', cantidad: 1, precio: 1, comprar: true },
      { sku: 'B', nombre: 'NO VA', cantidad: 1, precio: 1, comprar: false },
    ] } as Partial<Orden>);
    expect(t).toContain('SI VA');
    expect(t).not.toContain('NO VA');
  });

  it('sale el código de la OC y también el de la solicitud', () => {
    const t = txt();
    expect(t).toContain('OC-2026-0088');
    expect(t).toContain('SP-2026-0126');
  });

  it('sin persona cae al correo y sin unidad marca un guión', () => {
    const t = txt({ solicitante_persona: null, ci_solicitante: null, solicitante: null } as Partial<Orden>);
    expect(t).toContain('ender@mgg.com');
    expect(t).toMatch(/UNIDAD SOLICITANTE\s+: —/);
  });

  it('usa CRLF: se abre en el Bloc de notas sin quedar todo en una línea', () => {
    expect(txt()).toContain('\r\n');
  });
});
