import { describe, it, expect } from 'vitest';
import { textoOrdenPago, montoTxt, bancoTxt, detalleTxt, saldoPendiente, esCuentaCredito, enlaceWhatsapp, textoOrdenAprobacion } from './ordenPagoTxt';
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
    expect(txt().split('\n')).toEqual([
      '🔹 *ORDEN:* OC-2026-0130',
      '🏭 *Proveedor:* MAXI SHOES',
      '📝 *Detalle:* Dotación de calzado para motorizado (delivery). Para: Héctor Alagal.',
      '💵 *Total:* $79,00',
      '💳 *Pago móvil:*',
      '* Banco: Banco de Venezuela (0102)',
      '* CI/RIF: P1131881',
      '* Tlf: 04249692172',
      '🏢 *MINERAL GROUP GUAYANA C.A.*',
    ]);
  });

  it('ya no lleva encabezado antiguo ni renglones de materiales, pero sí el pie de empresa al final', () => {
    const t = txt();
    expect(t.endsWith('🏢 *MINERAL GROUP GUAYANA C.A.*')).toBe(true);
    expect(t).not.toContain('BOTAS');       // el listado de materiales se fue
    expect(t).not.toContain('Generado');
    expect(t).not.toContain('----');
  });

  it('la nota va en su renglón, y en una sola línea', () => {
    const t = txt({ notas: 'Se paga\ncontra entrega' });
    expect(t).toContain('📌 *Nota:* Se paga contra entrega');
  });

  it('sin detalle ni nota no deja renglones huérfanos', () => {
    const t = txt({ motivo: null, finalidad: null, notas: null } as Partial<Orden>);
    expect(t).not.toContain('*Detalle:*');
    expect(t).not.toContain('*Nota:*');
    expect(t.split('\n')[0]).toBe('🔹 *ORDEN:* OC-2026-0130');
  });

  it('el monto de la pata no se repite si ya lo dijo el total', () => {
    expect(txt()).toContain('💳 *Pago móvil:*\n');
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
    expect(t).toContain('💳 *Pago móvil:*\n');
    expect(t).not.toContain('Bs 0,00');
    expect(t).not.toContain('$0,00');
  });

  it('sin método indicado lo dice, no deja el hueco en blanco', () => {
    expect(txt({ metodo_pago: [] } as Partial<Orden>)).toContain('💳 *Pago:* (todavía sin método de pago indicado)');
  });

  it('el efectivo no inventa datos de beneficiario', () => {
    const t = txt({ metodo_pago: [{ metodo: 'divisas_efectivo', moneda: '$', monto: 79, datos: {} }] } as Partial<Orden>);
    expect(t).toContain('💳 *Divisas en efectivo:*');
    expect(t.split('\n').filter((l) => l.startsWith('* '))).toEqual([]);
  });

  it('si no hay OC todavía, sale el código de la solicitud', () => {
    expect(txt({ oc_codigo: null } as Partial<Orden>)).toContain('🔹 *ORDEN:* SP-2026-0126');
  });

  it('usa saltos de línea simples: WhatsApp los respeta y no se cuela un retorno de carro', () => {
    expect(txt()).toContain('\n');
    expect(txt()).not.toContain('\r');
    expect(txt().split('\n').length).toBeGreaterThan(5);
  });
});

