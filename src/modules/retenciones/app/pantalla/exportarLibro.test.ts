import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { COLUMNAS_LIBRO, rangoDeFilas, tablaLibro, textoCsv } from './exportarLibro';

// Datos inventados.
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'x1', tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor "Alfa"; C.A.', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: null, facturaFecha: '2026-10-03', periodo: '2026-10', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1234.5, alicuota: 16, impuesto: 197.52, porcentaje: 75, sustraendo: 0, montoRetenido: 148.14,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-03T15:28:00', ...over,
}) as RetencionPracticada;

describe('el Libro exportable (lo filtrado)', () => {
  it('una fila por retención, con las columnas del libro y los montos como número', () => {
    const t = tablaLibro([r({})]);
    expect(t.cabecera).toEqual([...COLUMNAS_LIBRO]);
    expect(t.cuerpo[0]).toEqual([
      '03/10/2026', '20261000000011', 'IVA', 'A proveedores', 'Proveedor "Alfa"; C.A.', 'J-00000001-0', '000123', 'OC-0001',
      1234.5, 197.52, 75, 148.14, 'Bs', 'Registrada',
    ]);
  });

  it('la anulada va igual, con su estado (el libro no tiene huecos)', () => {
    expect(tablaLibro([r({ anulada: true })]).cuerpo[0].at(-1)).toBe('Anulada');
  });

  it('el CSV: separador «;», montos con coma decimal, comillas escapadas y BOM para Excel', () => {
    const csv = textoCsv(tablaLibro([r({})]));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [cab, fila] = csv.slice(1).split('\r\n');
    expect(cab.split(';')).toHaveLength(COLUMNAS_LIBRO.length);
    expect(fila).toContain('"Proveedor ""Alfa""; C.A."');
    expect(fila).toContain(';1.234,50;');
    expect(fila).toContain(';148,14;');
  });

  it('el rango de fechas de lo filtrado, para el encabezado del PDF', () => {
    expect(rangoDeFilas([r({ facturaFecha: '2026-10-09' }), r({ facturaFecha: '2026-09-28' })])).toEqual({ desde: '2026-09-28', hasta: '2026-10-09' });
    expect(rangoDeFilas([])).toBeNull();
  });
});
