/* ============================================================
   MGG · Reporte Dinámico de Pendientes por Recepcionar
   
   Procesa y normaliza tanto las Órdenes de Compra (OC) como las
   Compras Directas pendientes por entrar al inventario.
   Incluye:
     · Analista encargado
     · Fecha en que se montó la orden (creación)
     · Fecha en que pagó Tesorería
     · Sede / almacén sugerido
     · Ítems, unidades y montos ($ / Bs)
     · Métricas y filtros interactivos
     · Formateo de mensaje para WhatsApp
   ============================================================ */

import type { Orden, Almacen } from '@/shared/lib/types';
import type { CompraDirecta } from '@/modules/pedidos/compras.repository';
import { nombrePersonaCompras, derivarNombreDesdeCorreo } from '@/modules/pedidos/personasCompras';
import { skuOGuion } from '@/modules/pedidos/renglonVisible';
import { date, money, num } from '@/shared/lib/format';

export interface ItemRecepcionPendienteDetalle {
  sku?: string;
  nombre: string;
  marca?: string;
  cantidad: number;
  unidad?: string;
  precioUnitario?: number;
  subtotal?: number;
}

export interface FilaRecepcionPendiente {
  id: string;
  tipo: 'oc' | 'directo';
  tipoEtiqueta: string;
  codigo: string;
  fechaMontada: string | null;
  fechaMontadaTxt: string;
  fechaPago: string | null;
  fechaPagoTxt: string;
  pagadaPor: string;
  analista: string;
  proveedor: string;
  almacenSugerido: string;
  itemsCount: number;
  unidades: number;
  monto: number;
  moneda: string;
  estado: string;
  itemsDetalle: ItemRecepcionPendienteDetalle[];
}

export interface FiltrosRecepcionesPendientes {
  texto?: string;
  sede?: string;
  analista?: string;
  tipo?: 'todos' | 'oc' | 'directo';
  desde?: string;
  hasta?: string;
  criterioFecha?: 'montada' | 'pago';
}

export interface TotalesRecepcionesPendientes {
  totalRegistros: number;
  totalOc: number;
  totalDirectos: number;
  totalItems: number;
  totalUnidades: number;
  totalUsd: number;
  totalBs: number;
  sedes: string[];
  analistas: string[];
}

/** Resuelve el nombre visible del analista o responsable de la orden. */
export function analistaDeOrden(o: Partial<Orden>): string {
  const identificador = o.oc_creada_por || o.oc_emitida_por || o.solicitante_email;
  const nombre = nombrePersonaCompras(identificador);
  if (nombre) return nombre;
  if (o.solicitante && !o.solicitante.includes('@')) return o.solicitante;
  return derivarNombreDesdeCorreo(identificador || '') || '—';
}

/** Obtiene el nombre visible de la sede/almacén sugerido. */
export function nombreSedeAlmacen(idOrNombre: string | null | undefined, almacenes: Almacen[]): string {
  if (!idOrNombre) return 'Sin asignar';
  const alm = almacenes.find((a) => a.id === idOrNombre || a.nombre === idOrNombre || a.sede === idOrNombre);
  return alm?.sede || alm?.nombre || idOrNombre;
}

