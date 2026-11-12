import { describe, expect, it } from 'vitest';
import type { Venta, VentaRenglon } from './ventas.repository';
import {
  armarTarjeta, chipsDe, coincide, columnasConFoco, etapaDe, indicadores, montoDe, pasaFoco,
  validaHasta, visibleEnTablero,
} from './ventasTablero';
import {
  textoCobro, textoDespachoAprobado, textoDespachoNoAprobado, textoDespachoPorAprobar, textoFactura,
  textoRecordatorio, whatsappDe,
} from './ventasWhatsapp';

const base: Venta = {
  id: 'v1', codigo: 'VT-2026-0001', tipo: 'venta', estado: 'borrador',
  cliente_id: null, cliente_nombre: 'INVERSIONES PÉREZ', cliente_rif: 'J-12345678-9',
  condicion: 'contado', moneda: 'USD', tasa_bs: null,
  subtotal: 100, descuento: 0, iva_pct: 0, iva_monto: 0, igtf_pct: 0, igtf_monto: 0,
  total: 100, costo_total: 40, ganancia_total: 60, valor_recibido: 0, diferencia: 100,
  pago_legs: [], cxc_id: null, nota: null, actor: 'a@x.com', actor_name: 'ANA',
  confirmada_at: null, confirmada_por: null, entregada_at: null, entregada_por: null,
  anulada_at: null, anulada_por: null, motivo_anulacion: null,
  documento: 'nota_entrega', numero_factura: null, numero_control: null,
  enviada_at: null, enviada_por: null, autorizada_at: null, autorizada_por: null,
  rechazada_at: null, rechazada_por: null, rechazo_motivo: null,
  no_despacho_motivo: null, no_despacho_detalle: null, no_despacho_por: null, no_despacho_en: null,
  cobrar_el: null, facturada_at: null, facturada_por: null,
  historial: [], created_at: '2026-11-10T12:00:00Z', updated_at: null,
};
const rs = [
  { producto_nombre: 'Cemento gris', producto_sku: 'CEM', cantidad: 2, unidad: 'SACO' },
] as VentaRenglon[];
const HOY = '2026-11-10';
const t = (v: Partial<Venta>, abonos = 0) => armarTarjeta({ ...base, ...v }, rs, abonos, HOY);

describe('etapaDe', () => {
  it('mapea los estados a las columnas del tablero', () => {
    expect(etapaDe(base, 0)).toBe('cot');
    expect(etapaDe({ ...base, estado: 'por_autorizar' }, 0)).toBe('aprobar');
    expect(etapaDe({ ...base, estado: 'autorizada' }, 0)).toBe('aprobar');
    expect(etapaDe({ ...base, estado: 'entregada' }, 0)).toBe('despachada');
    expect(etapaDe({ ...base, estado: 'entregada', facturada_at: '2026-11-10', documento: 'factura', numero_control: '00-1' }, 0)).toBe('facturada');
    expect(etapaDe({ ...base, estado: 'entregada' }, 100)).toBe('cobrada');
    expect(etapaDe({ ...base, estado: 'anulada' }, 0)).toBe('anulada');
  });
  it('lo cobrado en caja al despachar (patas) cuenta como cobrado', () => {
    const tj = t({ estado: 'entregada', pago_legs: [{ cuenta: 'general', moneda: 'USD', monto: 100, cajaId: 'c1' }] });
    expect(tj.etapa).toBe('cobrada');
    expect(tj.saldo).toBe(0);
  });
});

describe('tarjeta, chips y monto', () => {
  it('abono parcial: saldo y chip «Abonado»', () => {
    const tj = t({ estado: 'entregada' }, 30);
    expect(tj.saldo).toBe(70);
    expect(montoDe(tj)).toEqual({ texto: '$ 70,00', etiqueta: 'saldo' });
    expect(chipsDe(tj, HOY).map((c) => c.texto)).toContain('Abonado $ 30,00');
  });
  it('vencida: saldo y fecha de pago pasada', () => {
    const tj = t({ estado: 'entregada', cobrar_el: '2026-11-01' });
    expect(tj.vencida).toBe(true);
    expect(chipsDe(tj, HOY)).toContainEqual({ texto: 'Venció el 01/11', tono: 'danger' });
  });
  it('cotización: vale 15 días', () => {
    expect(validaHasta(base)).toBe('2026-11-25');
    expect(chipsDe(t({}), HOY)[0].texto).toBe('Válida hasta 25/11');
    expect(chipsDe(t({ created_at: '2026-10-01T00:00:00Z' }), HOY)[0]).toEqual({ texto: 'Cotización vencida', tono: 'danger' });
  });
  it('no por ahora: chip con el motivo', () => {
    const chips = chipsDe(t({ estado: 'por_autorizar', no_despacho_motivo: 'deuda_vencida', no_despacho_detalle: 'VT-0001 SIN COBRAR' }), HOY);
    expect(chips).toContainEqual({ texto: '⏳ Deuda vencida', tono: 'warning', titulo: 'Cliente con deuda vencida: VT-0001 SIN COBRAR' });
  });
  it('no procede: «No aprobada» en anuladas', () => {
    const chips = chipsDe(t({ estado: 'anulada', motivo_anulacion: 'NO PROCEDE: CLIENTE MOROSO' }), HOY);
    expect(chips[0].texto).toBe('No aprobada');
  });
});

