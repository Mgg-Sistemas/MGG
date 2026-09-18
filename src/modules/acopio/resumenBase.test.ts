import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));

import { baseDesdeUltimo, sectoresPorDefecto, type SectorResumen } from './resumenSemanal.repository';
import { nombreAlmacenVisible } from '@/modules/inventario/sectorizacion';

describe('baseDesdeUltimo', () => {
  it('sin histórico arranca de los sectores por defecto', () => {
    expect(baseDesdeUltimo(null)).toEqual(sectoresPorDefecto());
  });

  it('conserva los valores manuales del último reporte', () => {
    const ultimo: SectorResumen[] = [{
      nombre: 'SECTOR MGG · LOS PINOS', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      centros: [{ centro: 'C.A. LOS PINOS MGG', kg_cobrar: 0, kg_disponible: 29053.5 }],
    }];
    const base = baseDesdeUltimo(ultimo);
    expect(base[0].centros[0].kg_disponible).toBe(29053.5);
    expect(ultimo[0].centros[0]).not.toBe(base[0].centros[0]);
  });

  it('completa el vínculo estándar cuando falta, pero respeta el que se dejó manual (null)', () => {
    const ultimo: SectorResumen[] = [{
      nombre: 'SECTOR LA ESPERANZA', resguardos_gt: 0, precio_prom: 15.57, saldo_usd: 933.48,
      centros: [
        { centro: 'C.A. LA ESPERANZA - P-MGG06-B JUAN BODEGA', kg_cobrar: 220, kg_disponible: 626.2 },
        { centro: 'C.A. LA ESPERANZA - P-MGG06 - A COMERCIALIZACIÓN', kg_cobrar: 0, kg_disponible: 279.26, fuente: null },
      ],
    }];
    const [esp] = baseDesdeUltimo(ultimo);
    expect(esp.centros[0].fuente?.sistema).toBe('mgg-aliado');
    expect(esp.centros[0].fuente_cobrar?.sistema).toBe('mgg-aliado-saldokg');
    expect(esp.centros[1].fuente).toBeNull();
    expect(esp.centros[1].kg_disponible).toBe(279.26);
    expect(esp.fuente_saldo?.metrica).toBe('acopio_saldo_usd');
  });
});

describe('nombreAlmacenVisible', () => {
  it('el almacén General se muestra como MATANZA', () => {
    expect(nombreAlmacenVisible('General')).toBe('MATANZA');
    expect(nombreAlmacenVisible('Los Pinos')).toBe('Los Pinos');
    expect(nombreAlmacenVisible(null)).toBe('');
  });
});
