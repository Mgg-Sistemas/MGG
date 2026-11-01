import { describe, expect, it } from 'vitest';
import type { PedidoDelivery } from './delivery';
import type { FilaHistorialDelivery } from './deliveryPanel';
import {
  fichaComprobanteDelivery, filasListaDelivery, itemsComprobanteDelivery, mensajeHistorialDelivery, mensajeListaDelivery,
  mensajePorDelivery, mensajeReporteDelivery, pedidosDelFeed, rangoTxt, tiemposComprobanteDelivery, totalPorMoneda,
} from './deliveryReporte';

const AHORA = '2026-10-31T16:00:00Z';

const pedido = (x: Partial<PedidoDelivery> = {}): PedidoDelivery => ({
  orden_id: 'o1', oc_codigo: 'OC-2026-0219', codigo: 'SP-2026-0300', total: 120, moneda: 'USD', urgente: false,
  pagada_en: '2026-10-30T12:00:00Z',
  items: [{ nombre: 'RODAMIENTO 6205', cantidad: 4, unidad: 'und' }, { nombre: 'GUANTES', cantidad: 2, unidad: 'PAR', comprar: false }],
  notas: null, motivo: null, finalidad: null, almacen_destino: 'LOS PINOS',
  proveedor_id: 'p1', proveedor_nombre: 'FERRETERÍA CARONÍ', proveedor_telefono: '04148921102',
  proveedor_direccion: 'Av. Las Américas, Puerto Ordaz', proveedor_contacto: null,
  analista_email: 'analista1mgg@gmail.com', analista_nombre: 'JAVIER LEIVA', analista_telefono: null,
  pedido_id: 'd1', estado: 'entregado', repartidor_id: 'u1', repartidor_nombre: 'CARLOS MENDOZA',
  aceptado_en: '2026-10-30T13:00:00Z', en_ruta_en: '2026-10-30T13:20:00Z', entregado_en: '2026-10-30T14:05:00Z',
  cancelado_en: null, motivo_cancel: null, detalle_cancel: null, almacen_entrega: 'LOS PINOS', nota_entrega: 'Lo recibió Isner',
  fotos_recibo: [{ path: 'a', filename: 'a.jpg' }], fotos_entrega: [], historial: [], es_mio: false, ...x,
});

const sinFE0F = (s: string) => expect(s.includes(String.fromCharCode(0xfe0f))).toBe(false);

describe('mensajeReporteDelivery · WhatsApp de un pedido', () => {
  it('lleva OC, estado, proveedor, delivery, almacén, tiempos y un renglón por producto', () => {
    const t = mensajeReporteDelivery(pedido(), undefined, AHORA);
    const l = t.split('\n');
    expect(l[0]).toBe('📋 *REPORTE DE DELIVERY · OC-2026-0219*');
    expect(t).toContain('✅ *Estado:* Entregado en almacén');
    expect(t).toContain('🏭 *Proveedor:* FERRETERÍA CARONÍ');
    expect(t).toContain('👤 *Delivery:* CARLOS MENDOZA');
    expect(t).toContain('🏬 *Entregado en:* LOS PINOS');
    expect(t).toContain('💵 *Monto:* $120,00');
    expect(t).toContain('⏳ *Tiempo desde que lo tomó:* 1 h 05 min');
    expect(t).toContain('📦 *Productos (1):*');
    expect(l).toContain('• RODAMIENTO 6205 — 4 und');
    expect(t).not.toContain('GUANTES'); // no se compra
    expect(t).toContain('📝 *Nota de entrega:* Lo recibió Isner');
    expect(l.at(-1)).toBe('🏢 *MINERAL GROUP GUAYANA C.A.* · Delivery');
    sinFE0F(t);
  });

  it('un cancelado lleva el motivo y no el tiempo de entrega; el almacén pasa por `ver`', () => {
    const t = mensajeReporteDelivery(pedido({
      estado: 'cancelado', entregado_en: null, almacen_entrega: null, cancelado_en: '2026-10-30T13:30:00Z',
      motivo_cancel: 'Proveedor cerrado o no atiende', detalle_cancel: 'Abre mañana', nota_entrega: null,
    }), (a) => `Almacén ${a}`, AHORA);
    expect(t).toContain('⛔ *Estado:* Cancelado');
    expect(t).toContain('❌ *Motivo:* Proveedor cerrado o no atiende');
    expect(t).toContain('📝 *Detalle:* Abre mañana');
    expect(t).toContain('🏬 *Almacén destino:* Almacén LOS PINOS');
    expect(t).not.toContain('⏳');
  });

  it('por tomar, sin delivery todavía', () => {
    const t = mensajeReporteDelivery(pedido({
      estado: 'por_tomar', pagada_en: null, aceptado_en: null, en_ruta_en: null, entregado_en: null, repartidor_nombre: null, urgente: true,
    }), undefined, AHORA);
    expect(t).toContain('🚨 *Requerimiento:* URGENTE');
    expect(t).toContain('👤 *Delivery:* —');
    expect(t).toContain('• Sin movimientos todavía');
  });
});

