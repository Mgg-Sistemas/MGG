import { describe, it, expect } from 'vitest';
import { elegirComprobanteTesoreria } from './comprobanteTesoreria';
import type { Orden } from '@/shared/lib/types';

describe('elegirComprobanteTesoreria', () => {
  it('prefiere el comprobante guardado en el historial del evento pagada', () => {
    const orden = {
      id: 'oc-1',
      pagada_en: '2026-10-21T10:00:00.000Z',
      historial: [
        {
          evento: 'pagada',
          fecha: '2026-10-21T10:00:00.000Z',
          comprobante_path: 'oc-1/pago-voucher.pdf',
          comprobante_nombre: 'voucher.pdf',
        },
      ],
    } as unknown as Orden;

    const res = elegirComprobanteTesoreria(orden, [
      { name: 'factura-proveedor.pdf', created_at: '2026-10-21T12:00:00.000Z' },
    ]);

    expect(res).toEqual({
      path: 'oc-1/pago-voucher.pdf',
      nombre: 'voucher.pdf',
    });
  });

  it('si no está en el historial, busca archivos con prefijo pago-', () => {
    const orden = {
      id: 'oc-2',
      pagada_en: '2026-10-21T10:00:00.000Z',
      historial: [{ evento: 'pagada', fecha: '2026-10-21T10:00:00.000Z' }],
    } as unknown as Orden;

    const res = elegirComprobanteTesoreria(orden, [
      { name: 'pago-captura_transferencia.png', created_at: '2026-10-21T09:59:00.000Z' },
      { name: 'factura-fiscal.pdf', created_at: '2026-10-21T15:00:00.000Z' },
    ]);

    expect(res).toEqual({
      path: 'oc-2/pago-captura_transferencia.png',
      nombre: 'captura_transferencia.png',
    });
  });

  it('para OC viejas reconoce la factura subida al momento del pago y no la finalizada horas después', () => {
    const orden = {
      id: 'oc-3',
      pagada_en: '2026-10-20T10:00:00.000Z',
      historial: [{ evento: 'pagada', fecha: '2026-10-20T10:00:00.000Z' }],
    } as unknown as Orden;

    const res = elegirComprobanteTesoreria(orden, [
      { name: 'factura-comprobante_banco.pdf', created_at: '2026-10-20T09:58:00.000Z' },
      { name: 'factura-proveedor_final.pdf', created_at: '2026-10-21T16:00:00.000Z' },
    ]);

    expect(res).toEqual({
      path: 'oc-3/factura-comprobante_banco.pdf',
      nombre: 'comprobante_banco.pdf',
    });
  });

  it('devuelve null si no hay comprobante del pago', () => {
    const orden = {
      id: 'oc-4',
      pagada_en: '2026-10-20T10:00:00.000Z',
      historial: [],
    } as unknown as Orden;

    const res = elegirComprobanteTesoreria(orden, [
      { name: 'factura-solo_final.pdf', created_at: '2026-10-21T10:00:00.000Z' },
    ]);

    expect(res).toBeNull();
  });
});
