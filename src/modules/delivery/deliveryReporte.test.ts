import { describe, expect, it } from 'vitest';
import type { FotoDelivery, PedidoDelivery } from './delivery';
import { armarFilasHistorial, filtrarPorOrigen } from './deliveryPanel';
import {
  ESTADOS_FILTRO, MAX_PEDIDOS_WHATSAPP, ORIGENES_FILTRO, detallePedido, filtrarHistorial, resumenReporte, textoFiltros,
  textoReporteGeneral, textoReportePedido,
} from './deliveryReporte';

const pedido = (x: Partial<PedidoDelivery> = {}): PedidoDelivery => ({
  orden_id: 'o1', oc_codigo: 'OC-2026-0181', codigo: 'SP-2026-0300', total: 120, moneda: 'USD', urgente: true,
  pagada_en: '2026-10-31T12:00:00Z',
  items: [{ nombre: 'RODAMIENTO 6205', cantidad: 4, unidad: 'und' }, { nombre: 'GUANTES', cantidad: 2, comprar: false }],
  notas: null, motivo: null, finalidad: null, almacen_destino: 'General',
  proveedor_id: 'p1', proveedor_nombre: 'FERRETERÍA CARONÍ', proveedor_telefono: '0414-892.11 02',
  proveedor_direccion: 'Av. Las Américas', proveedor_contacto: null,
  analista_email: 'analista@x.com', analista_nombre: 'Nazaret Salazar', analista_telefono: null,
  pedido_id: 'd1', estado: 'entregado', repartidor_id: 'u1', repartidor_nombre: 'carlos@x.com',
  aceptado_en: '2026-10-31T13:00:00Z', en_ruta_en: '2026-10-31T13:20:00Z', entregado_en: '2026-10-31T14:05:00Z',
  cancelado_en: null, motivo_cancel: null, detalle_cancel: null, almacen_entrega: 'General', nota_entrega: 'Completo',
  fotos_recibo: [{ path: 'd1/recibo-1', filename: 'a.jpg' }], fotos_entrega: [{ path: 'd1/entrega-1', filename: 'b.jpg' }, { path: 'd1/entrega-2', filename: 'c.jpg' }], fotos_factura: [],
  historial: [], es_mio: true, ...x,
});

const nombres = (g: string | null | undefined) => (g === 'carlos@x.com' ? 'Carlos Mendoza' : (g ?? ''));
const sinSelector = (t: string) => expect(t).not.toContain('️');

describe('Reporte de un pedido', () => {
  it('detalle: motorizado con nombre y apellido, pasos con hora, almacén, nota, fotos y solo lo que se compra', () => {
    const d = detallePedido(pedido(), nombres);
    expect(d.motorizado).toBe('Carlos Mendoza');
    expect(d.pasos.map((x) => x.paso)).toEqual(['Pagada por Tesorería', 'Tomada por el delivery', 'En camino', 'Entregada en almacén']);
    expect(d.tiempo).toBe('1 h 05 min');
    expect(d.almacen).toBe('General');
    expect(d.nota).toBe('Completo');
    expect([d.fotosRecibo, d.fotosEntrega]).toEqual([1, 2]);
    expect(d.productos).toEqual([{ nombre: 'RODAMIENTO 6205', cantidad: '4 und' }]);
  });

  it('cancelado: motivo y detalle; sin tiempo de entrega', () => {
    const d = detallePedido(pedido({
      estado: 'cancelado', entregado_en: null, cancelado_en: '2026-10-31T13:30:00Z', motivo_cancel: 'Avería del vehículo', detalle_cancel: 'Se pinchó',
    }));
    expect(d.motivoCancel).toBe('Avería del vehículo · Se pinchó');
    expect(d.tiempo).toBe('—');
    expect(d.pasos.at(-1)?.paso).toBe('Cancelada');
  });

  it('por tomar: sin delivery ni pasos de toma', () => {
    const d = detallePedido(pedido({ estado: 'por_tomar', pedido_id: null, repartidor_id: null, repartidor_nombre: null, aceptado_en: null, en_ruta_en: null, entregado_en: null }));
    expect(d.motorizado).toBe('—');
    expect(d.pasos).toHaveLength(1);
  });

  it('WhatsApp del pedido', () => {
    const t = textoReportePedido(pedido(), nombres, '31/10/2026 10:00');
    expect(t).toContain('📋 *REPORTE DE DELIVERY*');
    expect(t).toContain('🔹 *Orden:* OC-2026-0181 · 🚨 URGENTE');
    expect(t).toContain('👤 *Delivery:* Carlos Mendoza');
    expect(t).toContain('🏬 *Almacén de entrega:* General');
    expect(t).toContain('• En camino:');
    expect(t).toContain('⏳ *Tiempo de entrega:* 1 h 05 min');
    expect(t).toContain('📝 *Nota:* Completo');
    expect(t).toContain('📷 *Fotos:* 1 al recibir · 2 de la entrega');
    expect(t).not.toContain('GUANTES');
    expect(t).toContain('MINERAL GROUP GUAYANA C.A.');
    sinSelector(t);
  });
});

