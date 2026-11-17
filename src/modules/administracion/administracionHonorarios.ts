/* ============================================================
   Golden Touch · Administración · Honorarios (lógica pura)
   Saldo, estado derivado y estado de cuenta por profesional.
   Monedas POR MONEDA NATIVA: USD y Bs se suman por separado, nunca
   se reconvierten (igual criterio que el reporte de Tesorería).
   ============================================================ */
import type { DocumentoEmpresa, EnvioTesoreria, EstadoGestion, Gestion, Profesional } from './admin.repository';
import type { Moneda } from './administracionCalculo';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Envíos PAGADOS de una gestión concreta. */
export function enviosPagadosDeGestion(gestionId: string, envios: EnvioTesoreria[]): EnvioTesoreria[] {
  return envios.filter((e) => e.gestionId === gestionId && e.estado === 'pagado');
}

/** Saldo = costoTotal − Σ(envíos PAGADOS de esa gestión). Nunca negativo. */
export function saldoGestion(gestion: Gestion, envios: EnvioTesoreria[]): number {
  const pagado = enviosPagadosDeGestion(gestion.id, envios).reduce((a, e) => a + (Number(e.monto) || 0), 0);
  return r2(Math.max(0, (Number(gestion.costoTotal) || 0) - pagado));
}

/** Lo que aún se puede ENVIAR a Tesorería sin sobre-comprometer la gestión:
 *  costo − Σ(pagados) − Σ(enviados pendientes). A diferencia de `saldoGestion`
 *  (que solo mira pagados, para que la reversa cuadre), este tope CUENTA lo ya
 *  enviado-pendiente, para no comprometer dos veces el mismo honorario. */
export function disponibleParaEnviar(gestion: Gestion, envios: EnvioTesoreria[]): number {
  const comprometido = envios
    .filter((e) => e.gestionId === gestion.id && (e.estado === 'pagado' || e.estado === 'enviado'))
    .reduce((a, e) => a + (Number(e.monto) || 0), 0);
  return r2(Math.max(0, (Number(gestion.costoTotal) || 0) - comprometido));
}

/** Estado mostrado: 'anulada' manda; si saldo 0 → 'saldada'; si hay pago parcial → 'parcial'; si no → 'abierta'. */
export function estadoGestion(gestion: Gestion, envios: EnvioTesoreria[]): EstadoGestion {
  if (gestion.estado === 'anulada') return 'anulada';
  const pagados = enviosPagadosDeGestion(gestion.id, envios);
  const saldo = saldoGestion(gestion, envios);
  if (saldo <= 0 && (Number(gestion.costoTotal) || 0) > 0) return 'saldada';
  if (pagados.length > 0) return 'parcial';
  return 'abierta';
}

/** Un envío solo se puede reversar si aún NO se ha pagado (según su propio estado). */
export function puedeReversarEnvio(envio: EnvioTesoreria): boolean {
  return envio.estado === 'enviado';
}

/** Motivo por el que NO se puede reversar, o null si sí se puede. Usa el estado
 *  AUTORITATIVO del servicio directo (`servicioPagado`), no solo el del envío: si
 *  Tesorería ya pagó y el envío aún no se refrescó, igual se bloquea. */
export function motivoNoReversable(envio: EnvioTesoreria, servicioPagado: boolean): string | null {
  if (envio.estado === 'pagado' || servicioPagado) {
    return 'Este envío ya fue pagado por Tesorería; no se puede reversar (reábrelo en Tesorería).';
  }
  if (envio.estado !== 'enviado') {
    return 'Solo se puede reversar un envío que aún no se ha pagado.';
  }
  return null;
}

/** Nota que Tesorería ve para reconocer envíos del MISMO honorario (parciales = N cuentas). */
export function notaAgrupacion(profesionalNombre: string, concepto: string, empresaClave: string): string {
  return `Honorario · ${profesionalNombre} · ${concepto} · ${empresaClave}`;
}

export interface LineaEstadoCuenta {
  gestion: Gestion;
  enviado: number; // Σ envíos enviado + pagado (lo comprometido)
  pagado: number;  // Σ envíos pagado
  saldo: number;
  estado: EstadoGestion;
}
export interface SubtotalMoneda {
  moneda: Moneda;
  costo: number;
  enviado: number;
  pagado: number;
  saldo: number;
}
export interface EstadoCuentaProfesional {
  lineas: LineaEstadoCuenta[];
  porMoneda: SubtotalMoneda[];
}

