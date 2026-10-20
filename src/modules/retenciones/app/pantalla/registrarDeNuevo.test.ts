import { describe, expect, it } from 'vitest';
import type { RetencionItem, RetencionPracticada } from '../datos/puerta';
import { documentoParaRegistrar, puedeRegistrarDeNuevo, semillaDeAnulada } from './registrarDeNuevo';

// Datos inventados.
let n = 0;
const r = (over: Partial<RetencionPracticada>): RetencionPracticada => ({
  id: `d${++n}`, tipo: 'iva', direccion: 'practicada', estado: 'registrada', docKind: 'oc', docId: 'oc-1', docCodigo: 'OC-0001',
  contraparteId: 'p1', contraparteRif: 'J-00000001-0', contraparteNombre: 'Proveedor Alfa', contraparteSujeto: null,
  facturaNumero: '000123', facturaControl: '00-000123', facturaFecha: '2026-10-03', periodo: '2026-10', quincena: 1,
  numeroComprobante: '20261000000011', conceptoId: null, conceptoNombre: null, moneda: 'Bs', tasa: null,
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, sustraendo: 0, montoRetenido: 120,
  comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: true, anuladaMotivo: 'Monto errado',
  declaradaEn: null, actorName: 'Ana Pérez', createdAt: '2026-10-03T15:28:00', ...over,
}) as RetencionPracticada;

describe('«Registrar <IMP> de nuevo» (maqueta v8-3, v8AccionRehacer)', () => {
  it('solo en una practicada anulada sin otra viva del mismo impuesto en la factura', () => {
    const a = r({});
    expect(puedeRegistrarDeNuevo(a, [a])).toBe(true);
    expect(puedeRegistrarDeNuevo(a, [a, r({ anulada: false })])).toBe(false);
    expect(puedeRegistrarDeNuevo(r({ anulada: false }), [])).toBe(false);
    const recibida = r({ direccion: 'recibida' });
    expect(puedeRegistrarDeNuevo(recibida, [recibida])).toBe(false);
  });

  it('una declarada no se registra de nuevo (primero se reabre el período)', () => {
    const a = r({ estado: 'declarada' });
    expect(puedeRegistrarDeNuevo(a, [a])).toBe(false);
  });

  it('la semilla trae los datos de la factura de la anulada y a cuál reemplaza', () => {
    expect(semillaDeAnulada(r({ numeroComprobante: '20261000000029' }))).toEqual({
      factura: '000123', control: '00-000123', fecha: '2026-10-03', iva: 160, base: 1000, reemplazaA: '20261000000029',
    });
  });

  it('el documento con que se abre el registro: el de la lista de pendientes', () => {
    const items = [{ kind: 'oc', id: 'oc-1' }, { kind: 'compra_directa', id: 'c-1' }] as RetencionItem[];
    expect(documentoParaRegistrar(r({}), items)?.id).toBe('oc-1');
    expect(documentoParaRegistrar(r({ docKind: 'compra_directa', docId: 'c-1' }), items)?.kind).toBe('compra_directa');
    expect(documentoParaRegistrar(r({ docId: 'oc-9' }), items)).toBeNull();
  });
});
