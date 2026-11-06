import { describe, expect, it } from 'vitest';
import { codigoDeMovimiento, procesarFilasReporteTesoreria, type FilaReporteTesoreria } from './reporteTesoreriaMoldeable';
import { columnasVisiblesTesoreria } from './exportarTesoreria';
import { textoWhatsappTesoreria } from './whatsappTesoreria';

const fila = (o: Partial<FilaReporteTesoreria>): FilaReporteTesoreria => ({
  id: Math.random().toString(36), ambito: 'por_pagar', fecha: '2026-11-03', moneda_original: 'USD', monto_original: 10,
  tipo_movimiento: 'egreso', categoria: 'Orden de compra', contraparte: 'CIUDAD ESCOLAR', concepto: '',
  origen_documento: 'Orden de compra', tasa_bcv_aplicada: 893.22, monto_usd: 10, monto_bs: 8932.2, ...o,
});

describe('Reporte de Tesorería · código de la OC, método y estado (04-11-2026)', () => {
  it('saca el código de la OC del concepto del movimiento', () => {
    expect(codigoDeMovimiento({ motivo: 'Pago OC SV-2026-0021 · pago: transferencia', gasto_correlativo: null })).toBe('SV-2026-0021');
    expect(codigoDeMovimiento({ motivo: 'Pago OC OC-2026-0243-1 · x', gasto_correlativo: 7 })).toBe('OC-2026-0243-1');
    expect(codigoDeMovimiento({ motivo: 'Gasto de oficina', gasto_correlativo: 12 })).toBe('12');
  });

  it('al agrupar por proveedor el grupo lleva sus códigos, su método y su estado', () => {
    const { filas } = procesarFilasReporteTesoreria([
      fila({ codigo: 'OC-2026-0240', estado: 'Lista para pagar', datos_pago_resumen: 'Pago móvil · 0102' }),
      fila({ codigo: 'OC-2026-0241', estado: 'Lista para pagar', datos_pago_resumen: 'Pago móvil · 0102' }),
    ], 'contraparte');
    expect(filas).toHaveLength(1);
    expect(filas[0].codigo).toBe('OC-2026-0240, OC-2026-0241');
    expect(filas[0].estado).toBe('Lista para pagar');
    expect(filas[0].datos_pago_resumen).toBe('Pago móvil · 0102');
  });

  it('respeta las columnas seleccionadas para el reporte', () => {
    const claves = columnasVisiblesTesoreria(['codigo', 'contraparte', 'monto_usd'], { mostrarUsd: true, mostrarBs: false, ambito: 'por_pagar' }).map((c) => c.clave);
    expect(claves).toContain('codigo');
    const sinCodigo = columnasVisiblesTesoreria(['contraparte', 'monto_usd'], { mostrarUsd: true, mostrarBs: false, ambito: 'por_pagar' }).map((c) => c.clave);
    expect(sinCodigo).not.toContain('codigo');
  });

  it('el WhatsApp pone el código delante del proveedor', () => {
    const t = textoWhatsappTesoreria([fila({ codigo: 'OC-2026-0240' })], { ambito: 'por_pagar', desde: '2026-11-01', hasta: '2026-11-04', mostrarBs: false });
    expect(t).toContain('OC-2026-0240 · CIUDAD ESCOLAR — *$ 10,00*');
  });
});
