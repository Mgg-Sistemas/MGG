import { describe, it, expect } from 'vitest';
import { textoOrdenPago, montoTxt, bancoTxt, detalleTxt, saldoPendiente } from './ordenPagoTxt';
import type { Orden } from '@/shared/lib/types';

/** La orden del ejemplo que dio el usuario: calzado para el motorizado. */
const base = {
  id: 'o1', codigo: 'SP-2026-0126', oc_codigo: 'OC-2026-0130',
  solicitante_persona: 'ENDER MEJIAS', solicitante: 'FUNDICION',
  proveedor_id: 'p1', estado: 'oc_aprobada', total: 79, moneda: 'USD',
  motivo: 'Dotación de calzado para motorizado (delivery).',
  finalidad: 'Para: Héctor Alagal.',
  items: [{ sku: 'VIV-01', nombre: 'BOTAS', cantidad: 1, precio: 79, unidad: 'PAR' }],
  metodo_pago: [{
    metodo: 'pago_movil', moneda: '$', monto: 79,
    datos: { banco: '0102', ci_rif: 'P1131881', telefono: '04249692172' },
  }],
} as unknown as Orden;

const txt = (o: Partial<Orden> = {}) => textoOrdenPago({ ...base, ...o } as Orden, 'MAXI SHOES');

describe('textoOrdenPago · formato corto para WhatsApp', () => {
  it('sale exactamente con la forma pedida', () => {
    expect(txt().split('\r\n')).toEqual([
      '🔹 *ORDEN:* OC-2026-0130',
      '🏭 *Proveedor:* MAXI SHOES',
      '📝 *Detalle:* Dotación de calzado para motorizado (delivery). Para: Héctor Alagal.',
      '💵 *Total:* $79,00',
      '💳 *Pago móvil:*',
      '* Banco: Banco de Venezuela (0102)',
      '* CI/RIF: P1131881',
      '* Tlf: 04249692172',
    ]);
  });

  it('ya no lleva el encabezado, ni los renglones, ni el pie', () => {
    const t = txt();
    expect(t).not.toContain('MINERAL GROUP GUAYANA');
    expect(t).not.toContain('BOTAS');       // el listado de materiales se fue
    expect(t).not.toContain('Generado');
    expect(t).not.toContain('----');
  });

  it('la nota va en su renglón, y en una sola línea', () => {
    const t = txt({ notas: 'Se paga\ncontra entrega' });
    expect(t).toContain('🗒️ *Nota:* Se paga contra entrega');
  });

  it('sin detalle ni nota no deja renglones huérfanos', () => {
    const t = txt({ motivo: null, finalidad: null, notas: null } as Partial<Orden>);
    expect(t).not.toContain('*Detalle:*');
    expect(t).not.toContain('*Nota:*');
    expect(t.split('\r\n')[0]).toBe('🔹 *ORDEN:* OC-2026-0130');
  });

  it('el monto de la pata no se repite si ya lo dijo el total', () => {
    expect(txt()).toContain('💳 *Pago móvil:*\r\n');
  });

  it('pero sí se muestra cuando el pago va en otra moneda que el total', () => {
    const t = txt({ metodo_pago: [{ metodo: 'transferencia', moneda: 'Bs', monto: 4500,
      datos: { nombre: 'JUAN PEREZ', ci: 'V-12345678', banco: '0134', cuenta: '01340123012301230123' } }] } as Partial<Orden>);
    expect(t).toContain('💳 *Transferencia:* Bs 4.500,00');
    expect(t).toContain('* Titular: JUAN PEREZ');
    expect(t).toContain('* Cuenta: 01340123012301230123');
    expect(t).toContain('* Banco: Banesco (0134)');
  });

  it('multipago: cada pata con su método, su monto y sus datos', () => {
    const t = txt({ metodo_pago: [
      { metodo: 'zelle', moneda: '$', monto: 40, datos: { nombre: 'ANA', email: 'ana@x.com' } },
      { metodo: 'binance_usdt', moneda: '$', monto: 39, datos: { email_o_id: '12345678' } },
    ] } as Partial<Orden>);
    expect(t).toContain('💳 *Zelle:* $40,00');
    expect(t).toContain('* Correo: ana@x.com');
    expect(t).toContain('💳 *Binance / USDT:* $39,00');
    expect(t).toContain('* Correo/ID: 12345678');
  });

  it('un monto en cero no sale: Tesorería todavía no definió cuánto se paga', () => {
    // Caso real de OC-2026-0127: salía «💳 *Pago móvil:* Bs 0,00», que se lee
    // como si el pago fuera por nada.
    const t = txt({ metodo_pago: [{ metodo: 'pago_movil', moneda: 'Bs', monto: 0,
      datos: { banco: '0134', ci_rif: 'J-30646306-2', telefono: '04249692172' } }] } as Partial<Orden>);
    expect(t).toContain('💳 *Pago móvil:*\r\n');
    expect(t).not.toContain('Bs 0,00');
    expect(t).not.toContain('$0,00');
  });

  it('sin método indicado lo dice, no deja el hueco en blanco', () => {
    expect(txt({ metodo_pago: [] } as Partial<Orden>)).toContain('💳 *Pago:* (todavía sin método de pago indicado)');
  });

  it('el efectivo no inventa datos de beneficiario', () => {
    const t = txt({ metodo_pago: [{ metodo: 'divisas_efectivo', moneda: '$', monto: 79, datos: {} }] } as Partial<Orden>);
    expect(t).toContain('💳 *Divisas en efectivo:*');
    expect(t.split('\r\n').filter((l) => l.startsWith('* '))).toEqual([]);
  });

  it('si no hay OC todavía, sale el código de la solicitud', () => {
    expect(txt({ oc_codigo: null } as Partial<Orden>)).toContain('🔹 *ORDEN:* SP-2026-0126');
  });

  it('usa CRLF: se abre en el Bloc de notas sin quedar todo en una línea', () => {
    expect(txt()).toContain('\r\n');
    expect(txt().split('\r\n').length).toBeGreaterThan(5);
  });
});

