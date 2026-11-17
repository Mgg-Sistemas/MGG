/* ============================================================
   MGG · Pre-salidas de Almacén (Borradores de Salida para WhatsApp)
   17-11-2026.
   Permite al almacenista preparar una pre-salida con sus materiales,
   compartirla al grupo de WhatsApp para que el supervisor o persona
   autorizada apruebe por ese medio, editar el borrador si hay cambios,
   y finalmente ejecutar la salida oficial con su autorizado.
   No descuenta inventario hasta su confirmación final.
   ============================================================ */
import { nombreAlmacenVisible } from './sectorizacion';
import { num } from './inventarioTelefono';
import { fechaHoraVE } from './inventarioTelefono';

export interface LineaPreSalida {
  productoId: string;
  productoNombre: string;
  sku: string;
  categoria?: string;
  unidad: string;
  cantidad: number;
}

export interface PreSalida {
  id: string;
  codigo: string;
  almacen: string;
  motivo: string;
  retorna: boolean;
  equipo?: { id: string; nombre: string } | null;
  tipoMant?: string | null;
  lineas: LineaPreSalida[];
  estado: 'pendiente' | 'procesada' | 'descartada';
  autorizadoPor?: string | null;
  salidaCodigo?: string | null;
  actor: string;
  actorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PreSalidaInput {
  id?: string;
  codigo?: string;
  almacen: string;
  motivo: string;
  retorna: boolean;
  equipo?: { id: string; nombre: string } | null;
  tipoMant?: string | null;
  lineas: LineaPreSalida[];
  actor: string;
  actorName: string | null;
}

/** Genera el siguiente código correlativo de pre-salida: ej. PRE-2026-0001 */
export function siguienteCodigoPreSalida(existentes: Array<{ codigo?: string | null }>, ano = new Date().getFullYear()): string {
  const prefijo = `PRE-${ano}-`;
  let max = 0;
  for (const item of existentes) {
    const c = (item.codigo ?? '').trim().toUpperCase();
    if (c.startsWith(prefijo)) {
      const n = parseInt(c.slice(prefijo.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    } else if (c.startsWith('PRE-')) {
      const partes = c.split('-');
      const n = parseInt(partes[partes.length - 1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefijo}${String(max + 1).padStart(4, '0')}`;
}

/** Valida los campos de una pre-salida antes de guardarla. */
export function validarPreSalida(d: { lineas: Array<{ cantidad: number; productoNombre?: string }>; motivo: string }): string | null {
  if (!d.lineas.length) return 'Agrega al menos un material a la pre-salida.';
  for (const l of d.lineas) {
    if (!(Number(l.cantidad) > 0)) return `Indica una cantidad válida para ${l.productoNombre || 'el material'}.`;
  }
  if (!d.motivo.trim()) return 'Indica el motivo de la pre-salida (a quién, para qué o a qué equipo).';
  return null;
}

/** Mensaje formateado para enviar al grupo de WhatsApp pidiendo autorización. */
export function mensajePreSalidaWhatsapp(p: PreSalida, quien?: string | null): string {
  const solicitante = quien || p.actorName || p.actor || 'Almacén';
  const l = [
    '⏳ *SOLICITUD DE SALIDA DE ALMACÉN (POR AUTORIZAR)*',
    `🔖 *Código:* ${p.codigo}`,
    `🏬 *Almacén:* ${nombreAlmacenVisible(p.almacen)}`,
    '',
    `📦 *Materiales a despachar (${p.lineas.length}):*`,
    ...p.lineas.map((x) => `• ${x.productoNombre}: ${num(x.cantidad)} ${x.unidad || 'UND'}`),
    '',
    `📝 *Motivo:* ${p.motivo}`,
  ];
  if (p.equipo?.nombre) {
    l.push(`🚜 *Equipo / Destino:* ${p.equipo.nombre}${p.tipoMant ? ` (${p.tipoMant})` : ''}`);
  }
  l.push(p.retorna ? '🔄 *Retorna:* SÍ (temporal)' : '❌ *Retorna:* NO (consumo)');
  l.push(`👷 *Preparado por:* ${solicitante}`);
  l.push(`🕒 *Fecha:* ${fechaHoraVE(p.createdAt)}`);
  l.push('');
  l.push('👉 *Favor responder a este mensaje indicando si está APROBADA la salida de estos materiales.*');
  return l.join('\n');
}

/** Filtra pre-salidas por texto tolerante a tildes y mayúsculas. */
export function filtrarPreSalidas(lista: PreSalida[], busqueda: string): PreSalida[] {
  const q = (busqueda ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!q) return lista;
  return lista.filter((p) => {
    const texto = [
      p.codigo,
      p.almacen,
      p.motivo,
      p.equipo?.nombre ?? '',
      p.actorName ?? '',
      p.actor,
      ...p.lineas.map((l) => `${l.productoNombre} ${l.sku}`),
    ].join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return texto.includes(q);
  });
}
