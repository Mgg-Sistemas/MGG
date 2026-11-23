/* ============================================================
   Mineral Group Guayana · Proveedores · Resumen del directorio para WhatsApp
   (03/11/2026)

   El mismo directorio del reporte, en texto PUNTUAL para mandarlo por el chat
   sin abrir el sistema del otro lado: un proveedor (o grupo) por renglón y, al
   final, el total. Si el ámbito «histórico de compras» está activo, cada
   renglón lleva su monto comprado y el total consolidado en $.

   CON emojis, igual que Tesorería (textoWhatsappTesoreria): un emoji de
   encabezado, un marcador por renglón y 📇 en el total.

   Builder PURO sobre las filas ya procesadas (FilaReporteProveedor): no toca
   Supabase ni la pantalla, así el formato se fija con un test propio.
   ============================================================ */
import { identidadEmpresa } from '@/shared/lib/empresa';
import type { FilaReporteProveedor, ModoAgrupacionProveedor } from './proveedoresMoldeable';

/** Emoji de encabezado por dimensión (uno distinto, de un vistazo). */
const EMOJI_MODO: Record<ModoAgrupacionProveedor, string> = {
  detallado: '📇',
  categoria: '🏷️',
  origen: '🌎',
  estado: '🔖',
  actividad: '🏭',
};

/** Nombre de cada dimensión para el encabezado. */
const TITULO_MODO: Record<ModoAgrupacionProveedor, string> = {
  detallado: 'Directorio de proveedores',
  categoria: 'Proveedores por categoría',
  origen: 'Proveedores por origen',
  estado: 'Proveedores por estado',
  actividad: 'Proveedores por actividad económica',
};

/** Tope de ítems listados: más allá, el mensaje dejaría de ser puntual. */
const LIMITE_ITEMS = 40;

/** Número con separador de miles VE y dos decimales, sin símbolo. */
function num(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Texto a una sola línea (en el chat un salto partiría el renglón). */
function unaLinea(s: string | null | undefined): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/** Nombre de la fila: razón social (detallado) o la etiqueta del grupo. */
function etiquetaFila(f: FilaReporteProveedor): string {
  return unaLinea(f.razon_social) || unaLinea(f.rif) || '—';
}

/** Dato de apoyo del renglón: monto comprado, conteo de grupo, u origen/estado. */
function colaFila(f: FilaReporteProveedor, conCompras: boolean): string {
  if (conCompras && f.monto_comprado != null) {
    const ord = f.num_ordenes != null ? ` · ${f.num_ordenes} compra(s)` : '';
    return `*$ ${num(f.monto_comprado)}*${ord}`;
  }
  if (f.total_proveedores != null && f.total_proveedores > 0 && !f.rif) {
    return `*${f.total_proveedores}* proveedor(es)`;
  }
  const extra = [f.origen, f.estado].filter(Boolean).join(' · ');
  return extra || '';
}

export interface OpcionesWhatsappProveedores {
  agrupacion: ModoAgrupacionProveedor;
  /** Cómo se filtró la lista (para el subtítulo); vacío = sin filtro. */
  filtro?: string;
  /** El ámbito «histórico de compras» está activo (muestra montos). */
  conCompras?: boolean;
}

/**
 * Arma el aviso de WhatsApp del directorio de proveedores.
 * Cada renglón es un proveedor (o grupo) con su dato de apoyo; el total es el
 * conteo y, si hay compras, el monto consolidado en $.
 */
export function textoWhatsappProveedores(filas: FilaReporteProveedor[], opts: OpcionesWhatsappProveedores): string {
  const emp = identidadEmpresa('GT');
  const conCompras = opts.conCompras === true;

  const L: string[] = [];
  L.push(`${EMOJI_MODO[opts.agrupacion]} *Proveedores — ${TITULO_MODO[opts.agrupacion]}*`);
  L.push(`_${emp.nombre}${opts.filtro ? ` · ${unaLinea(opts.filtro)}` : ''}_`);
  L.push('');

  if (!filas.length) {
    L.push('Sin proveedores con los filtros aplicados. ✅');
    return L.join('\n');
  }

  filas.slice(0, LIMITE_ITEMS).forEach((f, i) => {
    const cola = colaFila(f, conCompras);
    L.push(`${i + 1}. ${etiquetaFila(f)}${cola ? ` — ${cola}` : ''}`);
  });
  if (filas.length > LIMITE_ITEMS) {
    L.push(`… (+${filas.length - LIMITE_ITEMS} ítem(s) más)`);
  }

  L.push('');
  if (conCompras) {
    let totMonto = 0;
    let totOrdenes = 0;
    for (const f of filas) { totMonto += f.monto_comprado ?? 0; totOrdenes += f.num_ordenes ?? 0; }
    L.push(`📇 *Total (${filas.length}):* $ ${num(totMonto)} en ${totOrdenes} compra(s)`);
  } else {
    L.push(`📇 *Total:* ${filas.length} ítem(s)`);
  }
  return L.join('\n');
}
