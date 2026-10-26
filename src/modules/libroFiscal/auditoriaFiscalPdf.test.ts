import { describe, expect, it, vi } from 'vitest';
import { exportarAuditoriaFiscalPdf } from './auditoriaFiscalPdf';
import type { EventoAuditoriaFiscal, ResumenAuditoria } from './auditoriaRetenciones.repository';

// Mock reportPreview to intercept previewPdfDoc
vi.mock('@/shared/lib/reportPreview', () => ({
  previewPdfDoc: vi.fn(),
}));

// Mock pdfLogo
vi.mock('@/shared/lib/pdfLogo', () => ({
  loadLogoDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,mockedLogo'),
}));

describe('auditoriaFiscalPdf', () => {
  it('lanza error si la lista de eventos está vacía', async () => {
    const resumen: ResumenAuditoria = {
      total: 0, emisiones: 0, anulaciones: 0, cierres: 0, reaperturas: 0, noAplica: 0,
    };
    await expect(exportarAuditoriaFiscalPdf([], resumen)).rejects.toThrow('No hay eventos de auditoría para exportar.');
  });

  it('genera el PDF de auditoría y llama a previewPdfDoc con el nombre adecuado', async () => {
    const { previewPdfDoc } = await import('@/shared/lib/reportPreview');

    const eventos: EventoAuditoriaFiscal[] = [
      {
        id: 'emision-1',
        tipo: 'emision',
        fechaIso: '2026-10-26T14:30:00Z',
        usuario: 'analista@mgg.com',
        impuesto: 'IVA',
        titulo: 'Emisión de comprobante',
        referencia: 'Comprobante 20261000000001',
        severidad: 'exito',
        documentoFiscal: { factura: 'FAC-001' },
        contraparte: { nombre: 'Proveedor Minero C.A.', rif: 'J-12345678-9' },
        monto: { retenidoBs: 150.75, moneda: 'Bs' },
      },
      {
        id: 'anulacion-1',
        tipo: 'anulacion',
        fechaIso: '2026-10-26T15:00:00Z',
        usuario: 'admin@mgg.com',
        impuesto: 'IVA',
        titulo: 'Anulación de comprobante',
        referencia: 'Comprobante 20261000000001 (ANULADO)',
        motivo: 'Error en la factura de origen',
        severidad: 'alerta',
      },
    ];

    const resumen: ResumenAuditoria = {
      total: 2, emisiones: 1, anulaciones: 1, cierres: 0, reaperturas: 0, noAplica: 0,
    };

    await exportarAuditoriaFiscalPdf(eventos, resumen, {
      tipo: 'emision',
      impuesto: 'IVA',
    });

    expect(previewPdfDoc).toHaveBeenCalledTimes(1);
    const [doc, filename] = (previewPdfDoc as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(filename).toMatch(/^auditoria-retenciones-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(doc).toBeDefined();
  });
});
