import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];

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

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: (t: string) => consulta(t), rpc: vi.fn() } }));

import { faltaEnDatosFactura, puedeOfrecerBorrar } from './facturaDocumento';
import { borrarFacturaLibre } from './retencionFacturas.repository';
import { errorRetencion } from './erroresRetencion';

beforeEach(() => { cola.length = 0; llamadas.length = 0; });

describe('datos fiscales de la factura (P03)', () => {
  const hoy = '2026-10-20';
  const ok = { nro: '000123', control: '00-000456', fecha: '2026-10-19' };

  it('número, control y fecha bien → nada que decir', () => {
    expect(faltaEnDatosFactura(ok, hoy)).toBeNull();
    expect(faltaEnDatosFactura({ ...ok, fecha: hoy }, hoy)).toBeNull();
  });

  it('pide número y control, de 1 a 30 caracteres y sin saltos de línea', () => {
    expect(faltaEnDatosFactura({ ...ok, nro: '  ' }, hoy)).toMatch(/número de la factura/);
    expect(faltaEnDatosFactura({ ...ok, nro: '1'.repeat(31) }, hoy)).toMatch(/30 caracteres/);
    expect(faltaEnDatosFactura({ ...ok, nro: '12\n3' }, hoy)).toMatch(/saltos de línea/);
    expect(faltaEnDatosFactura({ ...ok, control: '' }, hoy)).toMatch(/control/);
    expect(faltaEnDatosFactura({ ...ok, control: '9'.repeat(31) }, hoy)).toMatch(/30 caracteres/);
  });

  it('la fecha: válida, desde el 2000 y no futura', () => {
    expect(faltaEnDatosFactura({ ...ok, fecha: '' }, hoy)).toMatch(/fecha/);
    expect(faltaEnDatosFactura({ ...ok, fecha: '2026-02-30' }, hoy)).toMatch(/fecha/);
    expect(faltaEnDatosFactura({ ...ok, fecha: '1999-12-31' }, hoy)).toMatch(/2000/);
    expect(faltaEnDatosFactura({ ...ok, fecha: '2026-10-21' }, hoy)).toMatch(/futura/);
  });

  it('«Borrar» se ofrece solo sin líneas de retención', () => {
    expect(puedeOfrecerBorrar({ lineas: [] })).toBe(true);
    expect(puedeOfrecerBorrar({ lineas: [{}] })).toBe(false);
  });
});

describe('borrar una factura libre (P03)', () => {
  it('borra con .select(id) sobre retencion_documentos', async () => {
    cola.push({ data: [{ id: 'd-1' }], error: null });
    await borrarFacturaLibre('d-1');
    expect(llamadas[0].tabla).toBe('retencion_documentos');
    expect(llamadas[0].metodos.map((m) => m[0])).toEqual(['delete', 'eq', 'select']);
  });

  it('sin filas → sin permiso o ya no existe', async () => {
    cola.push({ data: [], error: null });
    await expect(borrarFacturaLibre('d-1')).rejects.toThrow('sin permiso');
  });

  it('con retenciones, decisiones o notas → el texto de la base, sin el código', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_DOCUMENTO_NO_LIBRE: esta factura tiene retenciones…' } });
    await expect(borrarFacturaLibre('d-1')).rejects.toThrow(/no se borra/);
  });
});

describe('errores de P03 en texto de pantalla', () => {
  it('los códigos RET_* nuevos', () => {
    for (const [codigo, texto] of [
      ['RET_ORIGEN_UNO', 'exactamente una'], ['RET_ADJUNTO_REGISTRADO', 'ya está registrado'], ['RET_ADJUNTO_CAMPO', 'si es factura'],
      ['RET_ADJUNTO_ORIGEN', 'de otra orden'], ['RET_DOCUMENTO_NO_LIBRE', 'no se borra'], ['RET_ADJUNTO_NO_FACTURA', 'no está marcado como factura'],
      ['RET_ADJUNTO_SIN_ORIGEN', 'fuera del sistema'], ['RET_ORIGEN_CON_DOCUMENTO', 'No se puede eliminar'],
    ]) {
      const e = errorRetencion({ code: 'P0001', message: `${codigo}: detalle` });
      expect(e.message).toContain(texto);
      expect(e.message).not.toContain('RET_');
    }
  });

  it('la misma factura dos veces → «ya está registrada», no «número usado»', () => {
    expect(errorRetencion({ code: '23505', message: 'duplicate key value violates unique constraint "retencion_documentos_unica_practicada"' }).message).toMatch(/ya está registrada/);
    expect(errorRetencion({ code: '23505', message: 'duplicate key value violates unique constraint "retencion_documentos_unica_recibida"' }).message).toMatch(/ya está registrada/);
    expect(errorRetencion({ code: '23505', message: 'duplicate key value violates unique constraint "retencion_documento_origenes_unico"' }).message).toMatch(/ya cubre/);
    expect(errorRetencion({ code: '23505', message: 'duplicate key' }).message).toMatch(/Ya existe un registro igual/);
  });

  it('forma de número, control y fecha (CHECK de la base)', () => {
    expect(errorRetencion({ code: '23514', message: 'new row violates check constraint "retencion_documentos_forma"' }).message).toMatch(/1 a 30 caracteres/);
  });
});
