import { describe, expect, it } from 'vitest';
import {
  claveDe, esRetiro, mensajeAceptado, mensajeNoDisponible, mensajeCancelado, mensajeEnRuta, mensajeEntregado, minutosEntre, ocDe, resumenPorDelivery, type PedidoDelivery,
} from './delivery';

const base: PedidoDelivery = {
  orden_id: 'o1', oc_codigo: 'OC-2026-0219', codigo: 'SP-2026-0300', total: 120, moneda: 'USD', urgente: true,
  pagada_en: '2026-10-29T20:43:00Z',
  items: [{ nombre: 'RODAMIENTO 6205', cantidad: 4, unidad: 'und' }, { nombre: 'GUANTES', cantidad: 2, unidad: 'PAR', comprar: false }],
  notas: null, motivo: null, finalidad: null, almacen_destino: 'Los Pinos',
  proveedor_id: 'p1', proveedor_nombre: 'FERRETERÍA CARONÍ', proveedor_telefono: '04148921102',
  proveedor_direccion: 'Av. Las Américas, Puerto Ordaz', proveedor_contacto: null,
  analista_email: 'analista1mgg@gmail.com', analista_nombre: 'JAVIER LEIVA', analista_telefono: '04120000000',
  pedido_id: 'd1', estado: 'aceptado', repartidor_id: 'u1', repartidor_nombre: 'CARLOS MENDOZA',
  aceptado_en: '2026-10-30T13:00:00Z', en_ruta_en: null, entregado_en: null, cancelado_en: null,
  motivo_cancel: null, detalle_cancel: null, almacen_entrega: null, nota_entrega: null,
  fotos_recibo: [{ path: 'a', filename: 'a.jpg' }], fotos_entrega: [], historial: [], es_mio: true,
};

const sinSelector = (t: string) => expect(t).not.toContain('️');

describe('Delivery · mensajes de WhatsApp', () => {
  it('aceptado: orden, urgencia, proveedor, destino y solo lo que se compra', () => {
    const t = mensajeAceptado(base, 'CARLOS MENDOZA');
    expect(t).toContain('🚚 *PEDIDO ACEPTADO · DELIVERY EN CAMINO*');
    expect(t).toContain('🔹 *Orden:* OC-2026-0219');
    expect(t).toContain('🚨 *Requerimiento:* URGENTE');
    expect(t).toContain('🏬 *Entregar en:* Los Pinos');
    expect(t).toContain('• RODAMIENTO 6205 — 4 und');
    expect(t).not.toContain('GUANTES');
    sinSelector(t);
  });

  it('cancelado: motivo, detalle y que la orden queda libre', () => {
    const t = mensajeCancelado(base, 'CARLOS MENDOZA', 'Proveedor cerrado o no atiende', 'Vuelvo mañana');
    expect(t).toContain('❌ *Motivo:* Proveedor cerrado o no atiende');
    expect(t).toContain('📝 *Detalle:* Vuelvo mañana');
    expect(t).toContain('queda disponible para otro delivery');
    sinSelector(t);
  });

  it('en ruta y entregado', () => {
    expect(mensajeEnRuta(base, 'CARLOS')).toContain('🧾 *Factura:* 1 foto(s)');
    const t = mensajeEntregado(base, 'CARLOS', 'Los Pinos', 'Completo', '2026-10-30T13:45:00Z');
    expect(t).toContain('✅ *PEDIDO ENTREGADO EN ALMACÉN*');
    expect(t).toContain('*Tiempo desde que lo tomó:* 45 min');
    sinSelector(t);
  });
});

describe('Delivery · resumen por delivery', () => {
  it('cuenta entregados, cancelados y en curso, con tiempo promedio', () => {
    const r = resumenPorDelivery([
      { ...base, estado: 'entregado', entregado_en: '2026-10-30T13:30:00Z' },
      { ...base, estado: 'entregado', entregado_en: '2026-10-30T14:30:00Z' },
      { ...base, estado: 'cancelado' },
      { ...base, estado: 'en_ruta', repartidor_nombre: 'ANA' },
      { ...base, estado: 'por_tomar', repartidor_nombre: null },
    ]);
    expect(r[0]).toEqual({ repartidor: 'CARLOS MENDOZA', entregados: 2, cancelados: 1, enCurso: 0, minutosPromedio: 60 });
    expect(r[1]).toMatchObject({ repartidor: 'ANA', enCurso: 1 });
    expect(minutosEntre(null, '2026-10-30T13:00:00Z')).toBeNull();
  });
});

describe('no disponible (02-11-2026)', () => {
  it('lleva el motivo y avisa que sigue libre', () => {
    const t = mensajeNoDisponible(base, 'CARLOS', 'Proveedor cerrado o no atiende', 'abre mañana');
    expect(t).toContain('⛔ *PEDIDO NO DISPONIBLE*');
    expect(t).toContain('❌ *Motivo:* Proveedor cerrado o no atiende');
    expect(t).toContain('📝 *Detalle:* abre mañana');
    expect(t).toContain('sigue disponible para otro delivery');
  });
});

describe('retiro en Los Pinos (02-11-2026)', () => {
  const retiro: PedidoDelivery = { ...base, tipo: 'retiro_almacen', oc_codigo: null, proveedor_nombre: 'ALMACÉN LOS PINOS' };
  it('la misma orden tiene su OC y su retiro por separado', () => {
    expect(claveDe(base)).toBe('oc:o1');
    expect(claveDe(retiro)).toBe('retiro_almacen:o1');
    expect(esRetiro(base)).toBe(false);
    expect(esRetiro(retiro)).toBe(true);
  });
  it('el retiro se nombra por la SP y dice dónde buscarlo', () => {
    expect(ocDe(retiro)).toBe('SP-2026-0300 · Retiro Los Pinos');
    const m = mensajeAceptado(retiro, 'CARLOS');
    expect(m).toContain('🏬 *Buscar en:* ALMACÉN LOS PINOS');
    expect(m).not.toContain('Proveedor');
    expect(mensajeAceptado(base, 'CARLOS')).toContain('🏭 *Proveedor:*');
  });
});

describe('motivo completo de la cancelación (12-11-2026)', () => {
  it('«Otro motivo» muestra lo que escribió el delivery; los demás, categoría · detalle', async () => {
    const { textoCancelacion } = await import('./delivery');
    expect(textoCancelacion({ motivo_cancel: 'Otro motivo', detalle_cancel: 'EL PROVEEDOR LO LLEVA' })).toBe('EL PROVEEDOR LO LLEVA');
    expect(textoCancelacion({ motivo_cancel: 'Proveedor cerrado', detalle_cancel: 'volver mañana' })).toBe('Proveedor cerrado · volver mañana');
    expect(textoCancelacion({ motivo_cancel: 'Proveedor cerrado', detalle_cancel: null })).toBe('Proveedor cerrado');
    expect(textoCancelacion({})).toBe('');
  });
});
