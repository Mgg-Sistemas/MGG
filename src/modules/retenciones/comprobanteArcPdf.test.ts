import { describe, expect, it } from 'vitest';
import { compilarDatosArc, MESES_ANIO } from './comprobanteArcPdf';
import type { RetencionPracticada } from './retencionesFiscal.repository';

const ret = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'r1', tipo: 'islr', direccion: 'practicada', estado: 'registrada',
  docKind: 'manual', docId: null, docCodigo: null,
  contraparteId: 'p1', contraparteRif: 'J-12345678-9', contraparteNombre: 'Servicios Alfa C.A.',
  contraparteSujeto: 'pj_domiciliada', facturaNumero: '001', facturaControl: '00-001',
  facturaFecha: '2026-03-15', periodo: '202603', quincena: null, numeroComprobante: '20260300000001',
  conceptoId: null, conceptoNombre: 'Servicios', moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 0, impuesto: 0, porcentaje: 5, sustraendo: 0,
  montoRetenido: 50, comprobantePath: null, comprobanteNombre: null, observacion: null,
  anulada: false, anuladaMotivo: null, declaradaEn: null, actorName: null, createdAt: '2026-03-15T10:00:00Z',
  ...over,
});

describe('comprobante anual ARC de ISLR (Art. 24 Decreto 1.808)', () => {
  it('tiene los 12 meses del año en orden', () => {
    expect(MESES_ANIO).toHaveLength(12);
    expect(MESES_ANIO[0]).toBe('Enero');
    expect(MESES_ANIO[11]).toBe('Diciembre');
  });

  it('compila y agrupa las retenciones de ISLR practicadas del año para un proveedor', () => {
    const filas = [
      ret({ id: '1', facturaFecha: '2026-01-10', baseImponible: 2000, montoRetenido: 100 }),
      ret({ id: '2', facturaFecha: '2026-01-20', baseImponible: 1000, montoRetenido: 50 }),
      ret({ id: '3', facturaFecha: '2026-06-15', baseImponible: 5000, montoRetenido: 250 }),
      // De otro proveedor: no entra
      ret({ id: '4', contraparteRif: 'J-99999999-9', facturaFecha: '2026-01-15' }),
      // De otro año: no entra
      ret({ id: '5', facturaFecha: '2025-12-15' }),
      // De IVA: no entra
      ret({ id: '6', tipo: 'iva', facturaFecha: '2026-01-15' }),
      // Anulada: no entra
      ret({ id: '7', anulada: true, facturaFecha: '2026-01-15' }),
      // Recibida (de cliente): no entra
      ret({ id: '8', direccion: 'recibida', facturaFecha: '2026-01-15' }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-9', filas);
    expect(arc.anio).toBe(2026);
    expect(arc.proveedorRif).toBe('J-12345678-9');
    expect(arc.proveedorNombre).toBe('Servicios Alfa C.A.');

    // Enero (mes 1)
    const ene = arc.meses[0];
    expect(ene.mesNumero).toBe(1);
    expect(ene.baseImponibleBs).toBe(3000);
    expect(ene.impuestoRetenidoBs).toBe(150);
    expect(ene.operaciones).toBe(2);

    // Junio (mes 6)
    const jun = arc.meses[5];
    expect(jun.mesNumero).toBe(6);
    expect(jun.baseImponibleBs).toBe(5000);
    expect(jun.impuestoRetenidoBs).toBe(250);
    expect(jun.operaciones).toBe(1);

    // Totales
    expect(arc.totalBaseBs).toBe(8000);
    expect(arc.totalRetenidoBs).toBe(400);
    expect(arc.totalOperaciones).toBe(3);
  });

  it('las notas de crédito restan de la base y del impuesto retenido', () => {
    const filas = [
      ret({ id: '1', facturaFecha: '2026-04-10', baseImponible: 2000, montoRetenido: 100 }),
      ret({ id: '2', facturaFecha: '2026-04-20', baseImponible: 500, montoRetenido: 25, ...({ tipoDocumento: 'nota_credito' } as any) }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-9', filas);
    const abr = arc.meses[3]; // Abril
    expect(abr.baseImponibleBs).toBe(1500); // 2000 - 500
    expect(abr.impuestoRetenidoBs).toBe(75); // 100 - 25
    expect(arc.totalBaseBs).toBe(1500);
    expect(arc.totalRetenidoBs).toBe(75);
  });
});
