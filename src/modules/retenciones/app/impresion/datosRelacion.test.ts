import { describe, expect, it } from 'vitest';
import type { ConceptoRetencion, RetencionPracticada } from '../datos/puerta';
import { datosRelacion } from './datosRelacion';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `q${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-000123', facturaFecha: '2026-10-03', periodo: '202610', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-05T15:28:00', ...over,
}) as RetencionPracticada;
const conceptos = [{ id: 'k1', codigo: '055', nombre: 'Servicios' }] as ConceptoRetencion[];
const generado = new Date(2026, 9, 20, 13, 5);

describe('la relación impresa, desde el libro de hoy', () => {
  it('solo las practicadas vivas del impuesto, con la fecha de emisión dentro del rango', () => {
    const libro = [
      r({}), r({ anulada: true }), r({ direccion: 'recibida' }), r({ tipo: 'islr' }),
      r({ createdAt: '2026-11-02T10:00:00' }),
    ];
    const d = datosRelacion(libro, { impuesto: 'iva', desde: '2026-10-01', hasta: '2026-10-31', empresa: 'Empresa de Ejemplo C.A.', generado, conceptos });
    expect(d.filas).toHaveLength(1);
    expect(d).toMatchObject({ impuesto: 'iva', empresa: 'Empresa de Ejemplo C.A.', desde: '2026-10-01', hasta: '2026-10-31' });
  });

  it('la fila del IVA: el RIF es también el código; total = base + impuesto', () => {
    const [f] = datosRelacion([r({})], { impuesto: 'iva', desde: '2026-10-01', hasta: '2026-10-31', empresa: '', generado, conceptos }).filas;
    expect(f).toMatchObject({ rif: 'J-00000001-0', nombre: 'Proveedor Alfa', comp: '20261000000011', documento: '000123', control: '00-000123', fecha: '2026-10-05', exento: 0, base: 1000, impuesto: 160, total: 1160, retenido: 120 });
  });

  it('la fila del ISLR: tipo «FCM», código y descripción del concepto, y su %', () => {
    const [f] = datosRelacion([r({ tipo: 'islr', conceptoId: 'k1', conceptoNombre: 'Servicios', porcentaje: 2, montoRetenido: 20 })],
      { impuesto: 'islr', desde: '2026-10-01', hasta: '2026-10-31', empresa: '', generado, conceptos }).filas;
    expect(f).toMatchObject({ tipodoc: 'FCM', concepto: '055', descripcion: 'SERVICIOS', pct: 2, retenido: 20 });
  });

  it('el ISAE sale de las municipales', () => {
    expect(datosRelacion([r({ tipo: 'municipal' })], { impuesto: 'isae', desde: '2026-10-01', hasta: '2026-10-31', empresa: '', generado, conceptos }).filas).toHaveLength(1);
  });
});
