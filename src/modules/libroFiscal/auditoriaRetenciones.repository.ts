/* ============================================================
   Golden Touch · Retenciones · Auditoría Fiscal (v8)
   Agrupa y unifica todos los eventos críticos del ciclo tributario:
   1. Emisiones de retención (comprobantes generados).
   2. Anulaciones de comprobantes (con motivo explícito y monto).
   3. Cierres de período («Declarar» con candado fiscal).
   4. Reaperturas de período (con justificación obligatoria).
   5. Decisiones de «No aplica» (motivo legal de exención).
   6. Cambios de sistema declarante.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { listRetenciones, type RetencionPracticada } from './retencionesFiscal.repository';
import { listPeriodos, nombrePeriodo, v3Disponible, type PeriodoFiscal } from './periodosRetencion.repository';
import { rotuloAutor, rotuloImpuesto } from './rotulos';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';

export type AccionAuditoria =
  | 'emision'
  | 'anulacion'
  | 'cierre'
  | 'reapertura'
  | 'no_aplica'
  | 'declara_cambio';

export interface EventoAuditoriaFiscal {
  id: string;
  tipo: AccionAuditoria;
  fechaIso: string;
  usuario: string;
  impuesto: string | null;
  titulo: string;
  referencia: string;
  documentoFiscal?: {
    factura?: string | null;
    control?: string | null;
    fecha?: string | null;
    origen?: string | null;
  } | null;
  contraparte?: {
    nombre: string;
    rif: string | null;
  } | null;
  monto?: {
    retenido: number;
    retenidoBs: number | null;
    moneda: string;
    base?: number;
    pct?: number;
  } | null;
  motivo?: string | null;
  detalle?: string | null;
  severidad: 'normal' | 'alerta' | 'exito' | 'aviso';
}

export interface AuditoriaFiltros {
  tipo?: AccionAuditoria | '';
  impuesto?: string | '';
  desde?: string | '';
  hasta?: string | '';
  texto?: string;
}

export interface ResumenAuditoria {
  total: number;
  emisiones: number;
  anulaciones: number;
  cierres: number;
  reaperturas: number;
  noAplica: number;
}

/** Lee todas las decisiones de «no aplica» si la tabla está disponible */
async function leerDecisionesNoAplica(): Promise<EventoAuditoriaFiscal[]> {
  try {
    const { data, error } = await supabase
      .from('retencion_decisiones')
      .select('id, documento_id, impuesto_clave, decision, motivo_texto, detalle, actualizado_por, created_at')
      .order('created_at', { ascending: false })
      .limit(300);

    if (error || !data) return [];

    return data.map((d: Record<string, unknown>): EventoAuditoriaFiscal => ({
      id: `decision-${d.id}`,
      tipo: 'no_aplica',
      fechaIso: String(d.created_at ?? ''),
      usuario: rotuloAutor(d.actualizado_por as string | null),
      impuesto: String(d.impuesto_clave ?? ''),
      titulo: `Exención «No aplica» retención de ${rotuloImpuesto(d.impuesto_clave)}`,
      referencia: `Documento Fiscal #${String(d.documento_id ?? '').slice(0, 8)}`,
      motivo: (d.motivo_texto as string | null) || (d.detalle as string | null) || 'Exento / Sin retención aplicable',
      detalle: d.detalle && d.motivo_texto ? `Detalle adicional: ${d.detalle}` : null,
      severidad: 'aviso',
    }));
  } catch {
    return [];
  }
}

/** Lee los eventos de períodos (Cierres declarados y Reaperturas auditadas) */
async function leerEventosPeriodos(anioActual: number): Promise<EventoAuditoriaFiscal[]> {
  const conV3 = await v3Disponible().catch(() => false);
  if (!conV3) return [];

  const anios = [anioActual - 1, anioActual, anioActual + 1];
  const eventos: EventoAuditoriaFiscal[] = [];

  for (const anio of anios) {
    try {
      const periodos: PeriodoFiscal[] = await listPeriodos(anio);
      for (const p of periodos) {
        // Cierre / Declaración
        if (p.declaradoEn) {
          eventos.push({
            id: `cierre-${p.id}`,
            tipo: 'cierre',
            fechaIso: p.declaradoEn,
            usuario: rotuloAutor(p.declaradoPor),
            impuesto: p.tipo,
            titulo: `Cierre de período fiscal declarado (🔒)`,
            referencia: `${rotuloImpuesto(p.tipo)} · ${nombrePeriodo(p)}`,
            detalle: `Período fiscal cerrado con candado de seguridad. Retenciones consolidadas para la declaración tributaria.`,
            severidad: 'normal',
          });
        }

        // Reapertura
        if (p.reabiertoEn) {
          eventos.push({
            id: `reapertura-${p.id}-${p.reabiertoEn}`,
            tipo: 'reapertura',
            fechaIso: p.reabiertoEn,
            usuario: rotuloAutor(p.reabiertoPor),
            impuesto: p.tipo,
            titulo: `Reapertura de período fiscal (🔓)`,
            referencia: `${rotuloImpuesto(p.tipo)} · ${nombrePeriodo(p)}`,
            motivo: p.reabiertoMotivo || 'Reapertura de período para ajustes tributarios',
            detalle: `Se levantó el candado del período fiscal para admitir correcciones o incorporaciones de facturas.`,
            severidad: 'alerta',
          });
        }
      }
    } catch {
      // Continuar con los demás años
    }
  }

  return eventos;
}

