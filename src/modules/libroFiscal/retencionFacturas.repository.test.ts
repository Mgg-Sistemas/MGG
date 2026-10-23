import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: la RPC y un from() encadenable que devuelven lo que se les ponga. */
const rpc = vi.fn();
const colaFrom: Array<{ data: unknown; error: unknown }> = [];
const llamadasFrom: { tabla: string; metodos: unknown[][] }[] = [];

function consulta(tabla: string, resp: { data: unknown; error: unknown }) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadasFrom.push(reg);
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

// Sin R3 (valores del JSON) y con V2R (la base numera): las pruebas de v2rV3r cubren el camino sin V2R.
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => false, r2Disponible: async () => false, v2rDisponible: async () => true }));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (tabla: string) => consulta(tabla, colaFrom.shift() ?? { data: [], error: null }),
  },
}));

import {
  aFacturaCabecera, actualizarFactura, listFacturas, pFacturaDe, pLineaDe, registrarFactura,
  type FacturaNueva, type LineaFacturaNueva,
} from './retencionFacturas.repository';

const factura = (over: Partial<FacturaNueva> = {}): FacturaNueva => ({
  direccion: 'practicada', docKind: 'oc', docId: 'oc-1',
  contraparteId: 'prov-1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor de prueba', contraparteSujeto: 'pj_domiciliada',
  facturaNro: '000123', facturaFecha: '2026-10-05', facturaTotal: 1160, moneda: 'Bs', periodo: '202610',
  actor: 'prueba@ejemplo.com', ...over,
});
const linea = (over: Partial<LineaFacturaNueva> = {}): LineaFacturaNueva => ({
  tipo: 'iva', base: 1000, porcentaje: 75, monto: 120, ivaAlicuota: 16, ivaMonto: 160, ...over,
});

beforeEach(() => { rpc.mockReset(); colaFrom.length = 0; llamadasFrom.length = 0; });

describe('traducción al contrato de la función (columnas de GT)', () => {
  it('la cabecera: rol, impuesto por líneas, doc y proveedor', () => {
    const p = pFacturaDe(factura());
    expect(p.rol).toBe('practicada');
    expect(p.proveedor_id).toBe('prov-1');
    expect(p.doc_kind).toBe('oc');
    expect(p.doc_id).toBe('oc-1');
    expect(p.factura_nro).toBe('000123');
    expect(p.sujeto).toBe('PJD');
  });

  it('una recibida no lleva proveedor_id (la contraparte es un cliente); guarda RIF y nombre', () => {
    const p = pFacturaDe(factura({ direccion: 'recibida', contraparteId: 'cli-1' }));
    expect(p.rol).toBe('sufrida');
    expect(p.proveedor_id).toBeNull();
    expect(p.razon_social).toBe('Proveedor de prueba');
  });

  it('una factura va como factura y sin documento afectado, aunque se lo pasen', () => {
    const p = pFacturaDe(factura({ documentoAfectadoId: 'f-0', facturaAfectadaNro: '000100' }));
    expect(p.tipo_documento).toBe('factura');
    expect(p.documento_afectado_id).toBeNull();
    expect(p.factura_afectada_nro).toBeNull();
  });

  it('una nota de crédito lleva la factura que ajusta; los montos siguen en positivo', () => {
    const p = pFacturaDe(factura({ tipoDocumento: 'nota_credito', documentoAfectadoId: 'f-0', facturaAfectadaNro: ' 000100 ' }));
    expect(p.tipo_documento).toBe('nota_credito');
    expect(p.documento_afectado_id).toBe('f-0');
    expect(p.factura_afectada_nro).toBe('000100');
    expect(pLineaDe(linea()).monto).toBe(120);
  });

  it('manual no lleva doc_id', () => {
    expect(pFacturaDe(factura({ docKind: 'manual', docId: 'x' })).doc_id).toBeNull();
  });

  it('R7F: cada línea manda regla_id y foto solo si se calculó con una regla', () => {
    const foto = { pasos: [{ paso: 1 }], monto: 120 };
    const p = pLineaDe(linea({ regla: { regla_id: 'regla-v2', foto } }));
    expect(p.regla_id).toBe('regla-v2');
    expect(p.foto).toEqual(foto);
    const sin = pLineaDe(linea());
    expect('regla_id' in sin).toBe(false);
    expect('foto' in sin).toBe(false);
  });

  it('la fecha de la línea es la de la retención; el período sale de la factura', () => {
    expect(pLineaDe(linea({ fecha: '2026-10-08' })).fecha).toBe('2026-10-08');
    expect(pFacturaDe(factura()).periodo).toBe('202610');
  });

  it('P03: adjunto_id va en p_factura solo si viene', () => {
    expect(pFacturaDe(factura({ adjuntoId: 'adj-1' })).adjunto_id).toBe('adj-1');
    expect('adjunto_id' in pFacturaDe(factura())).toBe(false);
    expect('adjunto_id' in pFacturaDe(factura({ docKind: 'manual', adjuntoId: 'adj-1' }))).toBe(false);
  });

  it('las líneas: el impuesto en MAYÚSCULAS y el estadal como ESTADAL', () => {
    expect(pLineaDe(linea()).tipo).toBe('IVA');
    expect(pLineaDe(linea({ tipo: 'regional' })).tipo).toBe('ESTADAL');
    expect(pLineaDe(linea({ tipo: 'islr', conceptoNombre: 'Honorarios' })).concepto).toBe('Honorarios');
  });
});

