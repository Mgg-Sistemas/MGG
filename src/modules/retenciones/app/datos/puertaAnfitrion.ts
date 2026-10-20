/* ============================================================
   MGG · Retenciones v8 · La puerta del sistema anfitrión (MGG hoy)

   Primera implementación: delega en los repositorios que ya usa la pantalla
   de producción, sobre las tablas que existen hoy. La capa de datos (pieza D)
   la amplía; las pantallas no cambian, porque solo conocen PuertaRetenciones.
   ============================================================ */

import { previewFileUrl } from '@/shared/lib/reportPreview';
import { listRetencionesHechas, listRetencionesPendientes, urlRetencion } from '../../retenciones.repository';
import {
  adjuntarComprobante, anularRetencion, getConfigRetencion, listConceptos, listRetenciones, registrarRetencion,
} from '../../retencionesFiscal.repository';
import type { PuertaRetenciones } from './puerta';

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
  verArchivo: async (r) => {
    if (!r.comprobantePath) throw new Error('La retención no tiene archivo adjunto.');
    await previewFileUrl(await urlRetencion(r.comprobantePath), r.comprobanteNombre ?? 'comprobante', 'Comprobante de retención');
  },
  anular: (id, motivo) => anularRetencion(id, motivo),
};