describe('búsqueda, indicadores y foco', () => {
  it('cada palabra tiene que aparecer (sin acentos)', () => {
    expect(coincide(t({}), 'perez cemento')).toBe(true);
    expect(coincide(t({}), 'perez arena')).toBe(false);
  });
  it('indicadores: conteos y por cobrar por moneda', () => {
    const ts = [
      t({}), t({ estado: 'por_autorizar' }),
      t({ estado: 'entregada', cobrar_el: '2026-11-01' }, 20),
      t({ estado: 'entregada', moneda: 'Bs', diferencia: 500, total: 500 }),
      t({ estado: 'entregada' }, 100),
    ];
    expect(indicadores(ts)).toEqual({
      cot: 1, aprobar: 1, despachada: 2, vencidas: 1,
      porCobrar: [{ moneda: 'USD', monto: 80 }, { moneda: 'Bs', monto: 500 }],
    });
  });
  it('foco: por cobrar = despachada + facturada; vencidas filtra tarjetas', () => {
    expect(columnasConFoco('porcobrar')).toEqual(['despachada', 'facturada']);
    expect(columnasConFoco(null)).toHaveLength(6);
    expect(pasaFoco(t({ estado: 'entregada' }), 'vencidas')).toBe(false);
  });
  it('cobradas y anuladas viejas no se ven; lo abierto sí', () => {
    expect(visibleEnTablero(t({ estado: 'anulada', anulada_at: '2026-08-01' }), 30, HOY)).toBe(false);
    expect(visibleEnTablero(t({ estado: 'anulada', anulada_at: '2026-11-05' }), 30, HOY)).toBe(true);
    expect(visibleEnTablero(t({ created_at: '2026-01-01' }), 7, HOY)).toBe(true);
  });
});

describe('WhatsApp por etapa', () => {
  it('despacho por aprobar', () => {
    const txt = textoDespachoPorAprobar({ ...base, estado: 'por_autorizar', enviada_por: 'ANA', cobrar_el: '2026-11-20' }, rs);
    expect(txt).toBe([
      '🚚 *DESPACHO POR APROBAR · VT-2026-0001*',
      '👤 *Cliente:* INVERSIONES PÉREZ · J-12345678-9',
      '📄 *Documento:* Nota de entrega · Contado',
      '📦 *Productos (1):*',
      '• Cemento gris — 2 SACO',
      '📅 *Paga el:* 20/11/2026',
      '💵 *Total:* $ 100,00',
      '🙋 *Pide:* ANA',
      '➡ *Sigue:* aprobar el despacho',
      '🏢 *MINERAL GROUP GUAYANA C.A.*',
    ].join('\n'));
  });
  it('no lleva el selector invisible U+FE0F', () => {
    const todos = [
      textoDespachoPorAprobar(base, rs), textoDespachoAprobado(base, rs), textoDespachoNoAprobado(base, rs),
      textoFactura(base, rs), textoCobro(base, { monto: 10, saldo: 0 }),
      textoRecordatorio(t({ estado: 'entregada' }), HOY),
    ].join('\n');
    expect(todos).not.toContain('️');
  });
  it('no por ahora vs no procede', () => {
    expect(textoDespachoNoAprobado({ ...base, estado: 'por_autorizar', no_despacho_motivo: 'sin_existencia' }, rs))
      .toContain('📌 *Motivo:* No hay existencia en el inventario');
    const np = textoDespachoNoAprobado({ ...base, estado: 'anulada', motivo_anulacion: 'NO PROCEDE: CLIENTE MOROSO' }, rs);
    expect(np).toContain('🚫 *DESPACHO NO APROBADO · VT-2026-0001*');
    expect(np).toContain('📌 *Motivo:* No procede: CLIENTE MOROSO');
  });
  it('factura con IVA y equivalencia en Bs', () => {
    const txt = textoFactura({ ...base, documento: 'factura', numero_factura: 'F-10', numero_control: '00-10', iva_pct: 16, iva_monto: 16, total: 116, tasa_bs: 40 }, rs);
    expect(txt).toContain('🧾 *FACTURA F-10 · Nº DE CONTROL 00-10*');
    expect(txt).toContain('🧮 *IVA (16,00 %):* $ 16,00');
    expect(txt).toContain('💵 *Total:* $ 116,00 · Bs 4.640,00');
  });
  it('cobro: abono o cobrada', () => {
    expect(textoCobro(base, { monto: 30, saldo: 70 })).toContain('💵 *ABONO REGISTRADO · VT-2026-0001*');
    expect(textoCobro(base, { monto: 100, saldo: 0 })).toContain('✅ *VENTA COBRADA · VT-2026-0001*');
  });
  it('whatsappDe elige el mensaje de la etapa', () => {
    expect(whatsappDe(t({ estado: 'entregada' }), rs).titulo).toBe('Despacho aprobado · VT-2026-0001');
    expect(whatsappDe(t({ estado: 'por_autorizar', no_despacho_motivo: 'sin_cupo' }), rs).titulo).toContain('no aprobado por ahora');
  });
});