describe('registro atómico', () => {
  it('manda p_factura y p_lineas a la función y mapea lo devuelto (número asignado por V2)', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        factura: { id: 'f-1', rol: 'practicada', tipo: 'IVA', moneda: 'Bs', factura_nro: '000123', orden_id: 'oc-1' },
        lineas: [
          { id: 'r-1', rol: 'practicada', tipo: 'IVA', estado: 'registrada', comprobante_nro: '20261000000007', numero: 7, monto: 120 },
          { id: 'r-2', rol: 'practicada', tipo: 'ISAE', estado: 'registrada', comprobante_nro: '00000031', monto: 25 },
        ],
      },
      error: null,
    });
    const res = await registrarFactura(factura(), [linea(), linea({ tipo: 'municipal', base: 1000, porcentaje: 2.5, monto: 25 })]);
    expect(rpc).toHaveBeenCalledWith('retencion_factura_registrar', expect.objectContaining({ p_factura: expect.any(Object), p_lineas: expect.any(Array) }));
    const arg = rpc.mock.calls[0][1] as { p_lineas: Record<string, unknown>[] };
    expect(arg.p_lineas).toHaveLength(2);
    expect(res.factura.id).toBe('f-1');
    expect(res.lineas.map((l) => l.numeroComprobante)).toEqual(['20261000000007', '00000031']);
    expect(res.lineas[0].tipo).toBe('iva');
  });

  it('cada línea lleva la UT con la que se calculó (VU); sin UT cargada no se manda', async () => {
    rpc.mockResolvedValue({ data: { factura: { id: 'f-1' }, lineas: [] }, error: null });
    await registrarFactura(factura({ valorUt: 43 }), [linea(), linea({ tipo: 'islr' })]);
    const conUt = rpc.mock.calls[0][1] as { p_lineas: Record<string, unknown>[] };
    expect(conUt.p_lineas.map((l) => l.valor_ut)).toEqual([43, 43]);
    await registrarFactura(factura({ valorUt: 0 }), [linea()]);
    expect((rpc.mock.calls[1][1] as { p_lineas: Record<string, unknown>[] }).p_lineas[0].valor_ut).toBeNull();
  });

  it('sin líneas no llama a la base', async () => {
    await expect(registrarFactura(factura(), [])).rejects.toThrow('al menos una línea');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('el 0% sin motivo lo rechaza la función, y el texto llega a la pantalla (RET_CERO_SIN_MOTIVO)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'RET_CERO_SIN_MOTIVO: una retención en 0 debe llevar el motivo.' } });
    await expect(registrarFactura(factura(), [linea({ monto: 0 })])).rejects.toThrow('motivo');
  });

  it('sin permiso (42501) y régimen (23514) dan mensajes claros', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(registrarFactura(factura(), [linea()])).rejects.toThrow('permiso');
    // El régimen lo dice el trigger de la base (retencion_agente_valido), ya redactado.
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'La empresa no puede percibir IGTF: no está designada contribuyente especial.' } });
    await expect(registrarFactura(factura(), [linea({ tipo: 'igtf' })])).rejects.toThrow('contribuyente especial');
  });
});

