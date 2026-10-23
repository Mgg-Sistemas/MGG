/* Golden Touch · Retenciones · Una retención de muestra para la vista previa del formato (R8).
   Datos inventados: solo se dibuja en pantalla, nunca se guarda. */
import type { RetencionPracticada } from './retencionesFiscal.repository';
import type { TipoImpuesto } from './retencionesCalculo';

export function retencionDeMuestra(tipo: TipoImpuesto, hoy: string): RetencionPracticada {
  const periodo = hoy.slice(0, 7).replace('-', '');
  return {
    id: 'muestra', tipo, direccion: 'practicada', estado: 'registrada', docKind: 'manual', docId: null, docCodigo: null,
    contraparteId: null, contraparteRif: 'J-00000000-0', contraparteNombre: 'PROVEEDOR DE MUESTRA', contraparteSujeto: tipo === 'islr' ? 'pj_domiciliada' : null,
    facturaNumero: '000123', facturaControl: '00-000456', facturaFecha: hoy, periodo, quincena: tipo === 'iva' ? 1 : null,
    numeroComprobante: tipo === 'iva' ? `${periodo}00000001` : '0000000001',
    operacionNumero: 1, tipoDocumento: 'factura', facturaTotal: tipo === 'iva' ? 1160 : 1000, exento: 0,
    conceptoId: null, conceptoNombre: tipo === 'islr' ? 'Honorarios profesionales' : null,
    moneda: 'Bs', tasa: null, baseImponible: 1000, alicuota: tipo === 'iva' ? 16 : 0, impuesto: tipo === 'iva' ? 160 : 0,
    porcentaje: tipo === 'iva' ? 75 : 2, sustraendo: 0, montoRetenido: tipo === 'iva' ? 120 : 20, baseBs: 1000, montoBs: tipo === 'iva' ? 120 : 20,
    comprobantePath: null, comprobanteNombre: null, observacion: null, anulada: false, anuladaMotivo: null,
    declaradaEn: null, declaradaPor: null, actorName: null, createdAt: `${hoy}T12:00:00Z`, updatedAt: null,
  } as RetencionPracticada;
}
