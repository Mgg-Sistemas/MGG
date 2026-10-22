import { describe, it, expect } from 'vitest';
import type { OfertaProveedor, Orden } from '@/shared/lib/types';
import {
  calcularDesgloseModalidadesOferta,
  obtenerInfoModalidadPago,
} from './modalidadPago';

describe('modalidadPago', () => {
  it('calcula desglose de oferta con precio BCV y precio Divisa con impuestos', () => {
    // Caso de MAPLOCA: Base BCV 3879.31, Base Divisa 3300.00, IVA 620.69
    const ofertaMaploca = {
      precio_total: 3879.31,
      precio_divisa: 3300.00,
      iva_aplicado: true,
      iva_monto: 620.69,
      items: [
        {
          sku: 'MAT-110',
          nombre: 'LAMINA HIERRO NEGRO',
          cantidad: 10,
          precio: 387.931,
          precio_usd: 330,
        },
      ],
    } as unknown as OfertaProveedor;

    const desglose = calcularDesgloseModalidadesOferta(ofertaMaploca);
    expect(desglose.totalBcv).toBe(4500);
    expect(desglose.totalDivisa).toBe(3920.69);
    expect(desglose.tieneOpcionDivisa).toBe(true);
    expect(desglose.hayDiferencia).toBe(true);
    expect(desglose.ahorroDivisa).toBe(579.31);
    expect(desglose.ahorroPct).toBeCloseTo(12.87, 1);
  });

  it('obtiene info de orden pagada en divisa desde historial', () => {
    const orden = {
      total: 3920.69,
      total_divisa: 3920.69,
      pago_en_divisa: true,
      iva_aplicado: true,
      iva_monto: 620.69,
      historial: [
        {
          evento: 'oc_creada',
          precio_bcv: 3879.31,
          precio: 3920.69,
        },
      ],
    } as unknown as Orden;

    const info = obtenerInfoModalidadPago(orden);
    expect(info.esDivisa).toBe(true);
    expect(info.modalidad).toBe('divisa');
    expect(info.etiquetaCorta).toBe('Pago en $');
    expect(info.precioBcv).toBe(4500);
    expect(info.ahorro).toBe(579.31);
    expect(info.tieneComparativa).toBe(true);
  });

  it('obtiene info de orden pagada en Bs a tasa BCV', () => {
    const orden = {
      total: 4500,
      total_divisa: 3920.69,
      pago_en_divisa: false,
      historial: [],
    } as unknown as Orden;

    const info = obtenerInfoModalidadPago(orden);
    expect(info.esDivisa).toBe(false);
    expect(info.modalidad).toBe('bcv');
    expect(info.etiquetaCorta).toBe('Pago en Bs (BCV)');
    expect(info.precioBcv).toBe(4500);
    expect(info.precioDivisa).toBe(3920.69);
    expect(info.tieneComparativa).toBe(true);
  });
});
