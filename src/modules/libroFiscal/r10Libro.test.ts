import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/supabase', () => ({ supabase: { from: () => { throw new Error('sin base en esta prueba'); }, rpc: () => { throw new Error('sin base en esta prueba'); } } }));

import { filasNoAplica, lineaRetenerDespues, precargaDeFactura } from './registroSuelto';
import { pLineaDe } from './retencionFacturas.repository';
import { filaGtDeNueva, type NuevaRetencion } from './retencionesFiscal.repository';
import type { FacturaResumen, NoAplicaRegistrado } from './facturasResumen.repository';

// Datos inventados.
const nueva = (over: Partial<NuevaRetencion> = {}): NuevaRetencion => ({
  tipo: 'iva', direccion: 'practicada', docKind: 'manual', docId: null,
  contraparteId: 'p-1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor de prueba', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-1', facturaFecha: '2026-10-15', fechaRetencion: '2026-10-20',
  periodo: '202610', quincena: 2, numeroComprobante: null, conceptoId: null, conceptoNombre: null,
  municipio: 'Caroní', moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: 16, impuesto: 160,
  porcentaje: 75, sustraendo: 0, montoRetenido: 120, observacion: '  Retención al 75 %  ', actor: 'u-1', actorName: 'Ana', regla: null, ...over,
});

const factura = (over: Partial<FacturaResumen> = {}): FacturaResumen => ({
  documentoId: 'd-1', direccion: 'practicada', tipoDocumento: 'factura', facturaNro: '000123', facturaControl: '00-1',
  facturaFecha: '2026-10-15', facturaTotal: 1160, ivaMonto: 160, moneda: 'Bs', tasa: null, proveedorId: 'p-1',
  rif: 'J000000010', razonSocial: 'Proveedor de prueba', docKind: 'oc', docId: 'oc-1', createdAt: '2026-10-15T12:00:00Z',
  retenido: {}, decisiones: {}, pendientes: ['ISLR', 'MUNICIPAL'], retenible: true, ...over,
});

describe('registro suelto: retener después sobre una factura registrada (R10)', () => {
  it('la línea lleva los mismos valores que el registro de siempre', () => {
    const l = lineaRetenerDespues(nueva());
    expect(l).toMatchObject({
      tipo: 'iva', base: 1000, porcentaje: 75, monto: 120, sustraendo: 0, ivaAlicuota: 16, ivaMonto: 160,
      moneda: 'Bs', tasa: null, baseBs: 1000, montoBs: 120, municipio: null, descripcion: 'Retención al 75 %',
      comprobanteNro: null, quincena: 2, fecha: '2026-10-20', regla: null,
    });
    // Mismo contrato que la fila del insert de hoy.
    const fila = filaGtDeNueva(nueva(), { entero: null, texto: null });
    const p = pLineaDe(l);
    for (const k of ['tipo', 'base', 'porcentaje', 'monto', 'sustraendo', 'iva_alicuota', 'iva_monto', 'moneda', 'tasa', 'base_bs', 'monto_bs', 'municipio', 'descripcion', 'quincena', 'fecha', 'concepto_codigo', 'concepto']) {
      expect(p[k], k).toEqual(fila[k]);
    }
  });

  it('la fecha es la de la retención, no la de la factura (sin fecha de retención, la de la factura)', () => {
    expect(lineaRetenerDespues(nueva({ fechaRetencion: '2026-10-21' })).fecha).toBe('2026-10-21');
    expect(lineaRetenerDespues(nueva({ fechaRetencion: null })).fecha).toBe('2026-10-15');
  });

  it('el municipio va solo en el ISAE; el IVA de la factura solo en el IVA', () => {
    const isae = lineaRetenerDespues(nueva({ tipo: 'municipal', conceptoId: 'municipal:todos', conceptoNombre: 'ISAE · Caroní', porcentaje: 2, montoRetenido: 20, quincena: null }));
    expect(isae).toMatchObject({ municipio: 'Caroní', ivaAlicuota: null, ivaMonto: null, conceptoCodigo: null, conceptoNombre: 'ISAE · Caroní', quincena: null });
    expect(lineaRetenerDespues(nueva({ tipo: 'islr' })).municipio).toBeNull();
  });

  it('ISLR: el código del concepto sale del id «código:sujeto»; en $ lleva tasa y equivalentes en Bs', () => {
    const l = lineaRetenerDespues(nueva({ tipo: 'islr', conceptoId: '011:PJD', conceptoNombre: 'Honorarios', moneda: 'USD', tasa: 40, baseImponible: 100, porcentaje: 5, montoRetenido: 5, sustraendo: 0 }));
    expect(l).toMatchObject({ conceptoCodigo: '011', conceptoNombre: 'Honorarios', moneda: 'USD', tasa: 40, baseBs: 4000, montoBs: 200 });
  });

  it('la regla (R7) viaja con la línea si la hay', () => {
    const regla = { regla_id: 'r-1', foto: { pasos: [] } };
    const l = lineaRetenerDespues(nueva({ regla }));
    expect(l.regla).toEqual(regla);
    expect(pLineaDe(l)).toMatchObject({ regla_id: 'r-1', foto: { pasos: [] } });
  });

  it('el N° del comprobante solo en una recibida (la practicada la numera la base)', () => {
    expect(lineaRetenerDespues(nueva({ direccion: 'recibida', numeroComprobante: ' 20261000000012 ' })).comprobanteNro).toBe('20261000000012');
    expect(lineaRetenerDespues(nueva({ numeroComprobante: '20261000000012' })).comprobanteNro).toBeNull();
  });

  it('precarga: los datos de la factura y el primer impuesto pendiente; solo se ofrecen los pendientes', () => {
    const p = precargaDeFactura(factura());
    expect(p).toMatchObject({
      direccion: 'practicada', proveedorId: 'p-1', contraparte: 'Proveedor de prueba', rif: 'J000000010',
      facturaNumero: '000123', facturaControl: '00-1', facturaFecha: '2026-10-15', moneda: 'Bs', tasaStr: '',
      tipo: 'islr', impuestos: ['islr', 'municipal'],
    });
    const usd = precargaDeFactura(factura({ moneda: 'USD', tasa: 179.437, facturaFecha: '2026-10-15T00:00:00', pendientes: ['ESTADAL'] }));
    expect(usd).toMatchObject({ moneda: 'USD', tasaStr: '179,437', facturaFecha: '2026-10-15', tipo: 'regional', impuestos: ['regional'] });
    expect(precargaDeFactura(factura({ pendientes: [] })).tipo).toBeNull();
  });
});