describe('WhatsApp: emojis y enlace', () => {
  // Una orden con TODO lo que puede llevar: detalle, nota, abonos y varios métodos.
  const completa = () => txt({
    notas: 'Se paga contra entrega', abonado_total: 20,
    metodo_pago: [
      { metodo: 'pago_movil', moneda: 'Bs', monto: 4500, datos: { banco: '0102', ci_rif: 'P1131881', telefono: '04249692172' } },
      { metodo: 'transferencia', moneda: '$', monto: 40, datos: { nombre: 'JUAN', ci: 'V-1', banco: '0134', cuenta: '01340123012301230123' } },
      { metodo: 'zelle', moneda: '$', monto: 10, datos: { nombre: 'ANA', email: 'ana@x.com' } },
    ],
  } as Partial<Orden>);

  it('ningún emoji lleva el selector U+FE0F ni unión invisible: si no, WhatsApp muestra un cuadrito', () => {
    expect(/️|‍/.test(completa())).toBe(false);
    expect(/️|‍/.test(txt())).toBe(false);
  });

  it('la nota usa 📌 (el 🗒️ viaja con selector y se rompe)', () => {
    expect(completa()).toContain('📌 *Nota:* Se paga contra entrega');
    expect(completa()).not.toContain('🗒');
  });

  it('el enlace va derecho a api.whatsapp.com (nunca wa.me) y el texto vuelve exacto', () => {
    const t = completa();
    const url = enlaceWhatsapp(t);
    expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    expect(url).not.toContain('wa.me');
    expect(decodeURIComponent(url.split('text=')[1])).toBe(t);
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
    condiciones_pago: 'credito', estado: 'cuenta_abierta',
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

  it('en cuentas a crédito NO muestra método de pago (ni vacío ni con patas)', () => {
    const t = textoOrdenPago(CREDITO, 'DISTRIBUIDORA EL TORETE J&M, C.A');
    expect(t).not.toContain('💳');
    expect(t).not.toContain('Pago');

    // Mismo caso del reporte del usuario: orden a crédito sin abonos aún (OC-2026-0188)
    const tSinAbonos = textoOrdenPago({
      codigo: 'SP-2026-0180', oc_codigo: 'OC-2026-0188', moneda: 'USD',
      condiciones_pago: 'credito', estado: 'cuenta_abierta', total: 1204.88,
      abonado_total: 0, metodo_pago: null,
    } as unknown as Orden, 'DISTRIBUIDORA EL TORETE J&M, C.A');
    expect(tSinAbonos).not.toContain('💳');
    expect(tSinAbonos).not.toContain('(todavía sin método de pago indicado)');

    // Orden con método_pago cargado previamente pero condición crédito: tampoco lo muestra
    const tConMetodo = textoOrdenPago({
      ...base,
      condiciones_pago: 'credito',
      estado: 'cuenta_abierta',
    } as unknown as Orden, 'MAXI SHOES');
    expect(tConMetodo).not.toContain('💳');
  });

  it('esCuentaCredito detecta créditos por condición, estado o abonos previos', () => {
    expect(esCuentaCredito({ condiciones_pago: 'credito' })).toBe(true);
    expect(esCuentaCredito({ estado: 'cuenta_abierta' })).toBe(true);
    expect(esCuentaCredito({ abonado_total: 100 })).toBe(true);
    expect(esCuentaCredito({ condiciones_pago: 'contado', estado: 'oc_aprobada', abonado_total: 0 })).toBe(false);
  });
});

describe('quién solicita, quién autorizó y el analista de compras', () => {
  const personas = { solicita: 'JAIME CAMPO', analista: 'NAZARET SALAZAR', autorizo: 'LEYDIS RENGEL' };

  it('el mensaje de pago los trae, entre la nota y el total', () => {
    const l = textoOrdenPago(base, 'MAXI SHOES', personas).split('\n');
    const i = l.indexOf('🙋 *Solicita:* JAIME CAMPO');
    expect(i).toBeGreaterThan(-1);
    expect(l[i + 1]).toBe('🛒 *Analista de compras:* NAZARET SALAZAR');
    expect(l[i + 2]).toBe('👔 *Autorizó:* LEYDIS RENGEL');
    expect(l[i + 3]).toBe('💵 *Total:* $79,00');
  });

  it('lo que falta no sale ni deja un guion', () => {
    const l = textoOrdenPago(base, 'MAXI SHOES', { solicita: 'JAIME CAMPO', analista: null, autorizo: '  ' });
    expect(l).toContain('🙋 *Solicita:* JAIME CAMPO');
    expect(l).not.toContain('Analista de compras');
    expect(l).not.toContain('Autorizó');
    expect(textoOrdenPago(base, 'MAXI SHOES')).not.toContain('🙋');
  });

  it('también en una cuenta a crédito', () => {
    const t = textoOrdenPago({ ...base, abonado_total: 20 } as Orden, 'MAXI SHOES', personas);
    expect(t).toContain('👔 *Autorizó:* LEYDIS RENGEL');
    expect(t).toContain('🔺 *Saldo pendiente:* $59,00');
  });

  it('sin selector U+FE0F ni unión invisible', () => {
    expect(/\uFE0F|\u200D/.test(textoOrdenPago(base, 'MAXI SHOES', personas))).toBe(false);
  });
});

describe('textoOrdenAprobacion · para pedirle la aprobación al Gerente', () => {
  const pend = { ...base, estado: 'oc_creada', metodo_pago: null, condiciones_pago: 'contado', urgente: false } as unknown as Orden;
  const personas = { solicita: 'JAIME CAMPO', analista: 'NAZARET SALAZAR', autorizo: 'NO DEBE SALIR' };

  it('lleva orden, estado, proveedor, detalle, personas, productos, condición y total', () => {
    const l = textoOrdenAprobacion(pend, 'MAXI SHOES', personas).split('\n');
    expect(l[0]).toBe('🔹 *ORDEN:* OC-2026-0130');
    expect(l[1]).toBe('⏳ *Pendiente por aprobación · Gerente General*');
    expect(l).toContain('🏭 *Proveedor:* MAXI SHOES');
    expect(l).toContain('🙋 *Solicita:* JAIME CAMPO');
    expect(l).toContain('🛒 *Analista de compras:* NAZARET SALAZAR');
    expect(l).toContain('📦 *Productos:* 1');
    expect(l).toContain('📋 *Condición:* Pago de Contado');
    expect(l).toContain('💵 *Total:* $79,00');
    expect(l[l.length - 1]).toBe('🏢 *MINERAL GROUP GUAYANA C.A.*');
  });

  it('todavía nadie autorizó ni hay método de pago: no los menciona', () => {
    const t = textoOrdenAprobacion(pend, 'MAXI SHOES', personas);
    expect(t).not.toContain('Autorizó');
    expect(t).not.toContain('NO DEBE SALIR');
    expect(t).not.toContain('Pago móvil');
    expect(t).not.toContain('método de pago');
  });

  it('una urgente lo dice', () => {
    expect(textoOrdenAprobacion({ ...pend, urgente: true } as Orden, 'X')).toContain('🚨 *URGENTE*');
    expect(textoOrdenAprobacion(pend, 'X')).not.toContain('URGENTE');
  });

  it('de los productos dice SOLO cuántos son: no los lista ni pone sus montos', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ sku: `S${i}`, nombre: `PROD ${i}`, cantidad: 3, precio: 1.5, unidad: 'KG' }));
    const t = textoOrdenAprobacion({ ...pend, items } as unknown as Orden, 'X');
    expect(t).toContain('📦 *Productos:* 6');
    expect(t).not.toContain('PROD 0');
    expect(t).not.toContain('1. ');
    expect(t).not.toContain('$4,50');
  });

  it('cuenta solo lo que se compra, y sin productos no pone el renglón', () => {
    const items = [
      { sku: 'A', nombre: 'UNO', cantidad: 1, precio: 1 },
      { sku: 'B', nombre: 'NO SE COMPRA', cantidad: 1, precio: 5, comprar: false },
    ];
    expect(textoOrdenAprobacion({ ...pend, items } as unknown as Orden, 'X')).toContain('📦 *Productos:* 1');
    expect(textoOrdenAprobacion({ ...pend, items: [] } as unknown as Orden, 'X')).not.toContain('Productos');
  });

  it('sin selector ni unión invisible: llega bien a WhatsApp', () => {
    expect(/\uFE0F|\u200D/.test(textoOrdenAprobacion({ ...pend, urgente: true, notas: 'x' } as Orden, 'X', personas))).toBe(false);
  });
});
