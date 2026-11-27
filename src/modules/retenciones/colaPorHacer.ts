/* ============================================================
   Golden Touch · Retenciones · Cola unificada «Por hacer» (Etapa 1)

   Reúne en una sola cola por empresa todas las facturas listas para
   retener que tienen archivo adjunto:
   1. Facturas de Compras con archivo (órdenes de compra, compras directas
      y servicios directos subidos por Compras).
   2. Facturas recibidas del Buzón Móvil (clasificadas por empresa y
      con soportes adjuntos).
   3. Órdenes con factura de recepción adjunta (históricas).

   REGLA DE ORO: Sin archivo adjunto no hay retención. Las compras sin
   factura no entran en esta cola (se gestionan en la vista Sin Factura).
   ============================================================ */

import type { Orden } from '@/shared/lib/types';
import { puedePracticar, type ConfigRetencion } from '@/modules/libroFiscal/retencionesCalculo';
import type { FacturaDeOrigen, DatosDirectoExtra } from '@/modules/libroFiscal/documentosOrigen.repository';
import { NOMBRE_ORIGEN } from '@/modules/libroFiscal/documentosOrigen.repository';
import type { FacturaBuzon } from './facturasBuzon.repository';
import { rotuloNumeroFactura, rotuloTipoDocumento } from './facturasBuzon.repository';
import type { RetencionItem } from './retenciones.repository';
import { ESTADOS_NUNCA_RETENCION } from './retenciones.repository';
import { esEmpresaGt } from './empresaActual';
import type { RegistroSoporteFisico, SoportesFisicosMap } from './soporteFisico.repository';
import { resolverSoporteFisicoClave } from './soporteFisico.repository';

export type ImpuestoPendiente = 'iva' | 'islr' | 'municipal';

export const IMPUESTOS_PENDIENTES: { key: ImpuestoPendiente; label: string }[] = [
  { key: 'iva', label: 'IVA' },
  { key: 'islr', label: 'ISLR' },
  { key: 'municipal', label: 'ISAE' },
];

export type TipoOrigenCola = 'buzon' | 'compras_archivo' | 'compras_orden';

export interface ItemColaPorHacer {
  id: string;
  origen: TipoOrigenCola;
  empresaId: string;
  empresaNombre?: string;
  codigo: string;
  tipoDocumento: string;
  proveedorNombre: string;
  proveedorRif?: string | null;
  fecha?: string | null;
  moneda: 'Bs' | 'USD';
  total: number;
  ivaMonto?: number | null;
  baseImponible?: number | null;
  // Archivo adjunto (garantizado: nunca vacío)
  archivoNombre: string;
  archivoPath?: string;
  archivoBucket?: string;
  adjuntosCount: number;
  // Impuestos
  impuestosPendientes: ImpuestoPendiente[];
  retencionesCargadasCount: number;
  totalImpuestosCount: number;
  // Soporte físico recibido y entregador
  soporteFisico?: RegistroSoporteFisico;
  // Referencias originales
  rawBuzon?: FacturaBuzon;
  rawFacturaOrigen?: FacturaDeOrigen;
  rawOrdenItem?: RetencionItem;
}

export type Registradas = Map<string, Set<string>>;

export function tipoAGt(k: ImpuestoPendiente): 'iva' | 'islr' | 'municipal' {
  return k;
}

export function filtrarActivos(
  impuestos: ImpuestoPendiente[],
  activos: Set<string> | null | undefined,
): ImpuestoPendiente[] {
  if (!activos) return impuestos;
  return impuestos.filter((k) => activos.has(tipoAGt(k)));
}

