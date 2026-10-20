/* ============================================================
   MGG · Retenciones v8 · La puerta del sistema anfitrión (MGG hoy)

   Primera implementación: delega en los repositorios que ya usa la pantalla
   de producción, sobre las tablas que existen hoy. La capa de datos (pieza D)
   la amplía; las pantallas no cambian, porque solo conocen PuertaRetenciones.
   ============================================================ */

import { previewFileUrl } from '@/shared/lib/reportPreview';
import { listRetencionesHechas, listRetencionesPendientes, urlRetencion } from '../../retenciones.repository';
import {
  activarConcepto, adjuntarComprobante, anularRetencion, getConfigRetencion, guardarConcepto, guardarConfigRetencion,
  listConceptos, listRetenciones, registrarRetencion,
} from '../../retencionesFiscal.repository';
import { urlAdjuntoCompra } from '@/modules/pedidos/compras.repository';
import { resumenLibro, totalesPorMoneda } from '../../retencionesCalculo';
import type { PuertaRetenciones } from './puerta';
import { declararPeriodo, guardarPasoInicial, listPasoInicial, listPeriodos, reabrirPeriodo, umbralDeclaraciones } from './periodos';
import { direccionDeProveedor, listArchivosDeDocumentos, listRetenidoSinRegistrar } from './retenidoAlPagar';

export const puertaAnfitrion: PuertaRetenciones = {
  capacidades: { reglas: false, periodos: false, otroSistema: false, impresiones: false, reportes: false },
  pendientes: () => listRetencionesPendientes(),
  hechas: () => listRetencionesHechas(),
  libro: (filtro) => listRetenciones(filtro),
  config: () => getConfigRetencion(),
  conceptos: (soloActivos) => listConceptos(soloActivos),
  registrar: (input) => registrarRetencion(input),
  adjuntarComprobante: (id, archivo) => adjuntarComprobante(id, archivo),
  // Lo mismo que hace hoy el Libro fiscal (LibroFiscal.tsx, verComprobante y verAdjunto).
  verComprobante: async (r) => {
    const [config, { verComprobanteRetencionPdf }] = await Promise.all([getConfigRetencion(), import('../../comprobanteRetencionPdf')]);
    await verComprobanteRetencionPdf(r, config);
  },
  guardarConfig: (c, actor) => guardarConfigRetencion(c, actor),
  guardarConcepto: (c) => guardarConcepto(c),
  activarConcepto: (id, activo) => activarConcepto(id, activo),
  verArchivo: async (r) => {
    if (!r.comprobantePath) throw new Error('La retención no tiene archivo adjunto.');
    await previewFileUrl(await urlRetencion(r.comprobantePath), r.comprobanteNombre ?? 'comprobante', 'Comprobante de retención');
  },
  anular: (id, motivo) => anularRetencion(id, motivo),
  // La factura de la OC está en compras-oc (urlRetencion); la de la compra directa, en su bucket (urlAdjuntoCompra).
  verFactura: async (a) => {
    const url = a.origen === 'oc' ? await urlRetencion(a.path) : await urlAdjuntoCompra(a.path);
    await previewFileUrl(url, a.nombre, 'Factura');
  },
  retenidoSinRegistrar: () => listRetenidoSinRegistrar(),
  archivosDeDocumentos: (docs) => listArchivosDeDocumentos(docs),
  direccionProveedor: (id) => direccionDeProveedor(id),
  // Lo mismo que hace hoy el Libro fiscal (LibroFiscal.tsx, verLibroFiscalPdf con su resumen y un total por moneda).
  // Los períodos (paquete 07 de la base de Retenciones): sin él, periodos() da null y la pestaña no se muestra.
  periodos: () => listPeriodos(),
  pasoInicial: (ks) => listPasoInicial(ks),
  declararPeriodo: (id, d) => declararPeriodo(id, d),
  reabrirPeriodo: (id, motivo) => reabrirPeriodo(id, motivo),
  guardarPasoInicial: (tipo, p) => guardarPasoInicial(tipo, p),
  umbralDeclaraciones: () => umbralDeclaraciones(),
  imprimirLibro: async (filas, rango) => {
    const [config, { verLibroFiscalPdf }] = await Promise.all([getConfigRetencion(), import('../../libroFiscalPdf')]);
    const fila = (r: (typeof filas)[number]) => ({ tipo: r.tipo, direccion: r.direccion, estado: r.estado, monto: r.montoRetenido, anulada: r.anulada });
    await verLibroFiscalPdf(filas, config, {
      ...rango, direccion: null,
      resumen: resumenLibro(filas.map(fila)),
      totales: totalesPorMoneda(filas.map((r) => ({ ...fila(r), moneda: r.moneda }))),
    });
  },
};
