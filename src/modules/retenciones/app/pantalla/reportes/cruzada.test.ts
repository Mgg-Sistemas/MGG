import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../../datos/puerta';
import { columnasRango, cruzada, etiquetaColumna, tablaCruzada } from './cruzada';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `c${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: null, facturaFecha: '2026-10-03', periodo: '202610', quincena: 1,
  numeroComprobante: '1', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 100,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: null, createdAt: '2026-10-05T15:28:00', ...over,
}) as RetencionPracticada;

describe('retenido por proveedor y período (maqueta v8-14, R3-19)', () => {
  it('las columnas del rango, también las vacías: por mes, trimestre o año', () => {
    expect(columnasRango('2026-08-15', '2026-10-02', 'mes')).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(columnasRango('2026-05-01', '2026-10-31', 'trimestre')).toEqual(['2026-T2', '2026-T3', '2026-T4']);
    expect(columnasRango('2025-12-01', '2026-01-31', 'anio')).toEqual(['2025', '2026']);
  });

  it('las etiquetas de las columnas', () => {
    expect(etiquetaColumna('2026-10', 'mes')).toBe('Oct 2026');
    expect(etiquetaColumna('2026-T4', 'trimestre')).toBe('T4 2026');
    expect(etiquetaColumna('2026', 'anio')).toBe('2026');
  });

  it('suma lo retenido por proveedor y columna, con totales por fila, por columna y general; ordena por total', () => {
    const libro = [
      r({ montoRetenido: 100, facturaFecha: '2026-09-10' }),
      r({ montoRetenido: 50, facturaFecha: '2026-10-03' }),
      r({ contraparteId: 'p2', contraparteNombre: 'Proveedor Beta', contraparteRif: 'J-2', montoRetenido: 400, facturaFecha: '2026-10-20' }),
      r({ montoRetenido: 999, anulada: true }),
      r({ montoRetenido: 999, direccion: 'recibida' }),
      r({ montoRetenido: 999, moneda: 'USD' }),
    ];
    const c = cruzada(libro, { desde: '2026-09-01', hasta: '2026-10-31', grano: 'mes', moneda: 'Bs', tipos: ['iva'] });
    expect(c.columnas).toEqual(['2026-09', '2026-10']);
    expect(c.filas.map((f) => [f.nombre, f.celdas, f.total])).toEqual([
      ['Proveedor Beta', { '2026-10': 400 }, 400],
      ['Proveedor Alfa', { '2026-09': 100, '2026-10': 50 }, 150],
    ]);
    expect(c.totalesColumna).toEqual({ '2026-09': 100, '2026-10': 450 });
    expect(c.total).toBe(550);
  });

  it('la tabla para CSV, Excel e impresión: Proveedor, RIF, un período por columna y Total', () => {
    const c = cruzada([r({ facturaFecha: '2026-10-03', montoRetenido: 50 })], { desde: '2026-10-01', hasta: '2026-10-31', grano: 'mes', moneda: 'Bs', tipos: ['iva'] });
    expect(tablaCruzada(c)).toEqual({
      cabecera: ['Proveedor', 'RIF', 'Oct 2026', 'Total'],
      cuerpo: [['Proveedor Alfa', 'J-00000001-0', 50, 50], ['Total', '', 50, 50]],
    });
  });
});