describe('mensajeListaDelivery · WhatsApp de la lista', () => {
  it('cuenta por estado, suma por moneda y un renglón por pedido', () => {
    const t = mensajeListaDelivery({
      pedidos: [
        pedido(),
        pedido({ orden_id: 'o2', oc_codigo: 'OC-2026-0220', estado: 'por_tomar', repartidor_nombre: null, urgente: true, total: 3500, moneda: 'BS', almacen_entrega: null }),
      ],
      filtro: 'Por tomar y en curso',
      ahora: AHORA,
    });
    const l = t.split('\n');
    expect(l[0]).toBe('📋 *DELIVERY · PEDIDOS*');
    expect(t).toContain('🔎 *Vista:* Por tomar y en curso');
    expect(t).toContain('📦 *Pedidos:* 2');
    expect(t).toContain('💰 1 por tomar · ✅ 1 entregado(s)');
    expect(t).toContain('💵 *Monto:* $120,00 + Bs 3.500,00');
    expect(l).toContain('• *OC-2026-0219* · FERRETERÍA CARONÍ · ✅ Entregado en almacén · 🛵 CARLOS MENDOZA · 🏬 LOS PINOS · $120,00');
    expect(l).toContain('🚨 *OC-2026-0220* · FERRETERÍA CARONÍ · 💰 Por tomar · 🏬 LOS PINOS · Bs 3.500,00');
    sinFE0F(t);
  });
});

describe('Histórico y Por delivery por WhatsApp', () => {
  const fila: FilaHistorialDelivery = {
    id: 'd1', orden_id: 'o1', fecha: '2026-10-30T13:00:00Z', oc: 'OC-2026-0219', proveedor: 'FERRETERÍA CARONÍ',
    repartidor: 'CARLOS MENDOZA', estado: 'entregado', en_ruta_en: null, entregado_en: '2026-10-30T13:45:00Z', cancelado_en: null,
    motivo_cancel: null, almacen_entrega: 'LOS PINOS', total: 120, moneda: 'USD', minutos: 45,
  };
  it('histórico con rango y filtro de delivery', () => {
    const t = mensajeHistorialDelivery({ desde: '2026-10-26', hasta: '2026-10-30', repartidor: 'CARLOS MENDOZA', filas: [fila], ahora: AHORA });
    expect(t).toContain('📅 *Rango:* Del 26/10/2026 al 30/10/2026');
    expect(t).toContain('🛵 *Delivery:* CARLOS MENDOZA');
    expect(t).toContain('*OC-2026-0219* · FERRETERÍA CARONÍ · ✅ Entregado en almacén · ⏳ 45 min · $120,00');
    sinFE0F(t);
  });
  it('por delivery con totales', () => {
    const t = mensajePorDelivery({
      desde: '2026-10-30', hasta: '2026-10-30', ahora: AHORA,
      resumen: [{ repartidor: 'CARLOS MENDOZA', entregados: 2, cancelados: 1, enCurso: 0, minutosPromedio: 50 }],
    });
    expect(t).toContain('📅 *Rango:* Día 30/10/2026');
    expect(t).toContain('• *CARLOS MENDOZA* — ✅ 2 · ⛔ 1 · 🚚 0 en curso · ⏳ 50 min');
    expect(t).toContain('📊 *Total:* ✅ 2 entregados · ⛔ 1 cancelados · 🚚 0 en curso');
  });
});

describe('Filas del PDF', () => {
  it('ficha, tiempos y productos del comprobante', () => {
    const p = pedido();
    const ficha = Object.fromEntries(fichaComprobanteDelivery(p));
    expect(ficha['Orden de compra']).toBe('OC-2026-0219');
    expect(ficha['Solicitud']).toBe('SP-2026-0300');
    expect(ficha['Delivery (motorizado)']).toBe('CARLOS MENDOZA');
    expect(ficha['Analista de Compras']).toBe('JAVIER LEIVA');
    expect(ficha['Fotos']).toBe('1 al recibir · 0 de la entrega');
    expect(tiemposComprobanteDelivery(p).at(-1)).toEqual(['Tiempo (tomada → entregada)', '1 h 05 min']);
    expect(itemsComprobanteDelivery(p)).toEqual([['1', 'RODAMIENTO 6205', '4', 'und']]);
  });
  it('lista: una fila por pedido con 11 columnas', () => {
    const filas = filasListaDelivery([pedido(), pedido({ estado: 'cancelado', motivo_cancel: 'Avería del vehículo' })]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveLength(11);
    expect(filas[0][8]).toBe('1 h 05 min');
    expect(filas[1][9]).toBe('Avería del vehículo');
  });
  it('el teléfono muestra «Por tomar» lo cancelado que quedó libre', () => {
    const [x, y] = pedidosDelFeed([{ p: pedido({ estado: 'cancelado' }), disponible: true }, { p: pedido(), disponible: false }]);
    expect(x.estado).toBe('por_tomar');
    expect(y.estado).toBe('entregado');
  });
  it('rango y totales por moneda', () => {
    expect(rangoTxt('2026-10-30', '2026-10-30')).toBe('Día 30/10/2026');
    expect(totalPorMoneda([])).toBe('$0,00');
  });
});
