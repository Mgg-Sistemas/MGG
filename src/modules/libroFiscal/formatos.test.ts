import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();
let conR8 = true;

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
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => conR8 }));

import { aplicarFormato, columnasFabrica, faltaEnFormato, textosFabrica } from './formatoComprobante';
import { corregirFormato, filaContenido, formatoParaImprimir, nuevaVersionFormato, volverAFabrica } from './formatos.repository';
import { valoresDeColumnas } from './comprobanteRetencionPdf';
import { retencionDeMuestra } from './formatoMuestra';

beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); conR8 = true; });

const contenido = { orientacion: 'vertical' as const, textos: { encabezado: 'TÍTULO PROPIO', nota_legal: '', pie: '' }, rotulos: { total: 'TOTAL' }, columnas: [] };

describe('formato del comprobante (R8): lo que no trae la versión es de fábrica', () => {
  it('sin versión, o «de fábrica», el diseño de siempre (horizontal, columnas del impuesto)', () => {
    const f = aplicarFormato('iva', null);
    expect(f.orientacion).toBe('horizontal');
    expect(f.textos).toEqual(textosFabrica('iva'));
    expect(f.columnas.map((c) => c.campo)).toEqual(columnasFabrica('iva').map((c) => c.campo));
    expect(aplicarFormato('islr', { deFabrica: true, textos: { encabezado: 'x' } }).textos.encabezado).toBe(textosFabrica('islr').encabezado);
  });

  it('textos y rótulos propios; vacío = de fábrica', () => {
    const f = aplicarFormato('iva', { orientacion: 'vertical', textos: { encabezado: 'MI TÍTULO' }, rotulos: { total: 'TOTAL', periodo: '  ' } });
    expect(f.orientacion).toBe('vertical');
    expect(f.textos.encabezado).toBe('MI TÍTULO');
    expect(f.textos.pie).toBe(textosFabrica('iva').pie);
    expect(f.rotulos.total).toBe('TOTAL');
    expect(f.rotulos.periodo).toBe('PERIODO FISCAL');
  });

  it('columnas: rótulo, ocultar, orden y ancho; una columna que no es del impuesto se ignora', () => {
    const f = aplicarFormato('islr', { columnas: [
      { campo: 'concepto', visible: false },
      { campo: 'monto', rotulo: 'RETENIDO', orden: 0, ancho: 90 },
      { campo: 'alicuota', visible: true },
    ] });
    expect(f.columnas.map((c) => c.campo)).toEqual(['monto', 'factura', 'fecha', 'control', 'base', 'sustraendo', 'pct']);
    expect(f.columnas[0]).toMatchObject({ rotulo: 'RETENIDO', ancho: 90 });
  });

  it('la tabla del PDF tiene un valor para cada columna posible', () => {
    const v = valoresDeColumnas(retencionDeMuestra('islr', '2026-10-21'));
    for (const c of [...columnasFabrica('iva'), ...columnasFabrica('islr')]) expect(v[c.campo]).toBeDefined();
  });

  it('antes de guardar: fecha entre 2000 y 2100, motivo, al menos una columna visible con rótulo, ancho > 0', () => {
    const cols = columnasFabrica('iva');
    expect(faltaEnFormato({ desde: '2026-10-21', motivo: 'm', columnas: cols })).toBeNull();
    expect(faltaEnFormato({ desde: '1999-12-31', motivo: 'm', columnas: cols })).toMatch(/2000 y 2100/);
    expect(faltaEnFormato({ desde: '2026-10-21', motivo: ' ', columnas: cols })).toMatch(/motivo/);
    expect(faltaEnFormato({ desde: '2026-10-21', motivo: 'm', columnas: cols.map((c) => ({ ...c, visible: false })) })).toMatch(/al menos una columna/);
    expect(faltaEnFormato({ desde: '2026-10-21', motivo: 'm', columnas: [{ ...cols[0], rotulo: ' ' }] })).toMatch(/necesita un rótulo/);
    expect(faltaEnFormato({ desde: '2026-10-21', motivo: 'm', columnas: [{ ...cols[0], ancho: 0 }] })).toMatch(/ancho/);
  });
});

describe('formatos en la base (R8)', () => {
  it('el contenido va sin vacíos: textos y rótulos como objeto o null, columnas como lista o null', () => {
    const f = filaContenido(contenido);
    expect(f.textos).toEqual({ encabezado: 'TÍTULO PROPIO' });
    expect(f.rotulos).toEqual({ total: 'TOTAL' });
    expect(f.columnas).toBeNull();
  });

  it('versión nueva: INSERT con impuesto en mayúsculas, documento, desde y motivo; exige fila', async () => {
    cola.push({ data: [{ id: 'f-2' }], error: null });
    expect(await nuevaVersionFormato('IVA', 'comprobante', '2026-11-01', 'Cambio de providencia', contenido)).toBe('f-2');
    expect(llamadas[0].tabla).toBe('retencion_formatos');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ impuesto_clave: 'IVA', documento: 'comprobante', desde: '2026-11-01', motivo: 'Cambio de providencia', orientacion: 'vertical' });
    cola.push({ data: [], error: null });
    await expect(nuevaVersionFormato('IVA', 'comprobante', '2026-11-01', 'm', contenido)).rejects.toThrow('sin permiso');
  });

  it('una fecha que no va después de la vigente: el texto de la base, con la fecha', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_FORMATO_DESDE: la versión nueva del formato tiene que empezar después del 01/10/2026. Para corregir la vigente, edítela.' } });
    await expect(nuevaVersionFormato('IVA', 'comprobante', '2026-09-01', 'm', contenido)).rejects.toThrow('después del 01/10/2026');
  });

  it('corregir = UPDATE de la vigente con motivo (nunca borra); volver a fábrica = INSERT de_fabrica', async () => {
    cola.push({ data: [{ id: 'f-1' }], error: null });
    await corregirFormato('f-1', '2026-10-01', 'Error de tipeo', contenido);
    expect(llamadas[0].metodos.map((m) => m[0])).toEqual(['update', 'eq', 'select']);
    cola.push({ data: [{ id: 'f-3' }], error: null });
    await volverAFabrica('ISLR', 'comprobante', '2026-12-01', 'Se vuelve al oficial');
    expect(llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ impuesto_clave: 'ISLR', de_fabrica: true });
  });

  it('para imprimir: la vigente a la fecha del comprobante; si no hay, la de hoy; sin R8 o con error, de fábrica', async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    rpc.mockResolvedValueOnce({ data: [{ id: 'f-hoy', documento: 'comprobante', desde: '2026-10-21', orientacion: 'vertical', motivo: 'm' }], error: null });
    const f = await formatoParaImprimir('IVA', '2026-01-15', '2026-10-21');
    expect(f?.id).toBe('f-hoy');
    expect(rpc.mock.calls[0]).toEqual(['retencion_formato_vigente', { p_impuesto: 'IVA', p_documento: 'comprobante', p_fecha: '2026-01-15' }]);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'falla' } });
    expect(await formatoParaImprimir('IVA', '2026-10-21', '2026-10-21')).toBeNull();
    conR8 = false;
    expect(await formatoParaImprimir('IVA', '2026-10-21', '2026-10-21')).toBeNull();
  });
});