/** Estado de cuenta de un profesional: una línea por gestión + subtotales POR MONEDA (sin reconvertir).
 *  Las gestiones anuladas aparecen como línea pero no cuentan en costo/saldo de los subtotales. */
export function estadoCuentaProfesional(
  profesionalId: string,
  gestiones: Gestion[],
  envios: EnvioTesoreria[],
): EstadoCuentaProfesional {
  const propias = gestiones.filter((g) => g.profesionalId === profesionalId);

  const lineas: LineaEstadoCuenta[] = propias.map((gestion) => {
    const deEsta = envios.filter((e) => e.gestionId === gestion.id);
    const enviado = r2(deEsta.filter((e) => e.estado === 'enviado' || e.estado === 'pagado').reduce((a, e) => a + (Number(e.monto) || 0), 0));
    const pagado = r2(deEsta.filter((e) => e.estado === 'pagado').reduce((a, e) => a + (Number(e.monto) || 0), 0));
    return { gestion, enviado, pagado, saldo: saldoGestion(gestion, envios), estado: estadoGestion(gestion, envios) };
  });

  const porMonedaMap = new Map<Moneda, SubtotalMoneda>();
  for (const l of lineas) {
    if (l.gestion.estado === 'anulada') continue; // anuladas no suman al subtotal
    const m = l.gestion.moneda;
    const sub = porMonedaMap.get(m) ?? { moneda: m, costo: 0, enviado: 0, pagado: 0, saldo: 0 };
    sub.costo = r2(sub.costo + (Number(l.gestion.costoTotal) || 0));
    sub.enviado = r2(sub.enviado + l.enviado);
    sub.pagado = r2(sub.pagado + l.pagado);
    sub.saldo = r2(sub.saldo + l.saldo);
    porMonedaMap.set(m, sub);
  }

  return { lineas, porMoneda: Array.from(porMonedaMap.values()).sort((a, b) => a.moneda.localeCompare(b.moneda)) };
}

export interface GrupoProfesional {
  profesional: Profesional;
  cuenta: EstadoCuentaProfesional;
}

/** Agrupa gestiones por profesional para el tablero de honorarios: solo los profesionales
 *  con al menos una gestión, ordenados por nombre. Las gestiones de un profesional
 *  desconocido (id nulo o no listado) se omiten (no revientan la vista). */
export function agrupaPorProfesional(
  gestiones: Gestion[],
  envios: EnvioTesoreria[],
  profesionales: Profesional[],
): GrupoProfesional[] {
  const conGestiones = new Set(gestiones.map((g) => g.profesionalId).filter((id): id is string => !!id));
  return profesionales
    .filter((p) => conGestiones.has(p.id))
    .map((profesional) => ({ profesional, cuenta: estadoCuentaProfesional(profesional.id, gestiones, envios) }))
    .sort((a, b) => a.profesional.nombre.localeCompare(b.profesional.nombre, 'es'));
}

/** Lo que hay que mostrar en un documento sobre la gestion que lo tramito. */
export interface GestionDelDocumento {
  gestion: Gestion;
  profesionalNombre: string;
  /** Cuantos documentos cubre esa misma gestion. Si son varios, el costo NO se
   *  reparte ni se multiplica: es UN solo honorario que cubre a todos. */
  documentosQueCubre: number;
}

/**
 * Que gestion de honorarios tramito este documento (11/11/2026).
 *
 * Antes el costo se anotaba suelto en el documento y no llegaba nunca al estado
 * de cuenta del profesional: el mismo dinero en dos sitios sin relacion. Ahora
 * el documento se engancha a una gestion y la gestion es la unica autoridad
 * sobre el monto.
 */
export function gestionDelDocumento(
  doc: DocumentoEmpresa,
  gestiones: Gestion[],
  documentos: DocumentoEmpresa[],
  profesionales: { id: string; nombre: string }[],
): GestionDelDocumento | null {
  const id = doc.gestionId;
  if (!id) return null;
  const gestion = gestiones.find((g) => g.id === id);
  if (!gestion) return null;
  const prof = profesionales.find((p) => p.id === gestion.profesionalId);
  return {
    gestion,
    profesionalNombre: prof?.nombre?.trim() || 'Profesional sin identificar',
    documentosQueCubre: documentos.filter((d) => d.gestionId === id).length,
  };
}
