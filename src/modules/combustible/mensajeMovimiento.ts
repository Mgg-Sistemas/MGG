/* ============================================================
   MGG · Combustible · El movimiento contado en un mensaje

   Lo que se surtió hay que avisarlo: el encargado lo pide por WhatsApp
   y hasta ahora se escribía a mano, con lo que eso trae —litros que no
   coinciden, el equipo mal escrito, la hora inventada—.

   Acá se arma el texto UNA vez, desde el movimiento guardado, y de ahí
   sale igual para el portapapeles y para WhatsApp. Si dice 120 litros
   es porque en la base dice 120 litros.

   Los emojis no son adorno: en una lista de chat, la flecha dice de un
   vistazo si entró o salió combustible sin leer una palabra.

   ⚠ TODOS los emojis de acá tienen que ser de COLOR POR SÍ MISMOS, sin
   el selector U+FE0F.

   Hay caracteres —⬇️ ⬆️ ↩️ 🛢️ ⏱️ 🛣️ 🗓️— que por norma Unicode son
   TEXTO y solo se vuelven emoji a color si detrás les va un U+FE0F
   invisible. En el navegador se veían bien, pero WhatsApp normaliza el
   texto del enlace `wa.me` y se lleva ese selector puesto: del otro
   lado llegaba un glifo monocromo o un cuadrito. Justo las tres
   flechas del movimiento, que son las que se leen de un vistazo.

   Los de abajo son todos emoji por defecto: llegan a color a cualquier
   teléfono. `mensajeMovimiento.test.ts` lo verifica y rompe si alguien
   mete uno con selector.
   ============================================================ */
import type { TipoMovimientoTanque } from '@/shared/lib/types';

/** El emoji de cada movimiento. Abajo sale, arriba entra. */
export const EMOJI_MOVIMIENTO: Record<TipoMovimientoTanque, string> = {
  consumo: '🔽',
  ingreso: '🔼',
  retorno: '🔄',
  merma: '🔻',
  traslado: '🔁',
};

/** Cómo se llama cada movimiento en el mensaje. */
export const TITULO_MOVIMIENTO: Record<TipoMovimientoTanque, string> = {
  consumo: 'SURTIDO',
  ingreso: 'ENTRADA DE COMBUSTIBLE',
  retorno: 'RETORNO',
  merma: 'MERMA',
  traslado: 'TRASLADO ENTRE TANQUES',
};

/** Lo que hace falta saber del movimiento para contarlo. */
export interface MovimientoParaMensaje {
  tipo: TipoMovimientoTanque;
  litros?: number | string | null;
  fecha?: string | null;
  equipo?: string | null;
  autorizado_por?: string | null;
  despachado_por?: string | null;
  destino?: string | null;
  observacion?: string | null;
  contador_global_ini?: number | null;
  contador_global_fin?: number | null;
  horometro_final?: number | null;
  kilometraje_final?: number | null;
}

export interface ContextoMensaje {
  /** Nombre del tanque de donde salió (o al que entró). */
  tanque?: string | null;
  /** Traslado: nombre del tanque que recibió. */
  tanqueDestino?: string | null;
  /** Qué combustible es (DIESEL, GASOLINA…). */
  combustible?: string | null;
  /** Quién lo está mandando. */
  registradoPor?: string | null;
}

const nf = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 2 });

/** Litros con separador de miles, como se leen en Venezuela. */
function litrosTexto(v: unknown): string {
  const n = Number(v);
  return `${nf.format(Number.isFinite(n) ? n : 0)} L`;
}

/**
 * Fecha y hora de planta, en el formato que se lee en un chat.
 *
 * Se fuerza la zona de Venezuela: el movimiento se guarda con la hora del
 * servidor, y si el mensaje la mostrara en la zona del teléfono, dos personas
 * leerían horas distintas del mismo surtido.
 */
