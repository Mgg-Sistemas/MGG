import { describe, expect, it } from 'vitest';
import type { Producto } from '@/shared/lib/types';
import type { SalidaTelefono } from './inventarioTelefono';
import type { TrasladoTelefono } from './historicosTelefono';
import { ajustesSalidaTelefono, ajustesTrasladoTelefono, validarEdicionSalidaTelefono, validarEdicionTrasladoTelefono } from './edicionTelefono';

const producto = (id: string): Producto => ({ id, nombre: `Material ${id}`, unidad: 'und' } as Producto);
const salida = (patch: Partial<SalidaTelefono> = {}): SalidaTelefono => ({
  id: 's1', codigo: 'SAT-CARLOS-0001', almacen: 'General', producto_id: 'p1', producto_nombre: 'Material p1',
  unidad: 'und', cantidad: 5, motivo: 'Motivo', autorizado_por: 'LEYDIS', retorna: false,
  retornado: 0, retornos: [], fotos: [], estado: 'sin_retorno', actor: 'carlos@x.com', actor_name: 'CARLOS', created_at: '2026-11-24T20:00:00Z', ...patch,
});
const traslado = (patch: Partial<TrasladoTelefono> = {}): TrasladoTelefono => ({
  id: 'm1', at: '2026-11-24T20:00:00Z', origen: 'General', destino: 'Los Pinos', producto_id: 'p1',
  producto_nombre: 'Material p1', sku: 'P1', unidad: 'und', cantidad: 5, motivo: 'Motivo',
  solicitado_por: 'LEYDIS', precio: 2, actor: 'carlos@x.com', actor_name: 'CARLOS', codigo: 'TRA-CARLOS-0001', ...patch,
});

describe('edición de salidas del teléfono', () => {
  it('aumentar descuenta solo la diferencia y disminuir reingresa', () => {
    expect(ajustesSalidaTelefono([salida()], [{ producto: producto('p1'), cantidad: 8 }])).toEqual([
      { producto_id: 'p1', producto_nombre: 'Material p1', almacen: 'General', delta: -3 },
    ]);
    expect(ajustesSalidaTelefono([salida()], [{ producto: producto('p1'), cantidad: 2 }])[0].delta).toBe(3);
  });

  it('cambiar material devuelve el viejo y descuenta el nuevo', () => {
    expect(ajustesSalidaTelefono([salida()], [{ producto: producto('p2'), cantidad: 5 }]).map((a) => [a.producto_id, a.delta])).toEqual([['p1', 5], ['p2', -5]]);
  });

  it('respeta lo ya retornado', () => {
    const vieja = salida({ retorna: true, retornado: 3, estado: 'por_retornar' });
    expect(validarEdicionSalidaTelefono([vieja], [{ producto: producto('p1'), cantidad: 2 }], true)).toContain('ya retornaron 3');
    expect(validarEdicionSalidaTelefono([vieja], [{ producto: producto('p1'), cantidad: 4 }], false)).toContain('no se puede marcar');
    expect(validarEdicionSalidaTelefono([vieja], [{ producto: producto('p2'), cantidad: 4 }], true)).toContain('no se puede cambiar el material');
    expect(validarEdicionSalidaTelefono([vieja], [{ producto: producto('p1'), cantidad: 4 }], true)).toBeNull();
  });
});

describe('edición de traslados del teléfono', () => {
  it('ajusta ambas patas por igual', () => {
    expect(ajustesTrasladoTelefono([traslado()], [{ producto: producto('p1'), cantidad: 8 }], 'Los Pinos')).toEqual([
      { producto_id: 'p1', producto_nombre: 'Material p1', almacen: 'General', delta: -3 },
      { producto_id: 'p1', producto_nombre: 'Material p1', almacen: 'Los Pinos', delta: 3 },
    ]);
  });

  it('cambiar destino retira del viejo y lleva al nuevo', () => {
    expect(ajustesTrasladoTelefono([traslado()], [{ producto: producto('p1'), cantidad: 5 }], 'Resguardo')).toEqual([
      { producto_id: 'p1', producto_nombre: 'Material p1', almacen: 'Los Pinos', delta: -5 },
      { producto_id: 'p1', producto_nombre: 'Material p1', almacen: 'Resguardo', delta: 5 },
    ]);
  });

  it('exige N° y almacenes distintos', () => {
    expect(validarEdicionTrasladoTelefono([traslado({ codigo: null })], [{ producto: producto('p1'), cantidad: 5 }], 'General', 'Los Pinos')).toContain('no tiene N°');
    expect(validarEdicionTrasladoTelefono([traslado()], [{ producto: producto('p1'), cantidad: 5 }], 'General', 'General')).toContain('distintos');
    expect(validarEdicionTrasladoTelefono([traslado()], [{ producto: producto('p1'), cantidad: 5 }], 'General', 'Resguardo')).toBeNull();
  });
});
