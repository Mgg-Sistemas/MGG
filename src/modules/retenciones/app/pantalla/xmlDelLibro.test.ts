import { describe, expect, it } from 'vitest';
import { nombrePeriodoXml, periodosXml, prepararXmlIslr } from './xmlDelLibro';
import type { RetencionPracticada } from '../datos/puerta';

const ret = (over: Partial<RetencionPracticada> = {}): RetencionPracticada => ({
  id: 'r1', tipo: 'islr', direccion: 'practicada', estado: 'registrada', docKind: 'manual',
  docId: null, docCodigo: null, contraparteId: 'p1', contraparteRif: 'J-00000000-1',
  contraparteNombre: 'PROVEEDOR 1 C.A.', contraparteSujeto: 'pj_domiciliada',
  facturaNumero: '000123', facturaControl: '00-000456', facturaFecha: '2026-10-21',
  periodo: '202610', quincena: null, numeroComprobante: '0000000001',
  conceptoId: '001:pjd', conceptoNombre: 'Honorarios profesionales',
  moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: 0, impuesto: 0,
  porcentaje: 2, sustraendo: 0, montoRetenido: 20, montoBs: 20,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, declaradaPor: null, actorName: null, createdAt: '2026-10-21T12:00:00Z', updatedAt: null,
  ...over,
});

describe('xmlDelLibro', () => {
  it('formatea nombre del período mensual', () => {
    expect(nombrePeriodoXml('202610')).toBe('Octubre de 2026');
    expect(nombrePeriodoXml('202601')).toBe('Enero de 2026');
  });

  it('extrae períodos únicos de ISLR practicadas ordenados descendentemente', () => {
    const list = [
      ret({ id: '1', periodo: '202609' }),
      ret({ id: '2', periodo: '202610' }),
      ret({ id: '3', periodo: '202610' }),
      ret({ id: '4', tipo: 'iva', periodo: '202611' }),
      ret({ id: '5', direccion: 'recibida', periodo: '202612' }),
    ];
    const periodos = periodosXml(list);
    expect(periodos.map((p) => p.periodo)).toEqual(['202610', '202609']);
  });

  it('prepararXmlIslr arma el resultado XML para la empresa', () => {
    const list = [ret({ id: '1', periodo: '202610' })];
    const res = prepararXmlIslr(list, '202610', { rif: 'J-12345678-0', razonSocial: 'PRUEBA C.A.' });
    expect(res.lineas).toBe(1);
    expect(res.nombre).toBe('PRUEBACADECLARACIONINFORMATIVAISLR202610.XML');
    expect(res.faltan).toEqual([]);
  });
});
