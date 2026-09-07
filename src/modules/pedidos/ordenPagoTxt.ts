/* ============================================================
   MGG · Compras · TXT de una orden confirmada para pagar
   Formato corto, pensado para pegarlo en WhatsApp: los `*` de los
   rótulos son las negritas de WhatsApp. Lleva lo justo para emitir
   el pago —qué orden, a quién, por qué, cuánto y cómo— sin el
   listado de renglones: quien paga no lo necesita.
   Solo por botón: nunca se descarga solo.
   ============================================================ */
import type { Orden, PagoMetodo } from '@/shared/lib/types';
import { labelMetodoPago } from './pedidos.repository';
import { BANCOS_VE } from '@/shared/lib/bancos';

/** `$79,00` · `Bs 4.500,00`. El símbolo va pegado; «Bs» necesita el espacio. */
export function montoTxt(n: number | null | undefined, moneda = '$'): string {
  const m = (moneda || '$').trim();
  const v = (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return m === '$' ? `$${v}` : `${m} ${v}`;
}

/** `Banco de Venezuela (0102)`: el nombre adelante, que es lo que se busca en la app del banco. */
export function bancoTxt(codigo: string | null | undefined): string {
  const c = (codigo ?? '').trim();
  if (!c) return '';
  const b = BANCOS_VE.find((x) => x.codigo === c);
  return b ? `${b.nombre} (${b.codigo})` : c;
}

/** El porqué de la compra: motivo y finalidad son campos distintos de la OP y
 *  no siempre están los dos; si dicen lo mismo no se repite. Todo en un renglón. */
export function detalleTxt(orden: Pick<Orden, 'motivo' | 'finalidad'>): string {
  const motivo = (orden.motivo ?? '').trim();
  const finalidad = (orden.finalidad ?? '').trim();
  return [motivo, finalidad === motivo ? '' : finalidad]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Los datos del beneficiario, uno por renglón: el archivo se lee para TIPEAR el pago. */
function datosPago(metodo: string, d: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const add = (k: string, v?: string | null) => { if (v && String(v).trim()) out.push(`* ${k}: ${String(v).trim()}`); };
  if (metodo === 'pago_movil') {
    add('Banco', bancoTxt(d.banco)); add('CI/RIF', d.ci_rif); add('Tlf', d.telefono);
  } else if (metodo === 'transferencia') {
    add('Titular', d.nombre); add('CI/RIF', d.ci); add('Banco', bancoTxt(d.banco)); add('Cuenta', d.cuenta);
  } else if (metodo === 'zelle') {
    add('Titular', d.nombre); add('Correo', d.email);
  } else if (metodo === 'binance_usdt') {
    add('Correo/ID', d.email_o_id);
  }
  return out;
}

function bloquePago(patas: PagoMetodo[] | null | undefined, total: number, monedaOrden: string): string[] {
  const list = patas ?? [];
  if (!list.length) return ['💳 *Pago:* (todavía sin método de pago indicado)'];
  const out: string[] = [];
  list.forEach((m) => {
    const moneda = (m.moneda || '$').trim();
    // El monto de la pata se muestra solo cuando aporta algo: si es la única y
    // coincide con el total, ya se leyó dos renglones más arriba.
    const repiteElTotal = list.length === 1 && moneda === monedaOrden && (Number(m.monto) || 0) === (Number(total) || 0);
    const importe = repiteElTotal ? '' : ` ${montoTxt(m.monto, moneda)}`;
    out.push(`💳 *${labelMetodoPago(m.metodo)}:*${importe}`);
    out.push(...datosPago(m.metodo, (m.datos ?? {}) as Record<string, string>));
  });
  return out;
}

/** El texto completo. Se exporta aparte para poder probarlo sin tocar el navegador. */
export function textoOrdenPago(orden: Orden, proveedorNombre: string): string {
  const mon = (orden.moneda ?? 'USD').toUpperCase() === 'BS' ? 'Bs' : '$';
  const detalle = detalleTxt(orden);
  const nota = (orden.notas ?? '').trim();

  const L: string[] = [];
  L.push(`🔹 *ORDEN:* ${orden.oc_codigo ?? orden.codigo}`);
  L.push(`🏭 *Proveedor:* ${proveedorNombre || '—'}`);
  if (detalle) L.push(`📝 *Detalle:* ${detalle}`);
  if (nota) L.push(`🗒️ *Nota:* ${nota.replace(/\s*\r?\n\s*/g, ' ')}`);
  L.push(`💵 *Total:* ${montoTxt(orden.total, mon)}`);
  L.push(...bloquePago(orden.metodo_pago, Number(orden.total) || 0, mon));
  return L.join('\r\n'); // CRLF: se abre en el Bloc de notas sin quedar todo en una línea
}

/** Baja el .txt de la orden. Se llama SOLO desde el botón del detalle. */
export function descargarOrdenPagoTxt(orden: Orden, proveedorNombre: string): void {
  const texto = textoOrdenPago(orden, proveedorNombre);
  // BOM para que Windows abra el archivo con los acentos y los emojis bien.
  const blob = new Blob([`\uFEFF${texto}`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(orden.oc_codigo ?? orden.codigo).replace(/[^\w.-]+/g, '_')}-pago.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