export function impuestosPendientesDeOrden(
  o: Orden,
  reg: Registradas,
  practica: Set<ImpuestoPendiente> | null = null,
  config?: ConfigRetencion | null,
  activos: Set<string> | null = null,
): ImpuestoPendiente[] {
  const ya = reg.get(o.id);
  const out: ImpuestoPendiente[] = [];
  const retiene = (k: ImpuestoPendiente) => {
    if (k === 'iva' && config && config.esContribuyenteEspecial !== true) return false;
    return (practica ? practica.has(k) : (config ? puedePracticar(k, config) : false));
  };

  if (retiene('iva') && !o.retencion_iva_path && !ya?.has('iva')) out.push('iva');
  if (retiene('islr') && !o.retencion_islr_path && !ya?.has('islr')) out.push('islr');
  if (retiene('municipal') && !o.retencion_municipal_path && !ya?.has('municipal')) out.push('municipal');

  return filtrarActivos(out, activos);
}

/**
 * Determina los impuestos aplicables por defecto para una factura de buzón
 * según la práctica y configuración de la empresa receptora.
 */
export function impuestosAplicablesBuzon(
  practica: Set<ImpuestoPendiente> | null,
  config?: ConfigRetencion | null,
  activos?: Set<string> | null,
): ImpuestoPendiente[] {
  const out: ImpuestoPendiente[] = [];
  const retiene = (k: ImpuestoPendiente) => {
    if (k === 'iva' && config && config.esContribuyenteEspecial !== true) return false;
    return (practica ? practica.has(k) : (config ? puedePracticar(k, config) : false));
  };

  if (retiene('iva')) out.push('iva');
  if (retiene('islr')) out.push('islr');
  if (retiene('municipal')) out.push('municipal');

  return filtrarActivos(out, activos ?? null);
}

export interface ConstruirColaParams {
  empresaId: string | null;
  esGt: boolean;
  facturasBuzon: FacturaBuzon[];
  facturasCompras: FacturaDeOrigen[];
  pendientesOrdenes: RetencionItem[];
  todasOrdenes?: RetencionItem[];
  directosExtra?: Map<string, DatosDirectoExtra>;
  soportesFisicos?: SoportesFisicosMap;
  registradas: Registradas;
  practica: Set<ImpuestoPendiente> | null;
  configFiscal?: ConfigRetencion | null;
  impuestosActivos?: Set<string> | null;
}

/**
 * Construye la lista unificada de facturas con archivo para la empresa seleccionada.
 */