/** Construye la lista consolidada de auditoría fiscal cronológica */
export async function listEventosAuditoria(): Promise<EventoAuditoriaFiscal[]> {
  const hoy = hoyVenezuela();
  const anioActual = Number(hoy.slice(0, 4)) || new Date().getFullYear();

  const [retenciones, eventosPeriodos, decisiones, provs] = await Promise.all([
    listRetenciones({ incluirAnuladas: true }).catch(() => [] as RetencionPracticada[]),
    leerEventosPeriodos(anioActual),
    leerDecisionesNoAplica(),
    Promise.resolve(supabase.from('proveedores').select('id, rif, razon_social'))
      .then((res) => ((res as { data?: unknown[] })?.data ?? []) as Array<{ id?: string; rif?: string; razon_social?: string }>)
      .catch(() => [] as Array<{ id?: string; rif?: string; razon_social?: string }>),
  ]);

  const mapProveedores = new Map<string, string>();
  for (const p of provs as Array<{ id?: string; rif?: string; razon_social?: string }>) {
    if (p.id && p.razon_social) mapProveedores.set(p.id, p.razon_social);
    if (p.rif && p.razon_social) mapProveedores.set(p.rif.toUpperCase().trim(), p.razon_social);
  }

  const eventosRetenciones: EventoAuditoriaFiscal[] = [];

  for (const r of retenciones) {
    const origenLabel = r.docKind === 'manual'
      ? 'Fuera del sistema (Manual)'
      : r.docKind === 'oc'
        ? 'Orden de Compra (OC)'
        : r.docKind === 'compra_directa'
          ? 'Compra Directa (CD)'
          : r.docKind === 'servicio_directo'
            ? 'Servicio Directo (CS)'
            : r.docId
              ? `Asociado a ${String(r.docKind || 'documento').toUpperCase()}`
              : 'Directo';

    const nombreContraparte = (r.contraparteNombre && r.contraparteNombre !== 'Proveedor no identificado' ? r.contraparteNombre : null)
      || (r.contraparteId ? mapProveedores.get(r.contraparteId) : null)
      || (r.contraparteRif ? mapProveedores.get(r.contraparteRif.toUpperCase().trim()) : null)
      || (r.contraparteRif ? `Sujeto RIF ${r.contraparteRif}` : 'Proveedor / Sujeto no identificado');

    const refEmision = r.numeroComprobante
      ? `Comprobante N° ${r.numeroComprobante}`
      : r.facturaNumero
        ? `Factura N° ${r.facturaNumero}`
        : `Retención de ${rotuloImpuesto(r.tipo)}`;

    const refAnulacion = r.numeroComprobante
      ? `Comprobante N° ${r.numeroComprobante} (ANULADO)`
      : r.facturaNumero
        ? `Factura N° ${r.facturaNumero} (ANULADA)`
        : `Retención de ${rotuloImpuesto(r.tipo)} (ANULADA)`;

    // 1. Emisión
    eventosRetenciones.push({
      id: `emision-${r.id}`,
      tipo: 'emision',
      fechaIso: r.createdAt,
      usuario: rotuloAutor(r.actorName),
      impuesto: r.tipo.toUpperCase(),
      titulo: `Emisión de comprobante de retención (${rotuloImpuesto(r.tipo)})`,
      referencia: refEmision,
      documentoFiscal: {
        factura: r.facturaNumero,
        control: r.facturaControl,
        fecha: r.facturaFecha,
        origen: origenLabel,
      },
      contraparte: {
        nombre: nombreContraparte,
        rif: r.contraparteRif,
      },
      monto: {
        retenido: r.montoRetenido,
        retenidoBs: r.montoBs,
        moneda: r.moneda,
        base: r.baseImponible,
        pct: r.porcentaje,
      },
      detalle: r.observacion,
      severidad: 'exito',
    });

    // 2. Anulación (si la retención está anulada)
    if (r.anulada) {
      eventosRetenciones.push({
        id: `anulacion-${r.id}`,
        tipo: 'anulacion',
        fechaIso: r.updatedAt || r.createdAt,
        usuario: rotuloAutor(r.actorName ? `${r.actorName}` : null),
        impuesto: r.tipo.toUpperCase(),
        titulo: `Anulación de comprobante (${rotuloImpuesto(r.tipo)})`,
        referencia: refAnulacion,
        documentoFiscal: {
          factura: r.facturaNumero,
          control: r.facturaControl,
          fecha: r.facturaFecha,
          origen: origenLabel,
        },
        contraparte: {
          nombre: nombreContraparte,
          rif: r.contraparteRif,
        },
        monto: {
          retenido: r.montoRetenido,
          retenidoBs: r.montoBs,
          moneda: r.moneda,
        },
        motivo: r.anuladaMotivo || 'Sin motivo explícito de anulación registrado',
        severidad: 'alerta',
      });
    }
  }

  // Unificar y ordenar cronológicamente (más recientes primero)
  const todos = [...eventosRetenciones, ...eventosPeriodos, ...decisiones];
  todos.sort((a, b) => (b.fechaIso || '').localeCompare(a.fechaIso || ''));

  return todos;
}

/** Calcula el resumen numérico de los eventos de auditoría */
export function calcularResumenAuditoria(eventos: EventoAuditoriaFiscal[]): ResumenAuditoria {
  let emisiones = 0;
  let anulaciones = 0;
  let cierres = 0;
  let reaperturas = 0;
  let noAplica = 0;

  for (const e of eventos) {
    if (e.tipo === 'emision') emisiones++;
    else if (e.tipo === 'anulacion') anulaciones++;
    else if (e.tipo === 'cierre') cierres++;
    else if (e.tipo === 'reapertura') reaperturas++;
    else if (e.tipo === 'no_aplica') noAplica++;
  }

  return {
    total: eventos.length,
    emisiones,
    anulaciones,
    cierres,
    reaperturas,
    noAplica,
  };
}