describe('piezas sueltas', () => {
  it('montoTxt pega el símbolo del dólar y separa el Bs', () => {
    expect(montoTxt(79, '$')).toBe('$79,00');
    expect(montoTxt(4500, 'Bs')).toBe('Bs 4.500,00');
    expect(montoTxt(null, '$')).toBe('$0,00');
  });

  it('bancoTxt pone el nombre adelante, que es lo que se busca en la app del banco', () => {
    expect(bancoTxt('0102')).toBe('Banco de Venezuela (0102)');
    expect(bancoTxt('9999')).toBe('9999');   // un código que no conocemos se muestra igual
    expect(bancoTxt(null)).toBe('');
  });

  it('detalleTxt junta motivo y finalidad, y no los repite si dicen lo mismo', () => {
    expect(detalleTxt({ motivo: 'REPUESTO', finalidad: 'PARA LA PLANTA' })).toBe('REPUESTO PARA LA PLANTA');
    expect(detalleTxt({ motivo: 'REPUESTO', finalidad: 'REPUESTO' })).toBe('REPUESTO');
    expect(detalleTxt({ motivo: null, finalidad: null })).toBe('');
  });
});

describe('una orden a crédito manda el saldo, no el total', () => {
  const CREDITO = {
    codigo: 'SP-2026-0129', oc_codigo: 'OC-2026-0140', moneda: 'USD',
    total: 1391.25, abonado_total: 400, motivo: 'ALIMENTACION', finalidad: null,
    notas: null, metodo_pago: null,
  } as unknown as Orden;

  it('lo que resta = total − abonos', () => {
    expect(saldoPendiente(CREDITO)).toBe(991.25);
  });

  it('un abono de más no deja el saldo en negativo', () => {
    expect(saldoPendiente({ total: 100, abonado_total: 130 } as Orden)).toBe(0);
  });

  it('sin abonos, el saldo es el total', () => {
    expect(saldoPendiente({ total: 756.44, abonado_total: 0 } as Orden)).toBe(756.44);
  });

  it('el texto muestra abonado y saldo pendiente', () => {
    const t = textoOrdenPago(CREDITO, 'DISTRIBUIDORA EL TORETE J&M, C.A');
    expect(t).toContain('*Total:* $1.391,25');
    expect(t).toContain('*Abonado:* $400,00');
    expect(t).toContain('*Saldo pendiente:* $991,25');
  });

  it('una orden sin abonos no ensucia el papel con esas dos líneas', () => {
    const t = textoOrdenPago({ ...CREDITO, abonado_total: 0 } as Orden, 'AGROCHICKEN C.A');
    expect(t).not.toContain('Abonado');
    expect(t).not.toContain('Saldo pendiente');
  });
});
