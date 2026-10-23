import { beforeEach, describe, expect, it, vi } from 'vitest';

const orden: string[] = [];
const filas: { tabla: string; metodos: unknown[][] }[] = [];
let respuestaFila: { data: unknown; error: unknown } = { data: [{ id: 'a-1' }], error: null };
let conP03 = false;
const remove = vi.fn(async () => { orden.push('archivo'); return { data: null, error: null }; });
const upload = vi.fn(async (_path: string, _f: unknown, _o: unknown) => { orden.push('subida'); return { data: null, error: null }; });
const buckets: string[] = [];

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  filas.push(reg);
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => { orden.push(`fila:${tabla}`); return Promise.resolve(respuestaFila).then(ok, ko); };
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

vi.mock('@/shared/lib/supabase', () => ({
  supabase: { from: (t: string) => consulta(t), storage: { from: (b: string) => { buckets.push(b); return { remove, upload }; } } },
}));
vi.mock('@/modules/libroFiscal/disponibilidad', () => ({ p03Disponible: async () => conP03 }));

import {
  agregarAdjuntoDirecto, cuentaComoFactura, eliminarAdjuntoDirecto, rutaAdjunto, textoErrorAdjunto, type AdjuntoDirecto,
} from './adjuntosDirectos.repository';

// Datos inventados.
const adjunto: AdjuntoDirecto = { id: 'a-1', modulo: 'compra', ref_id: 'c-1', path: 'c-1/abc-factura.pdf', nombre: 'factura.pdf', content_type: 'application/pdf', created_at: '2026-10-20T00:00:00Z', created_by: null };
const pdf = () => new File(['x'], 'Factura Nº 12.pdf', { type: 'application/pdf' });
const insertado = () => filas.find((f) => f.tabla === 'adjuntos_directos')?.metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;

beforeEach(() => {
  orden.length = 0; filas.length = 0; buckets.length = 0; remove.mockClear(); upload.mockClear(); conP03 = false;
  respuestaFila = { data: [{ id: 'a-1' }], error: null };
});

describe('eliminar una factura de compra o servicio directo', () => {
  it('primero el registro, después el archivo', async () => {
    await eliminarAdjuntoDirecto(adjunto);
    expect(orden).toEqual(['fila:adjuntos_directos', 'archivo']);
    expect(remove).toHaveBeenCalledWith(['c-1/abc-factura.pdf']);
  });

  it('si la base no deja borrar el registro, el archivo queda', async () => {
    respuestaFila = { data: null, error: { code: 'P0001', message: 'RET_ADJUNTO_REGISTRADO: esta factura ya está registrada en Retenciones' } };
    await expect(eliminarAdjuntoDirecto(adjunto)).rejects.toThrow('ya está registrada en Retenciones');
    expect(remove).not.toHaveBeenCalled();
  });

  it('sin filas borradas (sin permiso o ya no existe), el archivo queda', async () => {
    respuestaFila = { data: [], error: null };
    await expect(eliminarAdjuntoDirecto(adjunto)).rejects.toThrow('sin permiso');
    expect(remove).not.toHaveBeenCalled();
  });

  it('si falla borrar el archivo, el registro ya no está y no se reporta error', async () => {
    remove.mockImplementationOnce(async () => { throw new Error('red'); });
    await expect(eliminarAdjuntoDirecto(adjunto)).resolves.toBeUndefined();
  });
});

describe('P03: facturas del proveedor en adjuntos_directos', () => {
  it('cuenta como factura: true, o null en compra y servicio; nunca un adjunto general de la OC', () => {
    expect(cuentaComoFactura({ modulo: 'compra', es_factura: null })).toBe(true);
    expect(cuentaComoFactura({ modulo: 'servicio', es_factura: undefined })).toBe(true);
    expect(cuentaComoFactura({ modulo: 'compra', es_factura: false })).toBe(false);
    expect(cuentaComoFactura({ modulo: 'orden_factura', es_factura: true })).toBe(true);
    expect(cuentaComoFactura({ modulo: 'orden', es_factura: null })).toBe(false);
  });

  it('la factura de una OC va bajo /facturas/ (la base lo exige); el resto, como hoy', () => {
    expect(rutaAdjunto('orden_factura', 'oc-1', 'Factura Nº 12.pdf', 'k1')).toBe('oc-1/facturas/k1-Factura_N_12.pdf');
    expect(rutaAdjunto('compra', 'c-1', 'f.pdf', 'k1')).toBe('c-1/k1-f.pdf');
  });

  it('orden_factura: bucket compras-oc, sin reemplazar, y es_factura siempre true', async () => {
    respuestaFila = { data: { id: 'n-1' }, error: null };
    await agregarAdjuntoDirecto('orden_factura', 'oc-1', pdf(), 'yo@ejemplo.com');
    expect(buckets[0]).toBe('compras-oc');
    expect(upload.mock.calls[0][0]).toMatch(/^oc-1\/facturas\//);
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false });
    expect(insertado()).toMatchObject({ modulo: 'orden_factura', ref_id: 'oc-1', es_factura: true });
  });

  it('sin P03, compra y servicio no mandan es_factura (la columna no existe)', async () => {
    respuestaFila = { data: { id: 'n-1' }, error: null };
    await agregarAdjuntoDirecto('compra', 'c-1', pdf(), null, true);
    expect('es_factura' in insertado()).toBe(false);
  });

  it('con P03, compra y servicio mandan lo que diga la pantalla; un adjunto general de la OC, nunca', async () => {
    conP03 = true;
    respuestaFila = { data: { id: 'n-1' }, error: null };
    await agregarAdjuntoDirecto('servicio', 's-1', pdf(), null, false);
    expect(insertado()).toMatchObject({ es_factura: false });
    filas.length = 0;
    await agregarAdjuntoDirecto('orden', 'oc-1', pdf(), null, true);
    expect('es_factura' in insertado()).toBe(false);
  });

  it('si el registro no queda, se borra el archivo subido', async () => {
    respuestaFila = { data: null, error: { code: '23514', message: 'violates check constraint "adjuntos_directos_es_factura"' } };
    await expect(agregarAdjuntoDirecto('compra', 'c-1', pdf())).rejects.toThrow('no son facturas');
    expect(orden).toEqual(['subida', 'fila:adjuntos_directos', 'archivo']);
  });

  it('textos de los rechazos de P03', () => {
    expect(textoErrorAdjunto({ message: 'RET_ADJUNTO_REGISTRADO: x' })).toMatch(/registrada en Retenciones/);
    expect(textoErrorAdjunto({ message: 'RET_ADJUNTO_CAMPO: x' })).toMatch(/si es factura/);
    expect(textoErrorAdjunto({ message: 'otra cosa' })).toBeNull();
  });
});
