/* ============================================================
   MGG · Compras · TXT de una orden confirmada para pagar
   Texto plano, para pegar en un correo o en WhatsApp cuando hay
   que pedirle el pago a alguien que no entra al sistema.
   Lleva lo justo para decidir y para emitir el pago: quién pide,
   de qué unidad, qué pidió, a qué proveedor, y cómo se paga con
   los datos del beneficiario y su monto.
   Solo por botón: nunca se descarga solo.
   ============================================================ */
import type { Orden, PagoMetodo } from '@/shared/lib/types';
import { labelMetodoPago } from './pedidos.repository';
import { labelBanco } from '@/shared/lib/bancos';

const ANCHO = 62;
const linea = (c = '-') => c.repeat(ANCHO);

function monto(n: number | null | undefined, moneda = '$'): string {
  const v = Number(n) || 0;
  return `${moneda} ${v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** «SOLICITA» + 8 espacios + «: valor», para que los dos puntos queden alineados. */
function campo(etiqueta: string, valor: string): string {
  return `  ${etiqueta.padEnd(20)}: ${valor}`;
}

/**
 * Parte un texto largo en renglones de ANCHO columnas, sin cortar palabras.
 * La descripción de una solicitud es texto libre y llega a varios párrafos
 * («SOLICITUD DE TERMOMETRO DIGITAL PARA EL PERSONAL DEL GALPON… NOTA: LA ORDEN
 * FUE MODIFICADA EL DIA…»): en una sola línea el archivo se vuelve ilegible.
 */
function envolver(texto: string, sangria = '  '): string[] {
  const ancho = ANCHO - sangria.length;
  const out: string[] = [];
  for (const parrafo of String(texto).split(/\r?\n/)) {
    const palabras = parrafo.trim().split(/\s+/).filter(Boolean);
    if (!palabras.length) { out.push(''); continue; }
    let linea = '';
    for (const p of palabras) {
      if (!linea) { linea = p; continue; }
      if (`${linea} ${p}`.length <= ancho) linea += ` ${p}`;
      else { out.push(sangria + linea); linea = p; }
    }
    if (linea) out.push(sangria + linea);
  }
  return out;
}

/** Una sección con título y su texto envuelto; vacía si no hay nada que decir. */
function bloqueTexto(titulo: string, texto: string | null | undefined): string[] {
  const t = (texto ?? '').trim();
  if (!t) return [];
  return [linea(), `  ${titulo}`, linea(), ...envolver(t), ''];
}

/**
 * Los datos del beneficiario, uno por línea y con su etiqueta.
 * En pantalla se muestran en una sola línea separados por puntos, pero acá el
 * archivo se lee para TIPEAR una transferencia: cada dato en su renglón se copia
 * sin equivocarse de campo.
 */
function lineasDatosPago(metodo: string, d: Record<string, string> = {}): string[] {
  const out: string[] = [];
  const add = (k: string, v?: string | null) => { if (v && String(v).trim()) out.push(`     ${k.padEnd(10)}: ${String(v).trim()}`); };
  if (metodo === 'pago_movil') {
    add('CI / RIF', d.ci_rif); add('Banco', labelBanco(d.banco)); add('Teléfono', d.telefono);
  } else if (metodo === 'transferencia') {
    add('Titular', d.nombre); add('CI / RIF', d.ci); add('Banco', labelBanco(d.banco)); add('Cuenta', d.cuenta);
  } else if (metodo === 'zelle') {
    add('Titular', d.nombre); add('Correo', d.email);
  } else if (metodo === 'binance_usdt') {
    add('Correo/ID', d.email_o_id);
  }
  return out;
}

function bloquePago(patas: PagoMetodo[] | null | undefined): string[] {
  const list = patas ?? [];
  if (!list.length) return ['  (todavía sin método de pago indicado)'];
  const out: string[] = [];
  list.forEach((m, i) => {
    if (i > 0) out.push('');
    out.push(`  ${list.length > 1 ? `[${i + 1}/${list.length}] ` : ''}${labelMetodoPago(m.metodo)}   ${monto(m.monto, m.moneda || '$')}`);
    out.push(...lineasDatosPago(m.metodo, (m.datos ?? {}) as Record<string, string>));
  });
  return out;
}

/** El texto completo. Se exporta aparte para poder probarlo sin tocar el navegador. */
export function textoOrdenPago(
  orden: Orden,
  proveedorNombre: string,
  fechaGenerado = new Date(),
): string {
  const persona = orden.solicitante_persona ?? orden.ci_solicitante ?? orden.solicitante_email ?? '—';
  const unidad = (orden.solicitante ?? '').trim() || '—';
  const items = (orden.items ?? []).filter((it) => it.comprar !== false);
  const mon = (orden.moneda ?? 'USD').toUpperCase() === 'BS' ? 'Bs' : '$';

  const L: string[] = [];
  L.push(linea('='));
  L.push('  MINERAL GROUP GUAYANA C.A.');
  L.push('  ORDEN CONFIRMADA PARA PAGAR');
  L.push(linea('='));
  L.push('');
  L.push(campo('ORDEN', orden.oc_codigo ?? orden.codigo));
  if (orden.oc_codigo && orden.codigo !== orden.oc_codigo) L.push(campo('SOLICITUD', orden.codigo));
  L.push(campo('SOLICITA', persona));
  L.push(campo('UNIDAD SOLICITANTE', unidad));
  L.push(campo('PROVEEDOR', proveedorNombre || '—'));
  L.push('');

  /* El porqué de la solicitud. `motivo` y `finalidad` son dos campos distintos
     de la OP y no siempre están los dos cargados; si coinciden no se repite. */
  const motivo = (orden.motivo ?? '').trim();
  const finalidad = (orden.finalidad ?? '').trim();
  const descripcion = [motivo, finalidad === motivo ? '' : finalidad].filter(Boolean).join('\n');
  L.push(...bloqueTexto('DESCRIPCIÓN DE LA SOLICITUD', descripcion));
  L.push(...bloqueTexto('NOTA', orden.notas));

  L.push(linea());
  L.push('  QUÉ SE SOLICITÓ');
  L.push(linea());
  if (!items.length) {
    L.push('  (sin renglones)');
  } else {
    items.forEach((it, i) => {
      const cant = Number(it.cantidad) || 0;
      const pu = Number(it.precio) || 0;
      L.push(`  ${String(i + 1).padStart(2)}. ${it.nombre}`);
      // El SKU no va: quien paga no lo necesita y ensucia el renglón.
      L.push(`      ${cant} ${it.unidad ?? 'und'} x ${monto(pu, mon)}  =  ${monto(cant * pu, mon)}`);
    });
  }
  L.push('');
  L.push(`  ${'TOTAL'.padEnd(20)}: ${monto(orden.total, mon)}`);
  L.push('');

  L.push(linea());
  L.push('  MÉTODO DE PAGO');
  L.push(linea());
  L.push(...bloquePago(orden.metodo_pago));
  L.push('');
  L.push(linea('='));
  L.push(`  Generado ${fechaGenerado.toLocaleString('es-VE')}`);
  L.push(linea('='));
  return L.join('\r\n'); // CRLF: el Bloc de notas de Windows es donde se abre esto
}

/** Baja el .txt de la orden. Se llama SOLO desde el botón del detalle. */
export function descargarOrdenPagoTxt(orden: Orden, proveedorNombre: string): void {
  const texto = textoOrdenPago(orden, proveedorNombre);
  // BOM para que Windows abra el archivo con los acentos bien.
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
