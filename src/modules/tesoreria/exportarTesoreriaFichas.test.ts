import { describe, expect, it, vi } from 'vitest';
import type { FilaReporteTesoreria, ResumenReporteTesoreria } from './reporteTesoreriaMoldeable';
import { descargarTesoreriaPdf, type MetadatosExportacionTesoreria } from './exportarTesoreria';

let autoTableCalls: any[] = [];
vi.mock('jspdf-autotable', () => ({
  default: (_doc: any, options: any) => {
    autoTableCalls.push(options);
  },
}));

vi.mock('@/shared/lib/reportePreview', () => ({
  previewPdf: () => {},
  previewExcelArchivo: () => Promise.resolve(),
}));

vi.mock('@/shared/lib/pdfLogo', () => ({
  loadLogoPdfEmpresa: () => Promise.resolve(null),
  dibujarLogoPdf: () => {},
  anchoLogoPdf: () => 0,
}));

describe('descargarTesoreriaPdf - Fichas vs Tabla (desglose créditos 3b)', () => {
  const filaCredito: FilaReporteTesoreria = {
    id: 'cred-1',
    ambito: 'creditos_cartera',
    tipo_movimiento: 'egreso',
    monto_usd: 178.99,
    monto_bs: 164450.44,
    monto_original: 178.99,
    moneda_original: '$',
    contraparte: 'MATERIALES HERMANOS MATA 3, C.A.',
    categoria: 'Cuenta a crédito (OC)',
    concepto: 'Compra a crédito',
    fecha: '2026-11-20',
    hora: '10:00',
    caja_origen: 'Banco',
    caja_destino: null,
    estado: 'A crédito',
    origen_documento: 'OC',
    codigo: 'OC-2026-0269',
    metodo_pago: 'Transferencia',
    datos_pago_resumen: 'Transferencia - Banco de Venezuela',
    tasa_bcv_aplicada: 918.77,
    es_credito_compras: true,
    tipo_credito_compras: 'OC',
  };

  const resumen: ResumenReporteTesoreria = {
    totalIngresosUsd: 0,
    totalIngresosBs: 0,
    totalEgresosUsd: 178.99,
    totalEgresosBs: 164450.44,
    saldoNetoUsd: -178.99,
    saldoNetoBs: -164450.44,
    totalOperaciones: 1,
    tasaBcvReferencia: 918.77,
    topCategorias: [],
    topProveedores: [],
  };

  const columnas = ['codigo', 'fecha', 'contraparte', 'categoria', 'monto_usd'];

  it('cuando formatoPresentacion es fichas, NO debe ejecutar autoTable para el desglose 3b', async () => {
    autoTableCalls = [];
    const meta: MetadatosExportacionTesoreria = {
      desde: '2026-11-01',
      hasta: '2026-11-21',
      ambito: 'creditos_cartera',
      agrupacion: 'contraparte',
      baseTasa: 'bcv_dia',
      monedaConsolidacion: 'usd',
      mostrarUsd: true,
      mostrarBs: false,
      incluirResumen: true,
      formatoPresentacion: 'fichas',
      creditosComprasDetalle: [filaCredito],
    };

    await descargarTesoreriaPdf([filaCredito], resumen, columnas, meta);

    // En fichas ejecutivas, NINGUNA autoTable debe haberse invocado (ni la principal ni la 3b de créditos)
    const tieneTablaCreditos = autoTableCalls.some((call) =>
      call.head?.[0]?.includes('Estado / Abonos') || call.head?.[0]?.includes('Saldo ($)'),
    );
    expect(tieneTablaCreditos).toBe(false);
    expect(autoTableCalls.length).toBe(0);
  });

  it('cuando formatoPresentacion es tabla, SÍ debe ejecutar autoTable (tabla principal y anexo 3b)', async () => {
    autoTableCalls = [];
    const meta: MetadatosExportacionTesoreria = {
      desde: '2026-11-01',
      hasta: '2026-11-21',
      ambito: 'creditos_cartera',
      agrupacion: 'contraparte',
      baseTasa: 'bcv_dia',
      monedaConsolidacion: 'usd',
      mostrarUsd: true,
      mostrarBs: false,
      incluirResumen: true,
      formatoPresentacion: 'tabla',
      creditosComprasDetalle: [filaCredito],
    };

    await descargarTesoreriaPdf([filaCredito], resumen, columnas, meta);

    // En tabla tabular, la tabla de desglose 3b debe estar presente
    const tieneTablaCreditos = autoTableCalls.some((call) =>
      call.head?.[0]?.includes('Estado / Abonos') && call.head?.[0]?.includes('Saldo ($)'),
    );
    expect(tieneTablaCreditos).toBe(true);
    expect(autoTableCalls.length).toBeGreaterThanOrEqual(2);
  });
});