describe('lectura cabecera + líneas', () => {
  it('pide retencion_documentos anidando sus retenciones y mapea cada documento con sus líneas', async () => {
    colaFrom.push({ data: [
      { id: 'f-1', rol: 'practicada', factura_nro: '000123', orden_id: 'oc-1', retenciones: [
        { id: 'r-1', rol: 'practicada', tipo: 'IVA', estado: 'registrada', monto: 120 },
      ] },
    ], error: null });
    const res = await listFacturas({ direccion: 'practicada' });
    expect(llamadasFrom[0].tabla).toBe('retencion_documentos');
    expect(llamadasFrom[0].metodos).toContainEqual(['select', '*, retenciones(*)']);
    expect(llamadasFrom[0].metodos).toContainEqual(['eq', 'rol', 'practicada']);
    expect(res).toHaveLength(1);
    expect(res[0].factura.facturaNro).toBe('000123');
    expect(res[0].lineas[0].tipo).toBe('iva');
  });

  it('el período se filtra en las líneas (la cabecera no tiene columna periodo) y la cabecera lo toma de ellas', async () => {
    colaFrom.push({ data: [
      { id: 'f-1', rol: 'practicada', factura_nro: '000123', retenciones: [
        { id: 'r-1', rol: 'practicada', tipo: 'IVA', estado: 'registrada', comprobante_periodo: '202610', monto: 120 },
      ] },
    ], error: null });
    const res = await listFacturas({ periodo: '202610' });
    const m = llamadasFrom[0].metodos;
    expect(m).toContainEqual(['select', '*, retenciones!inner(*)']);
    expect(m).toContainEqual(['eq', 'retenciones.comprobante_periodo', '202610']);
    expect(m.some((x) => x[0] === 'eq' && x[1] === 'periodo')).toBe(false);
    expect(res[0].factura.periodo).toBe('202610');
  });

  it('aFacturaCabecera deduce el documento de origen y la dirección', () => {
    const c = aFacturaCabecera({ id: 'f-9', rol: 'sufrida', compra_directa_id: 'cd-1', factura_nro: 'A-1' });
    expect(c.direccion).toBe('recibida');
    expect(c.docKind).toBe('compra_directa');
    expect(c.docId).toBe('cd-1');
    expect(c.tipoDocumento).toBe('factura');
    const nc = aFacturaCabecera({ id: 'f-10', rol: 'practicada', tipo_documento: 'nota_credito', documento_afectado_id: 'f-9', factura_afectada_nro: 'A-1' });
    expect(nc).toMatchObject({ tipoDocumento: 'nota_credito', documentoAfectadoId: 'f-9', facturaAfectadaNro: 'A-1' });
  });
});

describe('editar una factura', () => {
  it('traduce los cambios a columnas de GT y avisa si no toca filas', async () => {
    colaFrom.push({ data: [{ id: 'f-1' }], error: null });
    await actualizarFactura('f-1', { nota: 'Corrección', facturaNro: '000999' });
    const upd = llamadasFrom[0].metodos.find((m) => m[0] === 'update')?.[1] as Record<string, unknown>;
    expect(upd).toMatchObject({ nota: 'Corrección', factura_nro: '000999' });
    colaFrom.push({ data: [], error: null });
    await expect(actualizarFactura('f-2', { nota: 'x' })).rejects.toThrow('No se guardó');
  });
});