export function construirColaPorHacer({
  empresaId,
  esGt,
  facturasBuzon,
  facturasCompras,
  pendientesOrdenes,
  todasOrdenes,
  directosExtra,
  soportesFisicos,
  registradas,
  practica,
  configFiscal,
  impuestosActivos,
}: ConstruirColaParams): ItemColaPorHacer[] {
  const items: ItemColaPorHacer[] = [];
  const idEmpresaActual = empresaId ?? (esGt ? 'empresa-golden-touch' : '');

  // 1. Facturas del Buzón Móvil
  // Solo facturas que pertenecen a la empresa seleccionada y tienen al menos un archivo adjunto
  const impsBuzon = impuestosAplicablesBuzon(practica, configFiscal, impuestosActivos);
  for (const b of facturasBuzon) {
    // Estatus debe ser recibida o en_revision
    if (b.estatus !== 'recibida' && b.estatus !== 'en_revision') continue;

    // Filtro por empresa
    const empBuzon = b.empresaId || 'empresa-golden-touch';
    if (esGt) {
      if (empBuzon !== 'empresa-golden-touch' && !esEmpresaGt({ id: empBuzon })) continue;
    } else {
      if (empBuzon !== idEmpresaActual) continue;
    }

    // REGLA: Debe tener soporte adjunto
    if (!b.adjuntos || b.adjuntos.length === 0) continue;

    const soporte = resolverSoporteFisicoClave(`buzon-${b.id}`, null, soportesFisicos);

    items.push({
      id: `buzon-${b.id}`,
      origen: 'buzon',
      empresaId: b.empresaId,
      empresaNombre: b.empresaNombre,
      codigo: rotuloNumeroFactura(b.facturaNumero),
      tipoDocumento: rotuloTipoDocumento(b.tipoDocumento),
      proveedorNombre: b.proveedorNombre || 'Proveedor por definir',
      proveedorRif: b.proveedorRif || null,
      fecha: b.facturaFecha || b.createdAt.slice(0, 10),
      moneda: b.moneda,
      total: b.montoTotal,
      ivaMonto: null,
      baseImponible: b.montoTotal,
      archivoNombre: b.adjuntos[0]?.nombre || b.adjuntos[0]?.nombreOriginal || 'Soporte adjunto',
      archivoPath: b.adjuntos[0]?.path,
      adjuntosCount: b.adjuntos.length,
      impuestosPendientes: impsBuzon,
      retencionesCargadasCount: 0,
      totalImpuestosCount: impsBuzon.length,
      soporteFisico: soporte,
      rawBuzon: b,
    });
  }

  // 2. Facturas de Compras (solo para Golden Touch / ciclo de compras)
  if (esGt) {
    const ordenesCubiertasPorArchivo = new Set<string>();

    // Mapa unificado de órdenes conocidas (pendientes + hechas + resueltas por ID)
    const ordenesMap = new Map<string, RetencionItem>();
    for (const item of (todasOrdenes ?? pendientesOrdenes)) {
      if (item?.orden?.id) ordenesMap.set(item.orden.id, item);
    }

    for (const fc of facturasCompras) {
      // Debe tener archivo (f.path o adjuntoId)
      if (!fc.path && !fc.adjuntoId) continue;

      if (fc.origen.tipo === 'oc') {
        ordenesCubiertasPorArchivo.add(fc.origen.id);

        const ordenItemAsoc = ordenesMap.get(fc.origen.id);
        const orden = ordenItemAsoc?.orden;

        // Si la orden existe y fue cancelada/desistida/rechazada, no se retiene
        if (orden && ESTADOS_NUNCA_RETENCION.includes(orden.estado)) {
          continue;
        }

        const pends = orden
          ? impuestosPendientesDeOrden(orden, registradas, practica, configFiscal, impuestosActivos)
          : impsBuzon;

        // Si la orden ya está finalizada o no tiene impuestos pendientes y ya tiene registros en el libro, saltar
        if (orden && orden.retencion_finalizada && pends.length === 0) {
          continue;
        }
        if (orden && pends.length === 0 && registradas.get(orden.id)?.size) {
          continue;
        }

        const totalImp = orden
          ? filtrarActivos(IMPUESTOS_PENDIENTES.map((t) => t.key), impuestosActivos).length
          : impsBuzon.length;

        // Proveedor y código con resolución garantizada: NUNCA "Orden de compra" como proveedor
        const cod = orden ? (orden.oc_codigo ?? orden.codigo) : (fc.origen.id ? `OC (${fc.origen.id.slice(0, 8)})` : NOMBRE_ORIGEN[fc.origen.tipo]);
        const provNombre = (ordenItemAsoc?.proveedorNombre && ordenItemAsoc.proveedorNombre !== '—')
          ? ordenItemAsoc.proveedorNombre
          : 'Proveedor no identificado';

        const soporte = resolverSoporteFisicoClave(`compras-${fc.adjuntoId}`, fc.origen.id, soportesFisicos);

        items.push({
          id: `compras-${fc.adjuntoId}`,
          origen: 'compras_archivo',
          empresaId: 'empresa-golden-touch',
          empresaNombre: 'Golden Touch',
          codigo: cod,
          tipoDocumento: 'Factura',
          proveedorNombre: provNombre,
          proveedorRif: null,
          fecha: orden?.metodo_pago_en?.slice(0, 10) ?? orden?.created_at?.slice(0, 10) ?? fc.subidoEn?.slice(0, 10),
          moneda: (orden?.total_moneda === 'Bs' ? 'Bs' : 'USD'),
          total: orden?.total ?? 0,
          ivaMonto: orden?.iva_monto ?? null,
          baseImponible: orden ? Math.max(0, orden.total - (orden.iva_monto ?? 0) - (orden.igtf_monto ?? 0)) : null,
          archivoNombre: fc.nombre || 'Factura de compra',
          archivoPath: fc.path,
          archivoBucket: fc.bucket,
          adjuntosCount: 1,
          impuestosPendientes: pends,
          retencionesCargadasCount: Math.max(0, totalImp - pends.length),
          totalImpuestosCount: totalImp,
          soporteFisico: soporte,
          rawFacturaOrigen: fc,
          rawOrdenItem: ordenItemAsoc,
        });
      } else {
        // compra_directa o servicio_directo
        const extra = directosExtra?.get(fc.origen.id);
        const cod = extra?.codigo || `${NOMBRE_ORIGEN[fc.origen.tipo]}`;
        const provNombre = extra?.proveedorNombre || 'Proveedor compras directas';
        const total = extra?.total ?? 0;
        const moneda = extra?.moneda ?? 'USD';
        const soporte = resolverSoporteFisicoClave(`compras-${fc.adjuntoId}`, fc.origen.id, soportesFisicos);

        items.push({
          id: `compras-${fc.adjuntoId}`,
          origen: 'compras_archivo',
          empresaId: 'empresa-golden-touch',
          empresaNombre: 'Golden Touch',
          codigo: cod,
          tipoDocumento: 'Factura',
          proveedorNombre: provNombre,
          proveedorRif: extra?.proveedorRif || null,
          fecha: fc.subidoEn?.slice(0, 10),
          moneda,
          total,
          ivaMonto: null,
          baseImponible: total,
          archivoNombre: fc.nombre || 'Factura de compra',
          archivoPath: fc.path,
          archivoBucket: fc.bucket,
          adjuntosCount: 1,
          impuestosPendientes: impsBuzon,
          retencionesCargadasCount: 0,
          totalImpuestosCount: impsBuzon.length,
          soporteFisico: soporte,
          rawFacturaOrigen: fc,
          rawOrdenItem: undefined,
        });
      }
    }

    // 3. Órdenes con factura de recepción que no estén cubiertas por un archivo de Compras
    for (const item of pendientesOrdenes) {
      const o = item.orden;

      // Si ya está cubierta por un archivo en facturasCompras, no duplicar
      if (ordenesCubiertasPorArchivo.has(o.id)) continue;

      // REGLA: Solo si tiene archivo adjunto de recepción
      if (!o.factura_recepcion_path) continue;

      const pends = impuestosPendientesDeOrden(o, registradas, practica, configFiscal, impuestosActivos);
      const totalImp = filtrarActivos(IMPUESTOS_PENDIENTES.map((t) => t.key), impuestosActivos).length;

      // Si no tiene impuestos pendientes y no tiene nada registrado, saltar
      if (pends.length === 0 && !registradas.get(o.id)?.size) continue;

      const soporte = resolverSoporteFisicoClave(`orden-${o.id}`, o.id, soportesFisicos);

      items.push({
        id: `orden-${o.id}`,
        origen: 'compras_orden',
        empresaId: 'empresa-golden-touch',
        empresaNombre: 'Golden Touch',
        codigo: o.oc_codigo ?? o.codigo,
        tipoDocumento: 'Factura',
        proveedorNombre: item.proveedorNombre,
        proveedorRif: null,
        fecha: (o.metodo_pago_en ?? o.created_at ?? '').slice(0, 10),
        moneda: o.total_moneda === 'Bs' ? 'Bs' : 'USD',
        total: o.total,
        ivaMonto: o.iva_monto,
        baseImponible: Math.max(0, o.total - (o.iva_monto ?? 0) - (o.igtf_monto ?? 0)),
        archivoNombre: o.factura_recepcion_nombre || 'Factura recepción',
        archivoPath: o.factura_recepcion_path,
        archivoBucket: 'compras-oc',
        adjuntosCount: 1,
        impuestosPendientes: pends,
        retencionesCargadasCount: Math.max(0, totalImp - pends.length),
        totalImpuestosCount: totalImp,
        soporteFisico: soporte,
        rawOrdenItem: item,
      });
    }
  }

  // Ordenar por fecha descendente por defecto (más recientes primero)
  items.sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));

  return items;
}

