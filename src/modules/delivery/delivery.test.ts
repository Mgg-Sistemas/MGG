import { describe, expect, it } from 'vitest';
import {
  MOTIVO_RECIBIDA_ALMACEN, almacenRecepcion, almacenVisible, cerradoPorRecepcion, claveDelivery, destinoDe, destinoRetiro, esRetiroAlmacen, etiquetaEstado, mensajeAceptado, mensajeCancelado, mensajeEnRuta,
  mensajeEntregado, mensajeNoDisponible, minutosEntre, motivoNoDisponible, origenTxt, rechazosDe, resumenPorDelivery, rotuloFotos,
  type PedidoDelivery,
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
  fotos_recibo: [{ path: 'a', filename: 'a.jpg' }], fotos_entrega: [], fotos_factura: [], historial: [], es_mio: true,
};

const sinSelector = (t: string) => expect(t).not.toContain('️');

describe('Delivery · mensajes de WhatsApp', () => {
  it('aceptado: orden, urgencia, proveedor, destino y solo lo que se compra', () => {
    const t = mensajeAceptado(base, 'CARLOS MENDOZA');
    expect(t).toContain('🚚 *EN CAMINO · PEDIDO ACEPTADO POR DELIVERY*');
    expect(t).toContain('🔹 *Orden:* OC-2026-0219');
    expect(t).toContain('🚨 *Requerimiento:* URGENTE');
    expect(t).toContain('🏬 *Entregar en:* Los Pinos');
    expect(t).toContain('• RODAMIENTO 6205 — 4 und');
    expect(t).not.toContain('GUANTES');
    expect(t).toContain('🏢 *MINERAL GROUP GUAYANA C.A.* · Delivery');
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
    expect(mensajeEnRuta(base, 'CARLOS')).toContain('📷 *Fotos al recibir:* 1');
    const t = mensajeEntregado(base, 'CARLOS', 'Los Pinos', 'Completo', '2026-10-30T13:45:00Z');
    expect(t).toContain('✅ *PEDIDO ENTREGADO EN ALMACÉN*');
    expect(t).toContain('*Tiempo desde que lo tomó:* 45 min');
    sinSelector(t);
  });
});

