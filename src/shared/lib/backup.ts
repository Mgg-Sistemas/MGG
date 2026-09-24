/* ============================================================
   MGG · Respaldo de la base de datos (.sql)
   - Manual: botón "Respaldo de Data" en el menú (admin/analista).
   - Automático: cada 30 días, al entrar un admin/analista.
   La generación corre en la función SQL `dump_database_sql()`
   (SECURITY DEFINER) que valida el rol del solicitante por dentro.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const CONFIG_KEY = 'backup.ultimo';
const DIAS = 30;
const MS_30D = DIAS * 24 * 60 * 60 * 1000;

/** Correos destino del respaldo (automático y opción "Enviar por correo"). */
export const BACKUP_EMAILS = ['mineralgroupsistemas@gmail.com', 'sistemas@mineralgroupguayana.com'];
/** Compat: texto para mostrar a quién se envía (lista separada por coma). */
export const BACKUP_EMAIL = BACKUP_EMAILS.join(', ');

/** Fecha/hora legible de Venezuela (para el encabezado y el mensaje del correo). */
function ahoraVE(): string {
  return new Date().toLocaleString('es-VE', {
    timeZone: 'America/Caracas',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Encabezado del .sql: deja registrado quién hizo el respaldo y cuándo. */
function encabezadoRespaldo(actorEmail: string, automatico: boolean): string {
  return [
    '-- ============================================================',
    '-- MGG · Respaldo de base de datos',
    `-- Tipo:          ${automatico ? 'AUTOMÁTICO (cada 30 días)' : 'MANUAL'}`,
    `-- Generado por:  ${actorEmail || 'sistema'}`,
    `-- Fecha y hora:  ${ahoraVE()} (America/Caracas)`,
    '-- ============================================================',
    '', '',
  ].join('\n');
}

/** Roles autorizados a respaldar (el filtro fino se ajustará luego). */
export function puedeRespaldar(role?: string | null): boolean {
  return role === 'admin' || role === 'analista';
}

/** Genera el SQL del respaldo llamando a la función de la base. */
export async function generarRespaldoSql(): Promise<string> {
  const { data, error } = await supabase.rpc('dump_database_sql');
  if (error) throw new Error(error.message || 'No se pudo generar el respaldo.');
  return (data as string) ?? '';
}

/** Marca en `config` la fecha del último respaldo (no rompe si falla). */
async function registrarUltimoRespaldo(actorEmail: string, automatico: boolean): Promise<void> {
  try {
    await supabase.from('config').upsert(
      { key: CONFIG_KEY, value: { at: new Date().toISOString(), por: actorEmail, automatico }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  } catch { /* el registro de fecha es best-effort */ }
}

/** Dispara la descarga de un texto como archivo. */
function descargarTexto(texto: string, nombre: string): void {
  const blob = new Blob([texto], { type: 'application/sql;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Genera y descarga el respaldo .sql (con encabezado de autor/fecha).
 * La descarga NO se comprime: no tiene tope de tamaño y un .sql suelto se abre
 * y se restaura directo, sin pasar por un descompresor.
 */
export async function descargarRespaldoSql(
  actorEmail: string,
  automatico = false,
  onAvance?: (a: AvanceRespaldo) => void,
): Promise<{ bytes: number }> {
  onAvance?.({ paso: 'generando', numero: 1, total: 2 });
  const sql = encabezadoRespaldo(actorEmail, automatico) + await generarRespaldoSql();
  const fecha = new Date().toISOString().slice(0, 10);
  onAvance?.({ paso: 'enviando', numero: 2, total: 2, detalle: 'guardando el archivo' });
  descargarTexto(sql, `mgg-respaldo${automatico ? '-auto' : ''}-${fecha}.sql`);
  await registrarUltimoRespaldo(actorEmail, automatico);
  return { bytes: new TextEncoder().encode(sql).length };
}

/** Tope de adjunto del proveedor de correo (Brevo). Es del ADJUNTO, no del archivo. */
export const TOPE_CORREO_BYTES = 20 * 1024 * 1024;

/** En qué anda el respaldo, para poder mostrarlo en pantalla. */
export type PasoRespaldo = 'generando' | 'comprimiendo' | 'enviando';

export interface AvanceRespaldo {
  paso: PasoRespaldo;
  /** 1, 2 o 3: cuál de los tres pasos es. */
  numero: number;
  total: number;
  detalle?: string;
}

const PASOS: Record<PasoRespaldo, { numero: number; texto: string }> = {
  generando: { numero: 1, texto: 'Generando el respaldo en la base…' },
  comprimiendo: { numero: 2, texto: 'Comprimiendo…' },
  enviando: { numero: 3, texto: 'Enviando el correo…' },
};

export function textoPaso(paso: PasoRespaldo): string {
  return PASOS[paso].texto;
}

/**
 * Genera el respaldo .sql, lo COMPRIME en .zip y lo envía por correo vía la
 * Edge Function `enviar-reporte` (Brevo). Registra la fecha.
 *
 * POR QUÉ COMPRIMIDO: el respaldo ya pesa más de 20 MB de texto, y el adjunto
 * se manda en base64, que pesa un tercio MÁS que el archivo. Sin comprimir, el
 * correo lo rechaza ("Mail size too large") después de esperar varios minutos
 * a que la base termine de generarlo. Un .sql comprime como 10 a 1, así que
 * zipeado entra con margen. Además Brevo acepta `.zip` y no acepta `.sql`.
 */
export async function enviarRespaldoPorCorreo(
  actorEmail: string,
  automatico = false,
  toEmails: string[] = BACKUP_EMAILS,
  onAvance?: (a: AvanceRespaldo) => void,
): Promise<{ destinatarios: string[]; bytesSql: number; bytesZip: number }> {
  const avisar = (paso: PasoRespaldo, detalle?: string) =>
    onAvance?.({ paso, numero: PASOS[paso].numero, total: 3, detalle });

  /* Se limpia la lista ANTES de generar: Brevo rechaza el correo ENTERO si un
     destinatario viene mal escrito, y enterarse de eso después de tres minutos
     de armar el respaldo es la peor forma de enterarse. */
  const destino = correosValidos(toEmails);
  if (!destino.length) throw new Error('No hay ningún correo destinatario válido.');

  const cuando = ahoraVE();
  avisar('generando');
  const sql = encabezadoRespaldo(actorEmail, automatico) + await generarRespaldoSql();
  const fecha = new Date().toISOString().slice(0, 10);
  const bytesSql = new TextEncoder().encode(sql).length;

  avisar('comprimiendo', megas(bytesSql));
  const { zipDeUnArchivo, bytesABase64, pesoEnBase64, megas: mb } = await import('./zip');
  const base = `mgg-respaldo${automatico ? '-auto' : ''}-${fecha}`;
  const zip = await zipDeUnArchivo(`${base}.sql`, sql);

  // Se revisa ANTES de mandar: esperar tres minutos para que el correo lo
  // rechace por tamaño es la peor forma de enterarse.
  const pesoAdjunto = pesoEnBase64(zip.length);
  if (pesoAdjunto > TOPE_CORREO_BYTES) {
    throw new Error(
      `El respaldo comprimido pesa ${mb(zip.length)} (${mb(pesoAdjunto)} como adjunto) y el correo admite ${mb(TOPE_CORREO_BYTES)}. ` +
      'Usá «↓ Descargar», que no tiene tope.',
    );
  }

  avisar('enviando', mb(zip.length));
  const { data, error } = await supabase.functions.invoke<
    { ok: true; destinatarios: string[] } | { error: string }
  >('enviar-reporte', {
    body: {
      pdf_base64: bytesABase64(zip),
      nombre_archivo: `${base}.zip`,
      asunto: `Respaldo de base de datos · MGG · ${fecha}`,
      mensaje: `${automatico ? 'Respaldo automático (cada 30 días)' : 'Respaldo manual'} · Generado por ${actorEmail || 'sistema'} · ${cuando} (America/Caracas).\n\n`
        + `Adjunto: ${base}.zip (${mb(zip.length)} comprimido · ${mb(bytesSql)} sin comprimir). Adentro viene ${base}.sql.`,
      to_emails: destino,
    },
  });
  if (error) throw new Error(error.message ?? 'No se pudo enviar el respaldo por correo.');
  if (!data || 'error' in data) throw new Error((data as { error?: string })?.error || 'Respuesta inválida del envío.');
  await registrarUltimoRespaldo(actorEmail, automatico);
  return { destinatarios: data.destinatarios ?? destino, bytesSql, bytesZip: zip.length };
}

/** MB con un decimal, para los mensajes de esta pantalla. */
function megas(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fecha del último respaldo (o null si nunca se hizo). */
export async function ultimoRespaldo(): Promise<string | null> {
  const { data } = await supabase.from('config').select('value').eq('key', CONFIG_KEY).maybeSingle();
  return (data?.value as { at?: string } | undefined)?.at ?? null;
}

/**
 * Respaldo AUTOMÁTICO: si el usuario es admin/analista y pasaron ≥30 días
 * (o nunca se hizo), ENVÍA el respaldo POR CORREO (al correo de respaldos) y
 * registra la fecha. Devuelve true si se ejecutó. Se llama una vez al entrar.
 */
export async function chequearRespaldoAutomatico(role: string | null, actorEmail: string): Promise<boolean> {
  if (!puedeRespaldar(role)) return false;
  const last = await ultimoRespaldo();
  if (last && Date.now() - new Date(last).getTime() < MS_30D) return false;
  await enviarRespaldoPorCorreo(actorEmail, true);
  return true;
}

/**
 * De una lista de correos, los que sirven para enviar.
 *
 * Filtra vacíos, repetidos y los que no tienen forma de correo. No pretende
 * validar que la casilla exista —eso solo lo sabe el servidor de correo—, sino
 * evitar que un dedazo tumbe el envío entero: Brevo rechaza TODO el correo si
 * un destinatario viene mal escrito.
 */
export function correosValidos(lista: readonly string[]): string[] {
  const forma = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const raw of lista) {
    const e = String(raw ?? '').trim().toLowerCase();
    if (!e || !forma.test(e) || vistos.has(e)) continue;
    vistos.add(e);
    salida.push(e);
  }
  return salida;
}