describe('Reporte general', () => {
  const base = {
    origen: 'compra' as const, nota_entrega: null, fotos_recibo: [] as FotoDelivery[], fotos_entrega: [] as FotoDelivery[],
    repartidor_email: null, en_ruta_en: null, entregado_en: null, cancelado_en: null, motivo_cancel: null, almacen_entrega: null,
  };
  const rows = [
    { ...base, id: 'a', orden_id: 'o1', estado: 'entregado', repartidor_nombre: 'Pedro', aceptado_en: '2026-10-30T12:00:00Z', entregado_en: '2026-10-30T12:30:00Z', almacen_entrega: 'General', nota_entrega: 'ok', fotos_recibo: [{ path: 'p1' }] as FotoDelivery[], fotos_entrega: [{ path: 'p2' }, { path: 'p3' }] as FotoDelivery[], orden: { oc_codigo: 'OC-1', codigo: 'SP-1', total: 10, moneda: 'USD', proveedor_id: 'p1' } },
    { ...base, id: 'b', orden_id: 'o2', estado: 'entregado', repartidor_nombre: 'Pedro', aceptado_en: '2026-10-30T13:00:00Z', entregado_en: '2026-10-30T14:00:00Z', orden: { oc_codigo: 'OC-2', codigo: 'SP-2', total: 5, moneda: 'Bs', proveedor_id: 'p1' } },
    { ...base, id: 'c', orden_id: 'o3', estado: 'cancelado', repartidor_nombre: 'Ana', aceptado_en: '2026-10-30T09:00:00Z', cancelado_en: '2026-10-30T09:10:00Z', motivo_cancel: 'Avería del vehículo', orden: null },
    { ...base, id: 'd', orden_id: 'o3', estado: 'en_ruta', repartidor_nombre: 'Ana', aceptado_en: '2026-10-30T10:00:00Z', orden: null },
  ];
  const filas = armarFilasHistorial(rows, new Map([['p1', 'Ferretería X']]));

  it('las filas traen nota y cantidad de fotos', () => {
    expect(filas[0]).toMatchObject({ nota_entrega: 'ok', fotos: 3 });
    expect(filas[1]).toMatchObject({ nota_entrega: null, fotos: 0 });
  });

  it('filtra por estado y por delivery', () => {
    expect(filtrarHistorial(filas, { estado: 'entregado' }).map((f) => f.id)).toEqual(['a', 'b']);
    expect(filtrarHistorial(filas, { repartidor: 'Ana' }).map((f) => f.id)).toEqual(['c', 'd']);
    expect(filtrarHistorial(filas, { estado: 'cancelado', repartidor: 'Pedro' })).toEqual([]);
    expect(filtrarHistorial(filas, {})).toHaveLength(4);
    expect(ESTADOS_FILTRO.map((e) => e.valor)).toEqual(['', 'aceptado', 'en_ruta', 'entregado', 'cancelado']);
  });

  it('totales por estado, por delivery y promedio', () => {
    const r = resumenReporte(filas);
    expect(r.total).toBe(4);
    expect(r.porEstado).toEqual({ aceptado: 0, en_ruta: 1, entregado: 2, cancelado: 1 });
    expect(r.porDelivery.map((x) => x.repartidor)).toEqual(['Pedro', 'Ana']);
    expect(r.minutosPromedio).toBe(45);
  });

  it('texto de los filtros', () => {
    expect(textoFiltros({ desde: '2026-10-26', hasta: '2026-10-31' })).toBe('Del 26/10/2026 al 31/10/2026');
    expect(textoFiltros({ desde: '2026-10-31', hasta: '2026-10-31', estado: 'entregado', repartidor: 'Ana' }))
      .toBe('Día 31/10/2026 · Estado: Entregado en almacén · Delivery: Ana');
  });

  it('WhatsApp general: resumen, por delivery y la lista', () => {
    const t = textoReporteGeneral({ desde: '2026-10-26', hasta: '2026-10-31', filas, generado: 'x' });
    expect(t).toContain('📊 *REPORTE DE DELIVERY*');
    expect(t).toContain('📦 *Pedidos tomados:* 4');
    expect(t).toContain('✅ Entregados: 2');
    expect(t).toContain('⛔ Cancelados: 1');
    expect(t).toContain('⏳ *Tiempo promedio de entrega:* 45 min');
    expect(t).toContain('• Pedro: 2 entregado(s), 0 cancelado(s), 0 en curso · 45 min');
    expect(t).toContain('OC-1 · Ferretería X · Pedro');
    expect(t).toContain('Avería del vehículo');
    sinSelector(t);
  });

  it('WhatsApp general: sin pedidos y con más de los que caben', () => {
    expect(textoReporteGeneral({ desde: '2026-10-31', hasta: '2026-10-31', filas: [] })).toContain('No hay pedidos tomados con esos filtros.');
    const muchas = Array.from({ length: MAX_PEDIDOS_WHATSAPP + 3 }, (_, i) => ({ ...filas[0], id: `x${i}` }));
    expect(textoReporteGeneral({ desde: '2026-10-31', hasta: '2026-10-31', filas: muchas })).toContain('… y 3 más (ver el PDF).');
  });
});

