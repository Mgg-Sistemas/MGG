import { describe, expect, it } from 'vitest';
import {
  calcularResumenAuditoria,
  type EventoAuditoriaFiscal,
} from './auditoriaRetenciones.repository';

describe('auditoriaRetenciones.repository', () => {
  it('calcularResumenAuditoria calcula correctamente los conteos por tipo de evento', () => {
    const eventos: EventoAuditoriaFiscal[] = [
      {
        id: 'emision-1',
        tipo: 'emision',
        fechaIso: '2026-10-26T10:00:00Z',
        usuario: 'Juan Pérez',
        impuesto: 'IVA',
        titulo: 'Emisión de comprobante',
        referencia: 'Comprobante N° 20261000000001',
        severidad: 'exito',
      },
      {
        id: 'emision-2',
        tipo: 'emision',
        fechaIso: '2026-10-26T10:15:00Z',
        usuario: 'Juan Pérez',
        impuesto: 'ISLR',
        titulo: 'Emisión de comprobante',
        referencia: 'Comprobante N° 0000000002',
        severidad: 'exito',
      },
      {
        id: 'anulacion-1',
        tipo: 'anulacion',
        fechaIso: '2026-10-26T10:30:00Z',
        usuario: 'Admin',
        impuesto: 'IVA',
        titulo: 'Anulación de comprobante',
        referencia: 'Comprobante N° 20261000000001 (ANULADO)',
        motivo: 'Factura errónea emitida por el proveedor',
        severidad: 'alerta',
      },
      {
        id: 'cierre-1',
        tipo: 'cierre',
        fechaIso: '2026-10-15T18:00:00Z',
        usuario: 'Contabilidad',
        impuesto: 'IVA',
        titulo: 'Cierre de período fiscal declarado',
        referencia: 'IVA · Octubre 2026 · 1.ª quincena',
        severidad: 'normal',
      },
      {
        id: 'reapertura-1',
        tipo: 'reapertura',
        fechaIso: '2026-10-16T09:00:00Z',
        usuario: 'Jefe Tributario',
        impuesto: 'IVA',
        titulo: 'Reapertura de período',
        referencia: 'IVA · Octubre 2026 · 1.ª quincena',
        motivo: 'Llegada extemporánea de factura con fecha 14/10/2026',
        severidad: 'alerta',
      },
      {
        id: 'decision-1',
        tipo: 'no_aplica',
        fechaIso: '2026-10-20T11:00:00Z',
        usuario: 'Compras',
        impuesto: 'ISLR',
        titulo: 'Exención No aplica',
        referencia: 'Documento Fiscal #abc12345',
        motivo: 'Proveedor exento según Art. 14 Ley ISLR',
        severidad: 'aviso',
      },
    ];

    const resumen = calcularResumenAuditoria(eventos);

    expect(resumen.total).toBe(6);
    expect(resumen.emisiones).toBe(2);
    expect(resumen.anulaciones).toBe(1);
    expect(resumen.cierres).toBe(1);
    expect(resumen.reaperturas).toBe(1);
    expect(resumen.noAplica).toBe(1);
  });

  it('calcularResumenAuditoria maneja lista vacía sin errores', () => {
    const resumen = calcularResumenAuditoria([]);
    expect(resumen.total).toBe(0);
    expect(resumen.emisiones).toBe(0);
    expect(resumen.anulaciones).toBe(0);
    expect(resumen.cierres).toBe(0);
    expect(resumen.reaperturas).toBe(0);
    expect(resumen.noAplica).toBe(0);
  });
});
