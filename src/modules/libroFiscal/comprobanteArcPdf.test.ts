import { describe, expect, it } from 'vitest';
import { compilarDatosArc } from './comprobanteArcPdf';
import type { RetencionPracticada } from './retencionesFiscal.repository';

const retencion = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: 'r1', tipo: 'islr', direccion: 'practicada', estado: 'registrada',
  docKind: 'manual', docId: null, docCodigo: null,
  contraparteId: null, contraparteRif: 'J-12345678-0', contraparteNombre: 'Inversiones Alpha C.A.', contraparteSujeto: 'pj_domiciliada',
  facturaNumero: '001', facturaControl: '00-001', facturaFecha: '2026-02-15',
  periodo: '202602', quincena: 1, numeroComprobante: '20260200000001',
  conceptoId: '001', conceptoNombre: 'Servicios de Transporte', moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 0, impuesto: 0, porcentaje: 2, sustraendo: 0, montoRetenido: 20, montoBs: 20,
  comprobantePath: null, comprobanteNombre: null, observacion: null,
  anulada: false, anuladaMotivo: null, declaradaEn: null, declaradaPor: null, actorName: null,
  createdAt: '2026-02-15T14:00:00Z', updatedAt: null,
  ...over,
});

describe('comprobante anual ARC de ISLR (Art. 24 Decreto 1.808)', () => {
  it('consolida los 12 meses del ejercicio para el proveedor indicado', () => {
    const filas: RetencionPracticada[] = [
      retencion({ facturaFecha: '2026-01-10', baseImponible: 5000, montoRetenido: 100, montoBs: 100 }),
      retencion({ facturaFecha: '2026-02-20', baseImponible: 3000, montoRetenido: 60, montoBs: 60 }),
      retencion({ facturaFecha: '2026-05-15', baseImponible: 8000, montoRetenido: 160, montoBs: 160 }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-0', filas);
    expect(arc.anio).toBe(2026);
    expect(arc.proveedorNombre).toBe('Inversiones Alpha C.A.');
    expect(arc.meses).toHaveLength(12);

    // Enero (mes 1)
    expect(arc.meses[0].baseImponibleBs).toBe(5000);
    expect(arc.meses[0].impuestoRetenidoBs).toBe(100);

    // Febrero (mes 2)
    expect(arc.meses[1].baseImponibleBs).toBe(3000);
    expect(arc.meses[1].impuestoRetenidoBs).toBe(60);

    // Marzo (mes 3) sin operaciones
    expect(arc.meses[2].baseImponibleBs).toBe(0);
    expect(arc.meses[2].impuestoRetenidoBs).toBe(0);

    // Mayo (mes 5)
    expect(arc.meses[4].baseImponibleBs).toBe(8000);
    expect(arc.meses[4].impuestoRetenidoBs).toBe(160);

    // Totales del año
    expect(arc.totalBaseBs).toBe(16000);
    expect(arc.totalRetenidoBs).toBe(320);
    expect(arc.totalOperaciones).toBe(3);
  });

  it('deduce notas de crédito por devoluciones o ajustes en el mes correspondiente', () => {
    const filas: RetencionPracticada[] = [
      retencion({ facturaFecha: '2026-04-10', baseImponible: 10000, montoRetenido: 200, montoBs: 200, tipoDocumento: 'factura' }),
      retencion({ facturaFecha: '2026-04-25', baseImponible: 2000, montoRetenido: 40, montoBs: 40, tipoDocumento: 'nota_credito' }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-0', filas);
    expect(arc.meses[3].baseImponibleBs).toBe(8000);
    expect(arc.meses[3].impuestoRetenidoBs).toBe(160);
    expect(arc.totalBaseBs).toBe(8000);
    expect(arc.totalRetenidoBs).toBe(160);
  });

  it('excluye retenciones anuladas de la consolidación anual', () => {
    const filas: RetencionPracticada[] = [
      retencion({ facturaFecha: '2026-06-01', baseImponible: 4000, montoRetenido: 80, montoBs: 80, anulada: false }),
      retencion({ facturaFecha: '2026-06-15', baseImponible: 9999, montoRetenido: 999, montoBs: 999, anulada: true }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-0', filas);
    expect(arc.meses[5].baseImponibleBs).toBe(4000);
    expect(arc.meses[5].impuestoRetenidoBs).toBe(80);
    expect(arc.totalBaseBs).toBe(4000);
  });

  it('no mezcla proveedores ni ejercicios de otros años', () => {
    const filas: RetencionPracticada[] = [
      retencion({ contraparteRif: 'J-12345678-0', periodo: '202608', facturaFecha: '2026-08-01', baseImponible: 1000, montoRetenido: 20, montoBs: 20 }),
      retencion({ contraparteRif: 'J-99999999-9', periodo: '202608', facturaFecha: '2026-08-01', baseImponible: 5000, montoRetenido: 100, montoBs: 100 }),
      retencion({ contraparteRif: 'J-12345678-0', periodo: '202508', facturaFecha: '2025-08-01', baseImponible: 7000, montoRetenido: 140, montoBs: 140 }),
    ];

    const arc = compilarDatosArc(2026, 'J-12345678-0', filas);
    expect(arc.meses[7].baseImponibleBs).toBe(1000);
    expect(arc.totalBaseBs).toBe(1000);
  });

  it('anexarPaginasArcPdf genera 2 páginas en modo "ambos" (Original + Copia)', async () => {
    const { anexarPaginasArcPdf } = await import('./comprobanteArcPdf');
    const { CONFIG_RETENCION_DEFECTO } = await import('./retencionesCalculo');
    const filas: RetencionPracticada[] = [
      retencion({ facturaFecha: '2026-01-10', baseImponible: 5000, montoRetenido: 100, montoBs: 100 }),
    ];
    const datos = compilarDatosArc(2026, 'J-12345678-0', filas);
    const doc = await anexarPaginasArcPdf(datos, CONFIG_RETENCION_DEFECTO, {
      modoEjemplar: 'ambos',
      incluirLogo: false,
      incluirQr: false,
    });
    expect(doc.getNumberOfPages()).toBe(2);
  });

  it('anexarPaginasArcPdf genera 1 página en modo "original" o "copia"', async () => {
    const { anexarPaginasArcPdf } = await import('./comprobanteArcPdf');
    const { CONFIG_RETENCION_DEFECTO } = await import('./retencionesCalculo');
    const filas: RetencionPracticada[] = [
      retencion({ facturaFecha: '2026-01-10', baseImponible: 5000, montoRetenido: 100, montoBs: 100 }),
    ];
    const datos = compilarDatosArc(2026, 'J-12345678-0', filas);
    const docOrig = await anexarPaginasArcPdf(datos, CONFIG_RETENCION_DEFECTO, {
      modoEjemplar: 'original',
      incluirLogo: false,
      incluirQr: false,
    });
    expect(docOrig.getNumberOfPages()).toBe(1);

    const docCopia = await anexarPaginasArcPdf(datos, CONFIG_RETENCION_DEFECTO, {
      modoEjemplar: 'copia',
      incluirLogo: false,
      incluirQr: false,
    });
    expect(docCopia.getNumberOfPages()).toBe(1);
  });
});