describe('Retiro en Almacén Los Pinos (02/11/2026)', () => {
  const retiro = pedido({
    origen: 'almacen', oc_codigo: null, codigo: 'SP-2026-0391', pagada_en: null, revisada_en: '2026-11-02T12:00:00Z', total: 0,
    proveedor_id: null, proveedor_nombre: 'Almacén Los Pinos', proveedor_direccion: null, proveedor_telefono: null,
    almacen_destino: null, almacen_entrega: 'PRODUCCION · ENDER MEJIA', unidad_solicitante: 'PRODUCCION', solicitante_nombre: 'ENDER MEJIA',
    analista_nombre: 'ISNER ORENCE',
  });

  it('detalle del retiro: SP, sin monto, pasos con la revisión de Almacén, «Entregado a»', () => {
    const d = detallePedido(retiro, nombres);
    expect(d.origen).toBe('almacen');
    expect(d.rotuloOrden).toBe('Solicitud de pedido');
    expect(d.oc).toBe('SP-2026-0391');
    expect(d.estado).toBe('Entregado');
    expect(d.monto).toBe('—');
    expect(d.proveedor).toBe('Almacén Los Pinos');
    expect(d.almacen).toBe('PRODUCCION · ENDER MEJIA');
    expect(d.pasos.map((x) => x.paso)).toEqual(['Revisada por Almacén (hay en Los Pinos)', 'Tomada por el delivery', 'En camino', 'Entregada a quien la pidió']);
  });

  it('WhatsApp del retiro', () => {
    const t = textoReportePedido(retiro, nombres, 'x');
    expect(t).toContain('📋 *REPORTE DE DELIVERY · RETIRO EN ALMACÉN*');
    expect(t).toContain('🔹 *Solicitud:* SP-2026-0391');
    expect(t).toContain('📦 *Retirar en:* Almacén Los Pinos');
    expect(t).toContain('🏬 *Entregado a:* PRODUCCION · ENDER MEJIA');
    expect(t).not.toContain('Monto');
    expect(t).toContain('1 al retirar en Almacén');
    sinSelector(t);
  });

  it('general: filas del retiro, filtro por origen y conteo por origen', () => {
    const base = {
      origen: 'compra' as const, nota_entrega: null, fotos_recibo: [] as FotoDelivery[], fotos_entrega: [] as FotoDelivery[],
      repartidor_email: null, en_ruta_en: null, entregado_en: null, cancelado_en: null, motivo_cancel: null, almacen_entrega: null,
    };
    const filas = armarFilasHistorial([
      { ...base, id: 'a', orden_id: 'o1', estado: 'entregado', repartidor_nombre: 'Pedro', aceptado_en: '2026-11-02T12:00:00Z', orden: { oc_codigo: 'OC-1', codigo: 'SP-1', total: 10, moneda: 'USD', proveedor_id: 'p1' } },
      { ...base, id: 'b', orden_id: 'o1', origen: 'almacen', estado: 'entregado', repartidor_nombre: 'Ana', aceptado_en: '2026-11-02T10:00:00Z', almacen_entrega: 'PRODUCCION', orden: { oc_codigo: 'OC-1', codigo: 'SP-1', total: 10, moneda: 'USD', proveedor_id: 'p1' } },
    ], new Map([['p1', 'Ferretería X']]));
    expect(filas[1]).toMatchObject({ origen: 'almacen', oc: 'SP-1', proveedor: 'Almacén Los Pinos', total: 0 });
    expect(filas[0]).toMatchObject({ origen: 'compra', oc: 'OC-1', proveedor: 'Ferretería X', total: 10 });
    expect(filtrarHistorial(filas, { origen: 'almacen' }).map((f) => f.id)).toEqual(['b']);
    expect(filtrarHistorial(filas, { origen: 'compra' }).map((f) => f.id)).toEqual(['a']);
    expect(filtrarHistorial(filas, { origen: '' })).toHaveLength(2);
    expect(filtrarPorOrigen(filas, 'almacen').map((f) => f.id)).toEqual(['b']);
    expect(resumenReporte(filas).porOrigen).toEqual({ compra: 1, almacen: 1 });
    expect(ORIGENES_FILTRO.map((o) => o.valor)).toEqual(['', 'compra', 'almacen']);
    expect(textoFiltros({ desde: '2026-11-02', hasta: '2026-11-02', origen: 'almacen' })).toBe('Día 02/11/2026 · Origen: Almacén Los Pinos');
    const t = textoReporteGeneral({ desde: '2026-11-02', hasta: '2026-11-02', filas, generado: 'x' });
    expect(t).toContain('🏭 De Compras (OC): 1 · 📦 Retiros en Almacén Los Pinos: 1');
    expect(t).toContain('SP-1 · 📦 Almacén Los Pinos · Ana');
    sinSelector(t);
  });
});