export function fechaHoraTexto(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const f = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
  const h = new Intl.DateTimeFormat('es-VE', {
    timeZone: 'America/Caracas', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  return `${f} · ${h}`;
}

/**
 * El mensaje listo para copiar o mandar por WhatsApp.
 *
 * Solo se escriben los renglones que tienen dato: un mensaje con cuatro
 * «Destino: —» se lee peor que uno corto, y en el teléfono ocupa media
 * pantalla para no decir nada.
 */
export function mensajeMovimiento(m: MovimientoParaMensaje, ctx: ContextoMensaje = {}): string {
  const emoji = EMOJI_MOVIMIENTO[m.tipo] ?? '⛽';
  const titulo = TITULO_MOVIMIENTO[m.tipo] ?? 'MOVIMIENTO';

  const lineas: string[] = [`${emoji} *${titulo}*`, ''];
  const poner = (icono: string, rotulo: string, valor: unknown) => {
    const v = typeof valor === 'string' ? valor.trim() : valor;
    if (v === null || v === undefined || v === '') return;
    lineas.push(`${icono} ${rotulo}: ${v}`);
  };

  poner('💧', 'Combustible', ctx.combustible);
  lineas.push(`⛽ Litros: *${litrosTexto(m.litros)}*`);

  if (m.tipo === 'traslado') {
    poner('📤', 'Sale de', ctx.tanque);
    poner('📥', 'Entra a', ctx.tanqueDestino);
  } else {
    poner('📦', 'Tanque', ctx.tanque);
  }

  poner('🚜', 'Equipo', m.equipo);
  poner('✅', 'Autorizado por', m.autorizado_por);
  poner('👷', 'Despachado por', m.despachado_por);
  poner('📍', 'Destino', m.destino);

  // El contador es lo que se discute cuando los litros no cuadran: va en el
  // mensaje para que la discusión ocurra con el dato a la vista.
  if (m.contador_global_ini != null || m.contador_global_fin != null) {
    poner('🔢', 'Contador', `${m.contador_global_ini ?? '—'} → ${m.contador_global_fin ?? '—'}`);
  }
  if (m.horometro_final != null) poner('⏰', 'Horómetro', m.horometro_final);
  if (m.kilometraje_final != null) poner('📏', 'Kilometraje', m.kilometraje_final);

  lineas.push(`📅 Fecha: ${fechaHoraTexto(m.fecha)}`);
  poner('📝', 'Observación', m.observacion);
  poner('🙍', 'Registró', ctx.registradoPor);

  lineas.push('', '_MGG · Mineral Group Guayana_');
  return lineas.join('\n');
}

/**
 * El enlace que abre WhatsApp con el mensaje escrito.
 *
 * Sin número a propósito: sin destinatario, WhatsApp deja elegir el contacto o
 * el grupo en el momento, que es lo que hace falta —el surtido de hoy va al
 * encargado y el de mañana al grupo de la mina—. Fijar un número obligaría a
 * mantener una agenda que nadie va a actualizar.
 *
 * ⚠ NO usar `wa.me`. Ese acortador REESCRIBE el texto al redirigir y se come
 * todo carácter UTF-8 de 3 bytes o más —o sea, TODOS los emojis— cambiándolo
 * por «�». Comprobado contra el servidor el 29-09-2026:
 *
 *   GET https://wa.me/?text=%F0%9F%94%BD%E2%9B%BD%C3%B3%C2%B7      (🔽⛽ó·)
 *   → Location: …/send/?text=%EF%BF%BD%EF%BF%BD%C3%B3%C2%B7        (��ó·)
 *
 * Fijate que «ó» y «·» (2 bytes) sobreviven y los emojis no: no es cosa de la
 * codificación nuestra —que va bien— sino del redirect. Yendo derecho a
 * `api.whatsapp.com/send` no hay redirect y el texto llega entero.
 */
export function enlaceWhatsapp(texto: string): string {
  return `https://api.whatsapp.com/send?text=${encodeURIComponent(texto)}`;
}

/**
 * Manda el mensaje por el camino que mejor lo conserve.
 *
 * En el teléfono usa la hoja de compartir del sistema: el texto viaja como
 * string, sin pasar por ninguna URL ni por servidor de nadie, así que llega
 * exacto —emojis, acentos y saltos de línea— y de paso deja mandarlo a
 * WhatsApp o a donde haga falta. Donde no existe (PC), abre el enlace.
 *
 * Devuelve `false` si no compartió por la hoja del sistema, para que quien
 * llama abra el enlace.
 */
export function puedeCompartir(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function compartirMovimiento(texto: string): Promise<boolean> {
  if (!puedeCompartir()) return false;
  try {
    await navigator.share({ text: texto });
    return true;
  } catch {
    // Cancelar la hoja de compartir lanza: no es un error y no hay que
    // abrir el enlace detrás, que sería mandar lo que la persona canceló.
    return true;
  }
}
