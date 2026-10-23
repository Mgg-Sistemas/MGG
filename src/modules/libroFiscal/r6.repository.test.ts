import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();
let hayR6 = true;

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadas.push(reg);
  const resp = cola.shift() ?? { data: [], error: null };
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => hayR6, r2Disponible: async () => false }));

import {
  activarSupuesto, aSupuesto, faltaEnMotivo, faltaEnSupuesto, guardarMotivo, guardarSupuesto, supuestoAplicado,
  supuestosVigentes, vigenteEn,
} from './motivosSupuestos.repository';
import { calcularRetencionIva, CONFIG_RETENCION_DEFECTO } from './retencionesCalculo';

// Datos inventados.
beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); hayR6 = true; });

describe('supuestos: piezas puras', () => {
  const sup = [
    { codigo: 'a', pct: 100, texto: 'Supuesto A' },
    { codigo: 'b', pct: 50, texto: 'Supuesto B' },
  ];

  it('manda el % mayor de los marcados; el texto queda con todos', () => {
    expect(supuestoAplicado({ b: true }, sup)).toEqual({ pct: 50, texto: 'Supuesto B' });
    expect(supuestoAplicado({ a: true, b: true }, sup)).toEqual({ pct: 100, texto: 'Supuesto A; Supuesto B' });
    expect(supuestoAplicado({}, sup)).toBeNull();
  });

  it('vigencia: activo y entre desde y hasta', () => {
    expect(vigenteEn({ activo: true, desde: '2020-01-01', hasta: null }, '2026-10-16')).toBe(true);
    expect(vigenteEn({ activo: true, desde: '2020-01-01', hasta: '2026-10-15' }, '2026-10-16')).toBe(false);
    expect(vigenteEn({ activo: false, desde: '2020-01-01', hasta: null }, '2026-10-16')).toBe(false);
  });

  it('reglas: texto, código, %, fechas y motivo del cambio', () => {
    const s = { impuestoClave: 'IVA', codigo: 'x1', texto: 'Supuesto', pct: 100, desde: '2026-10-16' };
    expect(faltaEnSupuesto({ ...s, pct: 101 }, 'x')).toMatch(/0 a 100/);
    expect(faltaEnSupuesto({ ...s, codigo: 'con espacio' }, 'x')).toMatch(/sin espacios/);
    expect(faltaEnSupuesto({ ...s, hasta: '2026-10-01' }, 'x')).toMatch(/anterior/);
    expect(faltaEnSupuesto(s, ' ')).toMatch(/motivo/);
    expect(faltaEnMotivo({ texto: 'ab', desde: '2026-10-16' }, 'x')).toMatch(/3 letras/);
  });

  it('el IVA con un supuesto de la base usa su % y su texto; sin supuesto, igual que antes', () => {
    const base = { baseImponible: 1000, ivaFactura: 160 };
    const con = calcularRetencionIva({ ...base, supuesto: { pct: 50, texto: 'Supuesto B' } }, CONFIG_RETENCION_DEFECTO);
    expect(con.porcentaje).toBe(50);
    expect(con.montoRetenido).toBe(80);
    expect(con.explicacion).toMatch(/supuesto b/);
    expect(calcularRetencionIva(base, CONFIG_RETENCION_DEFECTO).porcentaje).toBe(75);
    expect(calcularRetencionIva({ ...base, motivos: { ivaNoDiscriminado: true } }, CONFIG_RETENCION_DEFECTO).porcentaje).toBe(100);
  });
});

describe('supuestos y motivos: base', () => {
  it('vigentes por fecha con la función de la base; sin R6, null (casillas fijas)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: 's-1', impuesto_clave: 'IVA', codigo: 'a', texto: 'Supuesto A', pct: 100, desde: '2020-01-01', activo: true }], error: null });
    const xs = await supuestosVigentes('IVA', '2026-10-16');
    expect(rpc).toHaveBeenCalledWith('retencion_supuestos_vigentes', { p_impuesto: 'IVA', p_fecha: '2026-10-16' });
    expect(xs?.[0]).toMatchObject({ codigo: 'a', pct: 100 });
    hayR6 = false;
    expect(await supuestosVigentes('IVA', '2026-10-16')).toBeNull();
  });

  it('alta con insert y cambio con update; la nota es el motivo; exige filas', async () => {
    cola.push({ data: [{ id: 'm-1' }], error: null });
    await guardarMotivo({ impuestoClave: null, texto: ' No supera el mínimo ', requiereTexto: false, orden: 1, desde: '2026-10-16' }, 'Alta del motivo');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ impuesto_clave: null, texto: 'No supera el mínimo', nota: 'Alta del motivo' });
    cola.push({ data: [{ id: 's-1' }], error: null });
    await guardarSupuesto({ impuestoClave: 'IVA', codigo: 'aa', texto: 'Supuesto A', pct: 100, orden: 1, desde: '2026-10-16' }, 'Corrige texto', 's-1');
    expect(llamadas[1].metodos.find((m) => m[0] === 'update')?.[1]).toMatchObject({ texto: 'Supuesto A', nota: 'Corrige texto' });
    expect(llamadas[1].metodos).toContainEqual(['eq', 'id', 's-1']);
    cola.push({ data: [], error: null });
    await expect(activarSupuesto('s-1', false, 'Ya no aplica')).rejects.toThrow('sin permiso');
  });

  it('texto repetido o código repetido: mensaje propio', async () => {
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(guardarSupuesto({ impuestoClave: 'IVA', codigo: 'aa', texto: 'Supuesto A', pct: 100, orden: 1, desde: '2026-10-16' }, 'x')).rejects.toThrow('ya tiene un supuesto con ese código');
  });

  it('mapea la fila', () => {
    expect(aSupuesto({ id: 's', impuesto_clave: 'IVA', codigo: 'a', texto: 't', pct: '100', desde: '2020-01-01' })).toMatchObject({ pct: 100, activo: true, hasta: null });
  });
});