describe('Toma viva de una OC que Almacén ya recibió (02/11/2026)', () => {
  it('el histórico la muestra cerrada «Recibida por Almacén» y no cuenta para el motorizado', () => {
    const base = {
      origen: 'compra' as const, nota_entrega: null, fotos_recibo: [] as FotoDelivery[], fotos_entrega: [] as FotoDelivery[],
      repartidor_email: null, en_ruta_en: null, entregado_en: null, cancelado_en: null, motivo_cancel: null, almacen_entrega: null,
    };
    const filas = armarFilasHistorial([
      { ...base, id: 'a', orden_id: 'o1', estado: 'en_ruta', repartidor_nombre: 'Pedro', aceptado_en: '2026-11-02T12:00:00Z',
        orden: { oc_codigo: 'OC-1', codigo: 'SP-1', total: 10, moneda: 'USD', proveedor_id: null, recibida_en: '2026-11-02T13:00:00Z' } },
      { ...base, id: 'b', orden_id: 'o2', estado: 'en_ruta', repartidor_nombre: 'Pedro', aceptado_en: '2026-11-02T12:00:00Z',
        orden: { oc_codigo: 'OC-2', codigo: 'SP-2', total: 10, moneda: 'USD', proveedor_id: null, recibida_en: null } },
    ], new Map());
    expect(filas[0]).toMatchObject({ estado: 'cancelado', motivo_cancel: 'Recibida por Almacén', cancelado_en: '2026-11-02T13:00:00Z' });
    expect(filas[1]).toMatchObject({ estado: 'en_ruta', motivo_cancel: null });
    expect(resumenReporte(filas).porDelivery[0]).toMatchObject({ repartidor: 'Pedro', cancelados: 0, enCurso: 1 });
    expect(detallePedido(pedido({ estado: 'cancelado', motivo_cancel: 'Recibida por Almacén' })).estado).toBe('Recibida por Almacén');
  });
});
