import { describe, expect, it } from 'vitest';
import type { ConceptoRetencion, ConfigRetencion, RetencionPracticada } from '../datos/puerta';
import { datosComprobante, retencionesDelComprobante } from './datosComprobante';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `h${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-000123', facturaFecha: '2026-10-03', periodo: '202610', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-05T15:28:00', ...over,
}) as RetencionPracticada;
const config = { rif: 'J-11111111-1', razonSocial: 'Empresa de Ejemplo C.A.', direccionFiscal: 'Zona industrial (ejemplo)' } as ConfigRetencion;
const conceptos = [{ id: 'k1', codigo: '3.3.29', nombre: 'Actividad de ejemplo' }] as ConceptoRetencion[];

describe('los datos del comprobante impreso, desde las retenciones de hoy', () => {
  it('IVA: una fila por factura, con el número, la fecha de emisión (la del registro) y el período', () => {
    const d = datosComprobante([r({})], { config, direccionSujeto: 'Calle 1 (ejemplo)', conceptos });
    expect(d).toMatchObject({
      impuesto: 'iva', numero: '20261000000011', fecha: '2026-10-05', periodo: { anio: '2026', mes: '10' },
      agente: { razon: 'Empresa de Ejemplo C.A.', rif: 'J-11111111-1', direccion: 'Zona industrial (ejemplo)' },
      sujeto: { nombre: 'Proveedor Alfa', rif: 'J-00000001-0', direccion: 'Calle 1 (ejemplo)' },
    });
    expect(d.filas[0]).toMatchObject({ oper: '1', fecha: '2026-10-03', factura: '000123', control: '00-000123', clase: '01-reg', total: 1160, base: 1000, alic: 16, causado: 160, retenido: 120 });
  });

  it('ISLR: una fila por línea de concepto, con la descripción en mayúsculas, el % y el sustraendo', () => {
    const d = datosComprobante([r({ tipo: 'islr', numeroComprobante: null, conceptoNombre: 'Honorarios', porcentaje: 3, sustraendo: 107.5, montoRetenido: 1392.5, baseImponible: 50000 })], { config, direccionSujeto: '', conceptos });
    expect(d.impuesto).toBe('islr');
    expect(d.numero).toBe('');
    expect(d.filas[0]).toMatchObject({ documento: '000123', descripcion: 'HONORARIOS', pct: 3, sustraendo: 107.5, base: 50000, retenido: 1392.5 });
  });

  it('ISAE (municipal): el código de la actividad sale del catálogo y la alícuota del %', () => {
    const d = datosComprobante([r({ tipo: 'municipal', conceptoId: 'k1', porcentaje: 2.5, montoRetenido: 25 })], { config, direccionSujeto: '', conceptos });
    expect(d.impuesto).toBe('isae');
    expect(d.filas[0]).toMatchObject({ actividad: '3.3.29', alicIsae: 2.5, base: 1000, retenido: 25 });
  });

  it('las retenciones de un comprobante: con número, las de ese número; sin número, las líneas vivas de la misma factura e impuesto', () => {
    const a = r({ numeroComprobante: '20261000000011' });
    const b = r({ numeroComprobante: '20261000000012' });
    expect(retencionesDelComprobante(a, [a, b]).map((x) => x.id)).toEqual([a.id]);
    const l1 = r({ tipo: 'islr', numeroComprobante: null, docId: 'oc-5' });
    const l2 = r({ tipo: 'islr', numeroComprobante: null, docId: 'oc-5' });
    const anulada = r({ tipo: 'islr', numeroComprobante: null, docId: 'oc-5', anulada: true });
    const otra = r({ tipo: 'municipal', numeroComprobante: null, docId: 'oc-5' });
    expect(retencionesDelComprobante(l1, [l1, l2, anulada, otra]).map((x) => x.id)).toEqual([l1.id, l2.id]);
  });
});
