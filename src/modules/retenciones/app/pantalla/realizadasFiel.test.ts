import { describe, expect, it } from 'vitest';
import type { RetencionPracticada } from '../datos/puerta';
import { FILTRO_INICIAL, facturasRealizadas, textoEstadoEnFactura } from './realizadasYLibro';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `f${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: null, facturaFecha: '2026-10-03', periodo: '2026-10', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-03T15:28:00', ...over,
}) as RetencionPracticada;

describe('Realizadas: el estado de cada retención dentro de su factura (maqueta v8-3, v7PintarHechas)', () => {
  it('una registrada o declarada dice su estado', () => {
    const a = r({});
    expect(textoEstadoEnFactura(a, [a])).toBe('Registrada');
    const d = r({ estado: 'declarada' });
    expect(textoEstadoEnFactura(d, [d])).toBe('Declarada');
  });

  it('una anulada con otra viva del mismo impuesto: reemplazada por su número', () => {
    const vieja = r({ anulada: true, numeroComprobante: '20261000000011' });
    const nueva = r({ numeroComprobante: '20261000000015' });
    expect(textoEstadoEnFactura(vieja, [vieja, nueva])).toBe('Anulada · reemplazada por el N° 20261000000015');
  });

  it('una anulada sin reemplazo: el impuesto de esta factura está pendiente', () => {
    const vieja = r({ tipo: 'municipal', anulada: true });
    const otra = r({ tipo: 'iva' });
    expect(textoEstadoEnFactura(vieja, [vieja, otra])).toBe('Anulada · el ISAE de esta factura está pendiente');
  });

  it('la fila de la factura guarda todas sus retenciones, aunque el filtro muestre solo algunas', () => {
    const vieja = r({ docId: 'oc-9', anulada: true });
    const nueva = r({ docId: 'oc-9', numeroComprobante: '20261000000020' });
    const [fila] = facturasRealizadas([vieja, nueva], { ...FILTRO_INICIAL, estado: 'anulada' });
    expect(fila.retenciones.map((x) => x.id)).toEqual([vieja.id]);
    expect(fila.todas.map((x) => x.id)).toEqual([vieja.id, nueva.id]);
  });
});
