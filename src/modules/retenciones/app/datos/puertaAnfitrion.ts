/* ============================================================
   MGG · Retenciones v8 · La puerta del sistema anfitrión (MGG hoy)

   Primera implementación: delega en los repositorios que ya usa la pantalla
   de producción, sobre las tablas que existen hoy. La capa de datos (pieza D)
   la amplía; las pantallas no cambian, porque solo conocen PuertaRetenciones.
   ============================================================ */

import { listRetencionesHechas, listRetencionesPendientes } from '../../retenciones.repository';
import {
  anularRetencion, getConfigRetencion, listConceptos, listRetenciones, registrarRetencion,
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
  anular: (id, motivo) => anularRetencion(id, motivo),
};