describe('Libro › «Sin retención»: las decisiones «no aplica» (R10)', () => {
  const dec = (over: Partial<NoAplicaRegistrado> = {}): NoAplicaRegistrado => ({
    id: 'x-1', documentoId: 'd-1', impuestoClave: 'MUNICIPAL', motivo: 'El proveedor no tiene actividad en el municipio', detalle: 'Presta el servicio en Caracas',
    quien: 'ana@ejemplo.com', cuando: '2026-10-20T18:30:00Z', facturaNro: '000123', facturaFecha: '2026-10-15',
    razonSocial: 'Proveedor de prueba', rif: 'J000000010', docKind: 'oc', docId: 'oc-1', ...over,
  });

  it('cada decisión con el impuesto en palabras, la factura, el proveedor, el motivo, quién y cuándo', () => {
    const [f] = filasNoAplica([dec()]);
    expect(f).toEqual({
      id: 'x-1', impuesto: 'ISAE (municipal)', facturaNro: '000123', facturaFecha: '2026-10-15', proveedor: 'Proveedor de prueba', rif: 'J000000010',
      motivo: 'El proveedor no tiene actividad en el municipio', detalle: 'Presta el servicio en Caracas', quien: 'ana@ejemplo.com', cuando: '2026-10-20T18:30:00Z',
    });
    expect(f.impuesto).not.toMatch(/_/);
  });

  it('sin datos: «Sin número», «Sin proveedor» y la carga inicial como «Sistema»', () => {
    const [f] = filasNoAplica([dec({ facturaNro: null, facturaFecha: null, razonSocial: null, quien: 'postgres' })]);
    expect(f).toMatchObject({ facturaNro: 'Sin número', facturaFecha: null, proveedor: 'Sin proveedor', quien: 'Sistema (carga inicial)' });
    expect(filasNoAplica([dec({ quien: null })])[0].quien).toBe('—');
  });

  it('respeta los filtros del Libro: impuesto, búsqueda, y nada con «Recibida» o con un estado elegido', () => {
    const xs = [dec(), dec({ id: 'x-2', impuestoClave: 'ESTADAL', facturaNro: '000999', razonSocial: 'Otro proveedor', rif: 'J000000029' })];
    expect(filasNoAplica(xs, { tipo: 'regional' }).map((f) => f.id)).toEqual(['x-2']);
    expect(filasNoAplica(xs, { tipo: 'municipal' }).map((f) => f.id)).toEqual(['x-1']);
    expect(filasNoAplica(xs, { texto: 'otro' }).map((f) => f.id)).toEqual(['x-2']);
    expect(filasNoAplica(xs, { texto: '000123' }).map((f) => f.id)).toEqual(['x-1']);
    expect(filasNoAplica(xs, { direccion: 'practicada' })).toHaveLength(2);
    expect(filasNoAplica(xs, { direccion: 'recibida' })).toEqual([]);
    expect(filasNoAplica(xs, { estado: 'declarada' })).toEqual([]);
  });
});