/** Transforma las órdenes y compras directas en filas homogéneas para el reporte. */
export function armarFilasRecepcionesPendientes(
  ordenes: Orden[] = [],
  compras: CompraDirecta[] = [],
  almacenes: Almacen[] = [],
  proveedoresMap?: Map<string, string>,
): FilaRecepcionPendiente[] {
  const out: FilaRecepcionPendiente[] = [];

  for (const o of ordenes) {
    const items = Array.isArray(o.items) ? o.items : [];
    const itemsCount = items.length;
    const unidades = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
    const provNombre = (o.proveedor_id && proveedoresMap?.get(o.proveedor_id)) || '—';

    out.push({
      id: o.id,
      tipo: 'oc',
      tipoEtiqueta: 'Orden de Compra',
      codigo: o.oc_codigo || o.codigo || '—',
      fechaMontada: o.created_at || null,
      fechaMontadaTxt: date(o.created_at) || '—',
      fechaPago: o.pagada_en || null,
      fechaPagoTxt: o.pagada_en ? date(o.pagada_en) : 'Pendiente de pago',
      pagadaPor: o.pagada_por || '',
      analista: analistaDeOrden(o),
      proveedor: provNombre,
      almacenSugerido: nombreSedeAlmacen(o.almacen_destino, almacenes),
      itemsCount,
      unidades,
      monto: Number(o.total) || 0,
      moneda: o.moneda || 'USD',
      estado: o.estado === 'pagada' ? 'Pagada' : o.estado === 'por_recibir' ? 'Por recibir' : o.estado,
      itemsDetalle: items.map((it) => {
        const cant = Number(it.cantidad) || 0;
        const precio = Number(it.precio) || 0;
        const skuVis = skuOGuion(it);
        return {
          sku: skuVis !== '—' ? skuVis : undefined,
          nombre: it.nombre || 'Material',
          marca: it.marca?.trim() || undefined,
          cantidad: cant,
          unidad: it.unidad || undefined,
          precioUnitario: precio,
          subtotal: Math.round(cant * precio * 100) / 100,
        };
      }),
    });
  }

  for (const c of compras) {
    const items = Array.isArray(c.items) ? c.items : [];
    const itemsCount = items.length;
    const unidades = items.reduce((acc: number, it) => acc + (Number(it.cantidad) || 0), 0);
    const analista = c.actor_name || nombrePersonaCompras(c.actor || c.pagada_por) || derivarNombreDesdeCorreo(c.actor || '') || '—';
    const fechaPago = c.pagada_at || null;
    const fechaPagoTxt = fechaPago
      ? date(fechaPago)
      : c.pagada_por
        ? `Pagada (${c.pagada_por})`
        : 'Pagada';

    out.push({
      id: c.id,
      tipo: 'directo',
      tipoEtiqueta: 'Compra Directa',
      codigo: c.codigo || '—',
      fechaMontada: c.created_at || null,
      fechaMontadaTxt: date(c.created_at) || '—',
      fechaPago,
      fechaPagoTxt,
      pagadaPor: c.pagada_por || '',
      analista,
      proveedor: c.proveedor_nombre || '—',
      almacenSugerido: nombreSedeAlmacen(c.almacen, almacenes),
      itemsCount,
      unidades,
      monto: Number(c.gasto) || 0,
      moneda: c.moneda || 'USD',
      estado: 'Por recibir',
      itemsDetalle: items.map((it) => {
        const cant = Number(it.cantidad) || 0;
        const montoItem = Number(it.gasto) || 0;
        return {
          sku: it.producto_sku?.trim() || undefined,
          nombre: it.producto_nombre || 'Material',
          cantidad: cant,
          unidad: it.unidad || undefined,
          precioUnitario: cant > 0 ? Math.round((montoItem / cant) * 100) / 100 : 0,
          subtotal: montoItem,
        };
      }),
    });
  }

  return out;
}

/** Filtra dinámicamente las filas de recepciones pendientes. */
export function filtrarRecepcionesPendientes(
  filas: FilaRecepcionPendiente[],
  filtros: FiltrosRecepcionesPendientes,
): FilaRecepcionPendiente[] {
  const txt = (filtros.texto ?? '').toLowerCase().trim();
  const sede = (filtros.sede ?? '').trim();
  const analista = (filtros.analista ?? '').trim();
  const tipo = filtros.tipo && filtros.tipo !== 'todos' ? filtros.tipo : null;
  const criterio = filtros.criterioFecha || 'montada';
  const desde = filtros.desde ? `${filtros.desde}T00:00:00` : null;
  const hasta = filtros.hasta ? `${filtros.hasta}T23:59:59` : null;

  return filas.filter((f) => {
    if (tipo && f.tipo !== tipo) return false;
    if (sede && f.almacenSugerido !== sede) return false;
    if (analista && f.analista !== analista) return false;

    if (txt) {
      const matchCodigo = f.codigo.toLowerCase().includes(txt);
      const matchAnalista = f.analista.toLowerCase().includes(txt);
      const matchProv = f.proveedor.toLowerCase().includes(txt);
      const matchSede = f.almacenSugerido.toLowerCase().includes(txt);
      const matchItems = f.itemsDetalle.some((it) => it.nombre.toLowerCase().includes(txt));
      if (!matchCodigo && !matchAnalista && !matchProv && !matchSede && !matchItems) return false;
    }

    const fechaRef = criterio === 'pago' ? f.fechaPago : f.fechaMontada;
    if (desde && (!fechaRef || fechaRef < desde)) return false;
    if (hasta && (!fechaRef || fechaRef > hasta)) return false;

    return true;
  });
}

