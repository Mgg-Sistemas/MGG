import { beforeEach, describe, expect, it, vi } from 'vitest';

const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();

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
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => false, r2Disponible: async () => false, v2rDisponible: async () => true }));

import {
  aFacturaResumen, aNoAplica, buscarFacturasRetenibles, listNoAplica, pendientesComoTipos, registrarFacturaSola, retenerDespues, textoBusqueda,
} from './facturasResumen.repository';

// Datos inventados.
const fila = (over: Record<string, unknown> = {}) => ({
  documento_id: 'd-1', rol: 'practicada', tipo_documento: 'factura', factura_nro: '000123', factura_control: '00-1', factura_fecha: '2026-10-15',
  factura_total: '1160', iva_monto: '160', moneda: 'Bs', tasa: null, proveedor_id: 'p-1', rif: 'J000000010', razon_social: 'Proveedor de prueba',
  orden_id: 'oc-1', compra_directa_id: null, servicio_directo_id: null, created_at: '2026-10-15T12:00:00Z',
  retenido: { ISLR: { lineas: 1, monto: 20, monto_bs: 20, estados: ['registrada'] } }, decisiones: { IGTF: 'no_aplica' },
  pendientes: ['IVA', 'MUNICIPAL'], retenible: true, buscar: '000123 00-1 j000000010 proveedor de prueba', ...over,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); });

describe('facturas registradas (R10)', () => {
  it('mapea la fila: lo retenido por impuesto, las decisiones, lo pendiente y el origen', () => {
    const f = aFacturaResumen(fila());
    expect(f).toMatchObject({ documentoId: 'd-1', direccion: 'practicada', facturaTotal: 1160, docKind: 'oc', docId: 'oc-1', retenible: true });
    expect(f.retenido.ISLR).toEqual({ lineas: 1, monto: 20, montoBs: 20, estados: ['registrada'] });
    expect(pendientesComoTipos(f)).toEqual(['iva', 'municipal']);
  });

  it('el buscador: solo retenibles, por texto en minúsculas y por proveedor; el comodín se quita', async () => {
    cola.push({ data: [fila()], error: null });
    await buscarFacturasRetenibles('  J-0000 ', 'p-1');
    const m = llamadas[0].metodos;
    expect(llamadas[0].tabla).toBe('retencion_facturas_resumen');
    expect(m).toContainEqual(['eq', 'retenible', true]);
    expect(m).toContainEqual(['eq', 'proveedor_id', 'p-1']);
    expect(m).toContainEqual(['ilike', 'buscar', '%j-0000%']);
    expect(textoBusqueda('50%_x')).toBe('50x');
  });

  it('factura sola: solo_documento y sin líneas', async () => {
    rpc.mockResolvedValueOnce({ data: { factura: { id: 'd-9', rol: 'practicada', moneda: 'Bs' }, lineas: [] }, error: null });
    const r = await registrarFacturaSola({ direccion: 'practicada', docKind: 'manual', facturaNro: '1', actor: 'yo@ejemplo.com' });
    expect(r.factura.id).toBe('d-9');
    expect(rpc.mock.calls[0][0]).toBe('retencion_factura_registrar');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_factura: { solo_documento: true }, p_lineas: [] });
  });

  it('retener después: retencion_lineas_registrar sobre el documento, con las líneas como en el registro', async () => {
    rpc.mockResolvedValueOnce({ data: { factura: { id: 'd-1', rol: 'practicada', moneda: 'Bs' }, lineas: [{ id: 'r-1', rol: 'practicada', tipo: 'IVA', monto: 120 }] }, error: null });
    const r = await retenerDespues({ documentoId: 'd-1', facturaFecha: '2026-10-15', direccion: 'practicada' },
      [{ tipo: 'iva', base: 1000, porcentaje: 75, monto: 120, regla: { regla_id: 'rg-1', foto: { pasos: [] } } }], { actorName: 'Ana' });
    expect(rpc.mock.calls[0][0]).toBe('retencion_lineas_registrar');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_documento_id: 'd-1', p_actor_name: 'Ana', p_lineas: [{ tipo: 'IVA', monto: 120, regla_id: 'rg-1' }] });
    expect(r.lineas).toHaveLength(1);
  });

  it('retener después sin líneas no llama a la base; la factura que no existe, en español', async () => {
    await expect(retenerDespues({ documentoId: 'd-1', facturaFecha: '2026-10-15', direccion: 'practicada' }, [])).rejects.toThrow('al menos una línea');
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'RET_DOCUMENTO_NO_EXISTE: esa factura no está registrada (o no la puede ver).' } });
    await expect(retenerDespues({ documentoId: 'x', facturaFecha: '2026-10-15', direccion: 'practicada' }, [{ tipo: 'iva', base: 1, porcentaje: 75, monto: 1 }])).rejects.toThrow('no está registrada');
  });
});

describe('Libro › Sin retención: las decisiones «no aplica»', () => {
  it('motivo de la lista o escrito, detalle, quién, cuándo y la factura', () => {
    const n = aNoAplica({ id: 'x', documento_id: 'd-1', impuesto_clave: 'IGTF', motivo_texto: null, detalle: 'Pago en Bs',
      actualizado_por: 'ana@ejemplo.com', created_at: '2026-10-20T10:00:00Z',
      retencion_documentos: { factura_nro: '000123', factura_fecha: '2026-10-15', razon_social: 'Proveedor de prueba', orden_id: 'oc-1' },
      retencion_motivos_no_aplica: { texto: 'No es contribuyente especial' } });
    expect(n).toMatchObject({ impuestoClave: 'IGTF', motivo: 'No es contribuyente especial', detalle: 'Pago en Bs', quien: 'ana@ejemplo.com', facturaNro: '000123', docKind: 'oc' });
  });

  it('lee solo «no_aplica», en el rango de fechas', async () => {
    cola.push({ data: [], error: null });
    await listNoAplica({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(llamadas[0].metodos).toContainEqual(['eq', 'decision', 'no_aplica']);
    expect(llamadas[0].metodos).toContainEqual(['gte', 'created_at', '2026-10-01T00:00:00']);
  });
});
