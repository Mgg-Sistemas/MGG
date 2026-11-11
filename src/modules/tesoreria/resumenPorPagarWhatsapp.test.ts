import { describe, expect, it } from 'vitest';
import { errorResumenPorPagar, estadoItemResumen, textoResumenPorPagar, type ItemResumenPorPagar } from './resumenPorPagarWhatsapp';

const AHORA = new Date('2026-11-04T23:30:00Z'); // 07:30 p. m. en Venezuela

const items: ItemResumenPorPagar[] = [
  { codigo: 'OC-2026-0243', proveedor: 'HOUS PROYECTOS DE HOGAR', montoUsd: 1576.08, motivo: 'si' },
  { codigo: 'SV-2026-0021', proveedor: 'TIGASCO, C.A.', montoUsd: 26.23, motivo: 'sin_fondos' },
];

describe('resumen por lote de las órdenes por pagar (04-11-2026)', () => {
  it('lleva la fecha, el código, el proveedor, el monto en $ y el total', () => {
    const t = textoResumenPorPagar(items, AHORA);
    const l = t.split('\n');
    expect(l[0]).toBe('🧾 *RESUMEN · ÓRDENES POR PAGAR*');
    expect(l[1]).toMatch(/^📅 \*Generado:\* 04\/11\/2026 /);
    expect(t).toContain('1. 🔹 *OC-2026-0243* · HOUS PROYECTOS DE HOGAR');
    expect(t).toContain('💵 *A pagar:* $1.576,08 · ✅ *Se pagará*');
    expect(t).toContain('💵 *A pagar:* $26,23 · ⏸ *No se pagará* · *Sin fondos en estos momentos*');
    expect(t).toContain('💰 *Total (2 órdenes):* *$1.602,31*');
    expect(t).toContain('✅ *Se pagarán (1):* *$1.576,08*');
    expect(t).not.toMatch(/Bs/);
    expect(t).not.toContain('️');
  });

  it('si todas se pagan no repite el desglose', () => {
    const t = textoResumenPorPagar([items[0]], AHORA);
    expect(t).toContain('💰 *Total (1 orden):* *$1.576,08*');
    expect(t).not.toContain('Se pagarán (');
  });

  it('«otro» usa lo escrito y lo exige', () => {
    expect(estadoItemResumen({ motivo: 'otro', motivoOtro: '  falta factura ' })).toBe('⏸ *No se pagará* · *falta factura*');
    expect(estadoItemResumen({ motivo: 'esperando_jefe' })).toBe('⏸ *No se pagará* · *Esperando respuestas por el jefe*');
    expect(errorResumenPorPagar([{ ...items[0], motivo: 'otro', motivoOtro: ' ' }])).toMatch(/OC-2026-0243/);
    expect(errorResumenPorPagar([])).toMatch(/al menos una/);
    expect(errorResumenPorPagar(items)).toBeNull();
  });
});