/** Calcula totales e indicadores dinámicos. */
export function calcularTotalesRecepciones(filas: FilaRecepcionPendiente[]): TotalesRecepcionesPendientes {
  let totalOc = 0;
  let totalDirectos = 0;
  let totalItems = 0;
  let totalUnidades = 0;
  let totalUsd = 0;
  let totalBs = 0;
  const sedesSet = new Set<string>();
  const analistasSet = new Set<string>();

  for (const f of filas) {
    if (f.tipo === 'oc') totalOc++;
    else totalDirectos++;

    totalItems += f.itemsCount;
    totalUnidades += f.unidades;

    if (f.moneda === 'Bs' || f.moneda === 'VES') {
      totalBs += f.monto;
    } else {
      totalUsd += f.monto;
    }

    if (f.almacenSugerido && f.almacenSugerido !== '—') sedesSet.add(f.almacenSugerido);
    if (f.analista && f.analista !== '—') analistasSet.add(f.analista);
  }

  return {
    totalRegistros: filas.length,
    totalOc,
    totalDirectos,
    totalItems,
    totalUnidades,
    totalUsd: Math.round(totalUsd * 100) / 100,
    totalBs: Math.round(totalBs * 100) / 100,
    sedes: Array.from(sedesSet).sort(),
    analistas: Array.from(analistasSet).sort(),
  };
}

/** Genera el mensaje formateado para enviar por WhatsApp. */
export function textoReporteRecepcionesWhatsapp(
  filas: FilaRecepcionPendiente[],
  filtros?: FiltrosRecepcionesPendientes,
  actor?: string,
): string {
  const totales = calcularTotalesRecepciones(filas);
  const ahora = new Date();
  const fechaStr = ahora.toLocaleDateString('es-VE');
  const horaStr = ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

  const lineas: string[] = [];
  lineas.push('📦 *MINERAL GROUP GUAYANA C.A.*');
  lineas.push('📋 *REPORTE DE PENDIENTES POR RECEPCIONAR*');
  lineas.push('🚨 *NO HA LLEGADO A ALMACEN DAR STATUS*');
  lineas.push(`📅 *Fecha de emisión:* ${fechaStr} · ${horaStr}`);
  if (actor) lineas.push(`👤 *Generado por:* ${actor}`);

  if (filtros?.sede) lineas.push(`🏢 *Sede / Almacén:* ${filtros.sede}`);
  if (filtros?.analista) lineas.push(`👥 *Analista filtrado:* ${filtros.analista}`);

  lineas.push('');
  lineas.push('📊 *RESUMEN DE PENDIENTES:*');
  lineas.push(`• *Total pendientes:* ${totales.totalRegistros} (${totales.totalOc} OC · ${totales.totalDirectos} Compras directas)`);
  lineas.push(`• *Total ítems:* ${totales.totalItems} (${totales.totalUnidades} und. estimadas)`);
  if (totales.totalUsd > 0) lineas.push(`• *Monto en divisas:* ${money(totales.totalUsd, 'USD')}`);
  if (totales.totalBs > 0) lineas.push(`• *Monto en bolívares:* ${money(totales.totalBs, 'Bs')}`);
  lineas.push('');

  if (!filas.length) {
    lineas.push('✅ _No hay mercancía pendiente por recepcionar con los filtros actuales._');
    return lineas.join('\n');
  }

  lineas.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lineas.push('📝 *DETALLE DE ÓRDENES POR RECIBIR:*');
  lineas.push('━━━━━━━━━━━━━━━━━━━━━━━━');

  filas.forEach((f, idx) => {
    lineas.push(`${idx + 1}. 🔹 *${f.codigo}* (${f.estado})`);
    lineas.push(`   ⚠️ *NO HA LLEGADO A ALMACEN DAR STATUS*`);
    lineas.push(`   📅 *Montada:* ${f.fechaMontadaTxt}`);
    lineas.push(`   💳 *Pagó Tesorería:* ${f.fechaPagoTxt}`);
    lineas.push(`   👤 *Analista:* ${f.analista}`);
    if (f.proveedor && f.proveedor !== '—') lineas.push(`   🏭 *Proveedor:* ${f.proveedor}`);
    lineas.push(`   🏢 *Destino sugerido:* ${f.almacenSugerido}`);
    lineas.push(`   📦 *Ítems:* ${f.itemsCount} ítem(s) · ${f.unidades} und.`);
    lineas.push(`   💰 *Monto:* ${money(f.monto, f.moneda)}`);

    if (f.itemsDetalle.length > 0) {
      const resumenItems = f.itemsDetalle.slice(0, 3).map((it) => `${it.nombre} (${it.cantidad}${it.unidad ? ` ${it.unidad}` : ''})`).join(', ');
      const resto = f.itemsDetalle.length > 3 ? ` y ${f.itemsDetalle.length - 3} más…` : '';
      lineas.push(`   🛒 _${resumenItems}${resto}_`);
    }

    lineas.push('────────────────────────');
  });

  lineas.push('');
  lineas.push('🚨 *NO HA LLEGADO A ALMACEN DAR STATUS*');
  lineas.push('ℹ️ _Favor coordinar con el equipo de compras/logística para dar entrada oportuna en inventario._');

  return lineas.join('\n');
}

