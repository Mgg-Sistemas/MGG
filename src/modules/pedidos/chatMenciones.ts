/* ============================================================
   Golden Touch · Pedidos · Chat interno · Menciones (@)
   Detección de menciones, resolución de destinatarios conocidos
   y despacho de notificaciones directas al usuario mencionado.
   ============================================================ */
import type { Usuario } from '@/shared/lib/types';
import { push as pushNotificacion } from '@/modules/notificaciones/notif.repository';
import { PERSONAS_CONOCIDAS_COMPRAS } from './personasCompras';

/** Nombres base conocidos en compras/operaciones */
export const NOMBRES_CONOCIDOS_MENCIONES: string[] = Array.from(
  new Set(Object.values(PERSONAS_CONOCIDAS_COMPRAS))
).sort((a, b) => b.length - a.length);

/**
 * Extrae menciones con formato @Nombre, @Nombre Apellido o @correo.
 * Evita engullir palabras posteriores si no coinciden con nombres conocidos.
 */
export function extraerMenciones(texto: string, usuariosExtra: Array<{ nombre?: string; apellido?: string }> = []): string[] {
  if (!texto || !texto.includes('@')) return [];

  const nombresCombinados = new Set<string>(NOMBRES_CONOCIDOS_MENCIONES);
  for (const u of usuariosExtra) {
    const full = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toUpperCase();
    if (full) nombresCombinados.add(full);
  }

  const listaNombres = Array.from(nombresCombinados).sort((a, b) => b.length - a.length);
  const nombresRegexEscapados = listaNombres.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // 1. Mención a nombre compuesto conocido (@Jesus Lozada)
  // 2. Mención a correo electrónico (@usuario@dominio.com)
  // 3. Mención a identificador simple (@Javier, @Kelvin)
  const pattern = new RegExp(
    `@(?:(${nombresRegexEscapados})|([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+)|([A-Za-zÁÉÍÓÚáéíóúñÑ0-9_]+))(?=[\\s,.:;!?)]|$)`,
    'gi'
  );

  const menciones: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(texto)) !== null) {
    menciones.push(match[0]);
  }
  return menciones;
}

export interface DestinatarioMencion {
  email: string;
  nombre: string;
}

/**
 * Resuelve las menciones encontradas a emails de destinatarios válidos,
 * con RESTRICCIÓN ESTRICTA: Solo usuarios activos. Los archivados y
 * deshabilitados quedan totalmente excluidos.
 */
export function resolverDestinatariosMenciones(
  menciones: string[],
  usuarios: Usuario[] = [],
): DestinatarioMencion[] {
  const destinatarios: DestinatarioMencion[] = [];
  const emailsVistos = new Set<string>();

  // Exclusión estricta de usuarios archivados, deshabilitados o bloqueados
  const inactivosSet = new Set<string>();
  const ARCHIVADOS_CONOCIDOS = new Set([
    'erick flores',
    'javier leiva',
    'jose liendro',
    'mariana tovar',
    'teodoro garcia',
    'analista4mgg@gmail.com',
    'analistaadministrativobra@gmail.com',
    'analistadecomprasgt@gmail.com',
    'mariana.trabajo.gt@gmail.com',
    'admingometales@gmail.com',
    'analista1mgg@gmail.com',
  ]);

  for (const u of usuarios) {
    const esActivo = (u.estado ? u.estado.toLowerCase() === 'activo' : true) && !u.archivado_en && !u.bloqueado;
    if (!esActivo) {
      if (u.email) inactivosSet.add(u.email.toLowerCase().trim());
      const nomCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
      if (nomCompleto) inactivosSet.add(nomCompleto);
    }
  }

  for (const rawMention of menciones) {
    const query = rawMention.startsWith('@') ? rawMention.slice(1).trim() : rawMention.trim();
    if (!query) continue;
    const lower = query.toLowerCase();

    // 1. Si es correo directo: @alguien@gmail.com
    if (lower.includes('@')) {
      if (inactivosSet.has(lower) || ARCHIVADOS_CONOCIDOS.has(lower)) continue;
      if (!emailsVistos.has(lower)) {
        const nombre = PERSONAS_CONOCIDAS_COMPRAS[lower] || query;
        if (!inactivosSet.has(nombre.toLowerCase()) && !ARCHIVADOS_CONOCIDOS.has(nombre.toLowerCase())) {
          destinatarios.push({ email: lower, nombre });
          emailsVistos.add(lower);
        }
      }
      continue;
    }

    // 2. Coincidencia en usuarios activos de la base de datos (prioridad máxima)
    let matchEncontrado = false;
    for (const u of usuarios) {
      const esActivo = (u.estado ? u.estado.toLowerCase() === 'activo' : true) && !u.archivado_en && !u.bloqueado;
      if (!esActivo) continue;

      const nomCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
      const uEmail = (u.email ?? '').toLowerCase().trim();
      if (!uEmail) continue;

      if (
        nomCompleto === lower ||
        nomCompleto.startsWith(lower + ' ') ||
        (u.nombre && u.nombre.toLowerCase() === lower) ||
        uEmail.includes(lower)
      ) {
        if (!emailsVistos.has(uEmail)) {
          destinatarios.push({
            email: uEmail,
            nombre: `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || uEmail,
          });
          emailsVistos.add(uEmail);
        }
        matchEncontrado = true;
        break;
      }
    }
    if (matchEncontrado) continue;

    // 3. Fallback en PERSONAS_CONOCIDAS_COMPRAS solo si no se pasaron usuarios de base de datos
    if (usuarios.length === 0) {
      for (const [email, nombre] of Object.entries(PERSONAS_CONOCIDAS_COMPRAS)) {
        const nombreNorm = nombre.toLowerCase();
        const emailNorm = email.toLowerCase();
        if (ARCHIVADOS_CONOCIDOS.has(nombreNorm) || ARCHIVADOS_CONOCIDOS.has(emailNorm)) continue;

        if (nombreNorm === lower || nombreNorm.startsWith(lower + ' ') || nombreNorm.endsWith(' ' + lower)) {
          if (!emailsVistos.has(emailNorm)) {
            destinatarios.push({ email: emailNorm, nombre });
            emailsVistos.add(emailNorm);
          }
          break;
        }
      }
    }
  }

  return destinatarios;
}

/**
 * Despacha notificaciones a los destinatarios mencionados en una orden.
 * Excluye al propio autor del mensaje.
 */
export async function notificarMenciones(input: {
  ordenId: string;
  ordenLabel: string;
  mensaje: string;
  autorEmail: string;
  autorNombre?: string | null;
  destinatarios: DestinatarioMencion[];
}): Promise<void> {
  const autorNorm = input.autorEmail.toLowerCase().trim();
  const resumen = input.mensaje.length > 90 ? input.mensaje.slice(0, 87) + '…' : input.mensaje;
  const remitente = (input.autorNombre || input.autorEmail).trim();

  await Promise.all(
    input.destinatarios
      .filter((d) => d.email.toLowerCase().trim() !== autorNorm)
      .map(async (d) => {
        try {
          await pushNotificacion({
            destino: d.email,
            kind: 'info',
            title: `🔔 Te mencionaron en ${input.ordenLabel}`,
            message: `${remitente}: "${resumen}"`,
            link: '#/app/pedidos',
            dedup_key: `mention:${input.ordenId}:${d.email.toLowerCase()}:${Date.now()}`,
          });
        } catch {
          // La notificación individual es best-effort y no debe romper el hilo
        }
      })
  );
}
