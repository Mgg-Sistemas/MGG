import { describe, expect, it } from 'vitest';
import type { RetencionItem } from '../datos/puerta';
import { archivosFactura, avisoDeDocumento, avisoRetencionPago, itemDelRetenido, retenidoSinRegistrar, type RetenidoAlPagar } from './porRealizarExtras';

// Datos ficticios
const oc = (over: Partial<RetencionItem> = {}): RetencionItem => ({
  kind: 'oc', id: 'o1', ocCodigo: 'OC-0001', opCodigo: null, proveedorNombre: 'Proveedor de prueba', proveedorId: 'p1', proveedorRif: 'J-00000000-0',
  condicionLabel: '', retencionLabel: '', moneda: 'USD', total: 1160, tesoreria: 'na', finalizada: false, finalizadaEn: null, tiposComprobante: [], ...over,
});
const compra = (c: Record<string, unknown>): RetencionItem => oc({ kind: 'compra_directa', id: 'c1', ocCodigo: 'CD-0001', compra: c as unknown as RetencionItem['compra'] });

describe('el aviso del pago mayor al debido (C2 a)', () => {
  it('pagada sin descontar la retención: el monto pagado supera el debido', () => {
    expect(avisoRetencionPago({ pagada: true, retencionMonto: 120, retPagoMonto: 0, moneda: 'Bs' }))
      .toBe('Pago efectuado sin descontar la retención de IVA (Bs 120,00): el monto pagado al proveedor supera el debido.');
  });

  it('descontó otro monto: dice los dos', () => {
    expect(avisoRetencionPago({ pagada: true, retencionMonto: 120, retPagoMonto: 100, moneda: 'USD' }))
      .toBe('Monto descontado al pagar: $ 100,00. Retención de IVA de la compra: $ 120,00.');
  });

  it('sin pagar, sin retención o con los montos iguales: no avisa', () => {
    expect(avisoRetencionPago({ pagada: false, retencionMonto: 120, retPagoMonto: 0, moneda: 'Bs' })).toBeNull();
    expect(avisoRetencionPago({ pagada: true, retencionMonto: 0, retPagoMonto: 0, moneda: 'Bs' })).toBeNull();
    expect(avisoRetencionPago({ pagada: true, retencionMonto: 120, retPagoMonto: 120.004, moneda: 'Bs' })).toBeNull();
  });

  it('en la lista: solo las compras directas, pagadas si están finalizadas o tienen egreso de caja', () => {
    expect(avisoDeDocumento(compra({ estado: 'finalizada', caja_mov_id: null, retencion_monto: 50, ret_pago_monto: 0, moneda: 'Bs' }))).toContain('supera el debido');
    expect(avisoDeDocumento(compra({ estado: 'recibida', caja_mov_id: 'm1', retencion_monto: 50, ret_pago_monto: 0, moneda: 'Bs' }))).toContain('supera el debido');
    expect(avisoDeDocumento(compra({ estado: 'recibida', caja_mov_id: null, retencion_monto: 50, ret_pago_monto: 0, moneda: 'Bs' }))).toBeNull();
    expect(avisoDeDocumento(oc())).toBeNull();
  });
});

describe('los archivos de la factura («📎 Factura»)', () => {
  it('la OC: su factura cargada en Compras', () => {
    expect(archivosFactura(oc({ orden: { factura_path: 'o1/factura-a.pdf', factura_nombre: 'a.pdf' } as unknown as RetencionItem['orden'] })))
      .toEqual([{ origen: 'oc', path: 'o1/factura-a.pdf', nombre: 'a.pdf' }]);
  });

  it('la compra directa: todas sus facturas', () => {
    expect(archivosFactura(compra({ facturas: [{ path: 'c1/1-a.pdf', filename: 'a.pdf', at: '' }, { path: 'c1/2-b.jpg', filename: 'b.jpg', at: '' }] })).map((a) => a.path))
      .toEqual(['c1/1-a.pdf', 'c1/2-b.jpg']);
  });

  it('sin archivo: la lista vacía', () => {
    expect(archivosFactura(oc())).toEqual([]);
    expect(archivosFactura(oc({ orden: { factura_path: null } as unknown as RetencionItem['orden'] }))).toEqual([]);
    expect(archivosFactura(compra({ facturas: [] }))).toEqual([]);
  });
});

describe('lo retenido al pagar que no está en el libro (C1)', () => {
  const r = (over: Partial<RetenidoAlPagar> = {}): RetenidoAlPagar => ({
    kind: 'oc', id: 'o1', codigo: 'OC-0001', proveedorId: 'p1', proveedorNombre: 'Proveedor de prueba', proveedorRif: null,
    moneda: 'USD', total: 1160, retenido: 120, retenidoBs: null, retenidoUsd: 120, tasa: 40, ...over,
  });

  it('lista lo retenido sin una retención practicada viva del mismo documento', () => {
    const libro = [{ docKind: 'oc', docId: 'o2', direccion: 'practicada', anulada: false }];
    expect(retenidoSinRegistrar([r(), r({ id: 'o2' })], libro).map((x) => x.id)).toEqual(['o1']);
  });

  it('una anulada o una recibida no cuentan como registrada', () => {
    const libro = [{ docKind: 'oc', docId: 'o1', direccion: 'practicada', anulada: true }, { docKind: 'oc', docId: 'o1', direccion: 'recibida', anulada: false }];
    expect(retenidoSinRegistrar([r()], libro)).toHaveLength(1);
  });

  it('sin monto retenido no se lista', () => {
    expect(retenidoSinRegistrar([r({ retenido: 0 })], [])).toEqual([]);
  });

  it('el documento de la lista con que se registra (OC o compra; el servicio directo no tiene)', () => {
    const items = [oc(), compra({})];
    expect(itemDelRetenido(r(), items)?.id).toBe('o1');
    expect(itemDelRetenido(r({ kind: 'compra_directa', id: 'c1' }), items)?.id).toBe('c1');
    expect(itemDelRetenido(r({ kind: 'servicio_directo', id: 's1' }), items)).toBeNull();
  });
});