describe('Delivery · retiro en Almacén Los Pinos (02/11/2026)', () => {
  const retiro: PedidoDelivery = {
    ...base, origen: 'almacen', oc_codigo: null, codigo: 'SP-2026-0391', proveedor_id: null, proveedor_nombre: 'Almacén Los Pinos',
    proveedor_direccion: null, almacen_destino: null, unidad_solicitante: 'PRODUCCION', solicitante_nombre: 'ENDER MEJIA',
    items: [{ nombre: 'GUANTES DE CARNAZA', cantidad: 4, unidad: 'und' }, { nombre: 'ACEITE 68', cantidad: 1, unidad: 'und' }],
  };

  it('origen, destino, clave y estado', () => {
    expect(esRetiroAlmacen(retiro)).toBe(true);
    expect(esRetiroAlmacen(base)).toBe(false);
    expect(claveDelivery(retiro)).toBe('o1:almacen');
    expect(claveDelivery(base)).toBe('o1:compra');
    expect(destinoRetiro(retiro)).toBe('PRODUCCION · ENDER MEJIA');
    expect(destinoDe(retiro)).toBe('PRODUCCION · ENDER MEJIA');
    expect(destinoDe({ ...retiro, almacen_entrega: 'Jefe de turno' })).toBe('Jefe de turno');
    expect(destinoDe(base)).toBe('Los Pinos');
    expect(origenTxt(retiro)).toBe('📦 Retiro en Almacén Los Pinos');
    expect(etiquetaEstado('entregado', 'almacen')).toBe('Entregado');
    expect(etiquetaEstado('entregado', 'compra')).toBe('Entregado en almacén');
    expect(etiquetaEstado('en_ruta')).toBe('En camino');
    expect(rotuloFotos('almacen', 'recibo')).toBe('Al retirar en Almacén');
    expect(rotuloFotos('compra', 'recibo')).toBe('Fotos del producto (al recibir del proveedor)');
  });

  it('mensajes: SP, «Retirar en», «Entregar a» / «Entregado a»', () => {
    const a = mensajeAceptado(retiro, 'CARLOS');
    expect(a).toContain('🚚 *EN CAMINO · RETIRO EN ALMACÉN LOS PINOS*');
    expect(a).toContain('🔹 *Solicitud:* SP-2026-0391');
    expect(a).toContain('📦 *Retirar en:* Almacén Los Pinos');
    expect(a).toContain('🏬 *Entregar a:* PRODUCCION · ENDER MEJIA');
    expect(a).not.toContain('Proveedor');
    expect(mensajeEnRuta(retiro, 'CARLOS')).toContain('📷 *Fotos al retirar en Almacén:* 1');
    const e = mensajeEntregado(retiro, 'CARLOS', 'PRODUCCION · ENDER MEJIA', null, '2026-10-30T13:45:00Z');
    expect(e).toContain('✅ *RETIRO DE ALMACÉN ENTREGADO*');
    expect(e).toContain('🏬 *Entregado a:* PRODUCCION · ENDER MEJIA');
    expect(mensajeCancelado(retiro, 'CARLOS', 'Avería del vehículo')).toContain('El retiro queda disponible');
    sinSelector(a); sinSelector(e);
  });

  it('No disponible: mensaje, motivo armado y rechazos del pedido', () => {
    const t = mensajeNoDisponible(base, 'CARLOS', 'Estoy en otra entrega');
    expect(t).toContain('🛵 *DELIVERY NO DISPONIBLE*');
    expect(t).toContain('🔹 *Orden:* OC-2026-0219');
    expect(t).toContain('🏭 *Proveedor:* FERRETERÍA CARONÍ');
    expect(t).toContain('👤 *Delivery:* CARLOS');
    expect(t).toContain('📝 *Motivo:* Estoy en otra entrega');
    expect(mensajeNoDisponible(retiro, 'CARLOS', 'x')).toContain('🔹 *Solicitud:* SP-2026-0391');
    sinSelector(t);
    expect(motivoNoDisponible('Avería del vehículo', '')).toBe('Avería del vehículo');
    expect(motivoNoDisponible('Avería del vehículo', 'caucho')).toBe('Avería del vehículo · caucho');
    expect(motivoNoDisponible('Otro motivo', ' voy al banco ')).toBe('voy al banco');
    expect(motivoNoDisponible('Otro motivo', '')).toBe('');
    const r = (id: string, origen: 'compra' | 'almacen', at: string) => ({
      id, orden_id: 'o1', origen, repartidor_id: 'u', repartidor_email: null, repartidor_nombre: 'X', motivo: 'm', created_at: at,
    });
    const lista = [r('a', 'compra', '2026-11-02T10:00:00Z'), r('b', 'almacen', '2026-11-02T11:00:00Z'), r('c', 'compra', '2026-11-02T12:00:00Z')];
    expect(rechazosDe(base, lista).map((x) => x.id)).toEqual(['c', 'a']);
    expect(rechazosDe(retiro, lista).map((x) => x.id)).toEqual(['b']);
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

describe('Delivery · recepción en Inventario (02/11/2026)', () => {
  it('«Recibida por Almacén»: etiqueta, no cuenta como cancelación del motorizado', () => {
    const cerrado = { ...base, estado: 'cancelado' as const, motivo_cancel: MOTIVO_RECIBIDA_ALMACEN };
    expect(cerradoPorRecepcion(cerrado)).toBe(true);
    expect(cerradoPorRecepcion({ ...base, estado: 'cancelado', motivo_cancel: 'Avería del vehículo' })).toBe(false);
    expect(etiquetaEstado('cancelado', 'compra', MOTIVO_RECIBIDA_ALMACEN)).toBe('Recibida por Almacén');
    expect(etiquetaEstado('cancelado', 'compra', 'Avería')).toBe('Cancelado');
    const r = resumenPorDelivery([cerrado, { ...base, estado: 'cancelado', motivo_cancel: 'Avería' }]);
    expect(r[0]).toMatchObject({ repartidor: 'CARLOS MENDOZA', cancelados: 1 });
  });

  it('almacén de la recepción: el de la OC, si no General (= Almacén Los Pinos)', () => {
    expect(almacenRecepcion({ almacen_destino: null })).toBe('General');
    expect(almacenRecepcion({ almacen_destino: ' Viveres ' })).toBe('Viveres');
    expect(almacenVisible('General')).toBe('Almacén Los Pinos (General)');
    expect(almacenVisible('Depósito Mina')).toBe('Depósito Mina');
    expect(almacenVisible('')).toBe('—');
  });

  it('el WhatsApp de la OC entregada dice que quedó recibida en Inventario (el retiro no)', () => {
    expect(mensajeEntregado(base, 'CARLOS', 'Almacén Los Pinos (General)')).toContain('📥 *Por recepcionar en almacén*');
    expect(mensajeEntregado({ ...base, origen: 'almacen' }, 'CARLOS', 'PRODUCCION')).not.toContain('Por recepcionar');
  });
});

describe('canales Delivery / Carga pesada (04/11/2026)', () => {
  it('cada canal ve lo suyo; «a domicilio» no es de carga pesada y sin dato es Delivery', async () => {
    const { esDelCanal, CANALES_DELIVERY } = await import('./delivery');
    expect(esDelCanal(null, 'delivery')).toBe(true);
    expect(esDelCanal('delivery', 'carga_pesada')).toBe(false);
    expect(esDelCanal('carga_pesada', 'carga_pesada')).toBe(true);
    expect(esDelCanal('carga_pesada', 'delivery')).toBe(false);
    expect(esDelCanal('proveedor', 'carga_pesada')).toBe(false);
    expect(CANALES_DELIVERY.carga_pesada.rutaTelefono).toBe('/app/carga-pesada/telefono');
  });

  it('el título de la pantalla: «CARGA PESADA» en Carga pesada y «Delivery» en Delivery', async () => {
    const { tituloPantallaCanal } = await import('./delivery');
    expect(tituloPantallaCanal('carga_pesada')).toBe('CARGA PESADA');
    expect(tituloPantallaCanal('delivery')).toBe('Delivery');
  });
});
