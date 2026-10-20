import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../../datos/puerta';
import { abreviar, ejeLimpio, serieProveedor, tendencia } from './analisis';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `a${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: null, facturaFecha: '2026-10-03', periodo: '202610', quincena: 1,
  numeroComprobante: '1', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 100,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: null, createdAt: '2026-10-05T15:28:00', ...over,
}) as RetencionPracticada;

describe('el análisis de un proveedor (maqueta v8-14, v8SerieProv y v8Tendencia)', () => {
  it('la serie: un punto por período del rango (también los vacíos), apilado por impuesto', () => {
    const s = serieProveedor([
      r({ facturaFecha: '2026-09-10', montoRetenido: 100 }),
      r({ facturaFecha: '2026-09-12', tipo: 'islr', montoRetenido: 40 }),
      r({ facturaFecha: '2026-10-02', montoRetenido: 50 }),
      r({ contraparteId: 'p2', montoRetenido: 999 }),
    ], 'p1', { desde: '2026-08-01', hasta: '2026-10-31', grano: 'mes', moneda: 'Bs', tipos: ['iva', 'islr'] });
    expect(s.por.map((x) => [x.clave, x.v, x.tot])).toEqual([
      ['2026-08', {}, 0], ['2026-09', { iva: 100, islr: 40 }, 140], ['2026-10', { iva: 50 }, 50],
    ]);
    expect(s.ks).toEqual(['iva', 'islr']);
    expect(s.totK).toEqual({ iva: 150, islr: 40 });
    expect(s.total).toBe(190);
    expect(s.nRet).toBe(3);
  });

  it('la tendencia: hacen falta 4 períodos; regresión lineal, «sube», «baja» o «estable»', () => {
    expect(tendencia([1, 2, 3]).texto).toBe('Pocos períodos para una tendencia: hacen falta 4 o más.');
    expect(tendencia([0, 0, 0, 0]).texto).toBe('Sin retenciones en el rango.');
    expect(tendencia([100, 100, 100, 100]).texto).toBe('Estable: varía menos del 1 % por período.');
    const t = tendencia([100, 200, 300, 400]);
    expect(t.pendiente).toBe(100);
    expect(t.texto).toBe('Sube en promedio un 40 % por período (línea punteada).');
    expect(tendencia([400, 300, 200, 100]).texto).toBe('Baja en promedio un 40 % por período (línea punteada).');
  });

  it('el eje: números redondos', () => {
    expect(ejeLimpio(3700)).toEqual({ tope: 4000, paso: 2000 });
    expect(ejeLimpio(0)).toEqual({ tope: 1, paso: 1 });
  });

  it('los montos abreviados del eje', () => {
    expect(abreviar(2000)).toBe('2 mil');
    expect(abreviar(1500000)).toBe('1,5 M');
    expect(abreviar(750)).toBe('750');
  });
});
