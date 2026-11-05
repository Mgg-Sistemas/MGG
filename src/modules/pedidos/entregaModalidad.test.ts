import { describe, expect, it } from 'vitest';
import type { Orden } from '@/shared/lib/types';
import { entregaDe, etiquetaEntrega, OPCIONES_ENTREGA, pideEntrega } from './entregaModalidad';
import { textoOrdenPago } from './ordenPagoTxt';

describe('¿Quién entrega la orden? (04-11-2026)', () => {
  it('tres opciones: Delivery, Carga pesada y Con entrega a domicilio', () => {
    expect(OPCIONES_ENTREGA.map((o) => o.value)).toEqual(['delivery', 'carga_pesada', 'proveedor']);
    expect(etiquetaEntrega('proveedor')).toBe('🏠 Con entrega a domicilio');
  });

  it('las órdenes de antes (sin dato) siguen siendo delivery', () => {
    expect(entregaDe({ entrega_modalidad: null })).toBe('delivery');
    expect(entregaDe({ entrega_modalidad: 'carga_pesada' })).toBe('carga_pesada');
  });

  it('se pide en las OC; no en servicios ni en contra entrega (ya llegó)', () => {
    expect(pideEntrega({ clase: 'producto', condiciones_pago: 'contado' } as Orden)).toBe(true);
    expect(pideEntrega({ clase: 'servicio', condiciones_pago: 'contado' } as Orden)).toBe(false);
    expect(pideEntrega({ clase: 'producto', condiciones_pago: 'contra_entrega' } as Orden)).toBe(false);
  });

  it('el WhatsApp para pagar dice quién entrega', () => {
    const base = { id: '1', codigo: 'SP-1', oc_codigo: 'OC-2026-0300', total: 10, moneda: 'USD', items: [] } as unknown as Orden;
    expect(textoOrdenPago({ ...base, entrega_modalidad: 'carga_pesada' }, 'X')).toContain('🚚 *Entrega:* Carga pesada');
    expect(textoOrdenPago(base, 'X')).not.toContain('Entrega:');
  });
});