/** Genera el mensaje de WhatsApp detallado para UNA orden o compra directa específica pendiente por recepcionar. */
export function textoOrdenPendienteWhatsapp(
  fila: FilaRecepcionPendiente,
  actor?: string,
  itemsPersonalizados?: ItemRecepcionPendienteDetalle[],
): string {
  const ahora = new Date();
  const fechaStr = ahora.toLocaleDateString('es-VE');
  const horaStr = ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
  const items = itemsPersonalizados ?? fila.itemsDetalle;
  const totalUnidades = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);

  const lineas: string[] = [];
  lineas.push('📦 *MINERAL GROUP GUAYANA C.A.*');
  lineas.push(`📋 *ORDEN PENDIENTE POR RECEPCIONAR · ${fila.codigo}*`);
  lineas.push('🚨 *NO HA LLEGADO A ALMACEN DAR STATUS*');
  lineas.push(`📅 *Fecha de emisión:* ${fechaStr} · ${horaStr}`);
  if (actor) lineas.push(`👤 *Generado por:* ${actor}`);
  lineas.push('');
  lineas.push(`🔹 *Documento:* ${fila.codigo} (${fila.tipoEtiqueta} · ${fila.estado})`);
  lineas.push(`📅 *Montada:* ${fila.fechaMontadaTxt}`);
  lineas.push(`💳 *Pagó Tesorería:* ${fila.fechaPagoTxt}`);
  lineas.push(`👤 *Analista:* ${fila.analista}`);
  if (fila.proveedor && fila.proveedor !== '—') {
    lineas.push(`🏭 *Proveedor:* ${fila.proveedor}`);
  }
  lineas.push(`🏢 *Destino sugerido:* ${fila.almacenSugerido}`);
  lineas.push(`💰 *Monto total:* ${money(fila.monto, fila.moneda)}`);
  lineas.push('');
  lineas.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  lineas.push(`📦 *MATERIALES POR RECIBIR (${items.length} ítem${items.length === 1 ? '' : 's'} · ${num(totalUnidades)} und.):*`);
  lineas.push('━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!items.length) {
    lineas.push('• _Sin renglones que coincidan con el filtro._');
  } else {
    items.forEach((it, idx) => {
      const skuTxt = it.sku ? ` · \`${it.sku}\`` : '';
      const marcaTxt = it.marca ? ` · Marca: ${it.marca}` : '';
      const cantTxt = `${num(it.cantidad)}${it.unidad ? ` ${it.unidad}` : ' und.'}`;
      lineas.push(`${idx + 1}. 📦 *${it.nombre}*${skuTxt}${marcaTxt} — *${cantTxt}*`);
    });
  }

  lineas.push('');
  lineas.push('🚨 *NO HA LLEGADO A ALMACEN DAR STATUS*');
  lineas.push('ℹ️ _Favor informar estatus de despacho/entrega para recepcionar esta orden en almacén._');

  return lineas.join('\n');
}
