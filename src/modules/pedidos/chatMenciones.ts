/* ============================================================
   Golden Touch · Pedidos · Chat interno · Menciones (@)
   Detección de menciones, resolución de destinatarios conocidos
   y despacho de notificaciones directas al usuario mencionado.
   ============================================================ */
import type { Usuario } from '@/shared/lib/types';
import { push as pushNotificacion } from '@/modules/notificaciones/notif.repository';
import { PERSONAS_CONOCIDAS_COMPRAS } from './personasCompras';
import { estaArchivado, estadoVisible } from '@/modules/usuarios/usuariosArchivo';

/**
 * Conjunto canónico de usuarios históricos, archivados, deshabilitados o desvinculados.
 * Se prohíbe de forma terminante que aparezcan en menciones (@), sugerencias
 * o recepción de alertas.
 */
export const ARCHIVADOS_CONOCIDOS = new Set<string>([
  'erick flores',
  'jose liendro',
  'mariana tovar',
  'teodoro garcia',
  'analista4mgg@gmail.com',
  'analistadecomprasgt@gmail.com',
  'mariana.trabajo.gt@gmail.com',
  'marianatovar@gmail.com',
  'marianatovar1127@gmail.com',
  'admingometales@gmail.com',
  'analista4',
  'analista4mgg',
]);

/**
 * Validador estricto de usuario activo para el sistema de menciones (@).
 * Excluye rigurosamente usuarios inactivos, deshabilitados, archivados,
 * bloqueados y registros históricos desvinculados.
 */
export function esUsuarioActivoParaMencion(u: {
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  estado?: string | null;
  archivado_en?: string | null;
  bloqueado?: boolean | null;
}): boolean {
  if (!u) return false;

  // 1. Estado explícito: debe ser 'activo'. Si es 'inactivo' o cualquier otro, queda descartado
  const est = (u.estado ?? '').toLowerCase().trim();
  if (est && est !== 'activo') return false;

  // 2. Marcas de archivo y bloqueo
  if (estaArchivado(u) || u.archivado_en || u.bloqueado) return false;
  if (estadoVisible(u as any) !== 'activo') return false;

  // 3. Exclusión estricta de lista negra de archivados/desvinculados conocidos
  const emailNorm = (u.email ?? '').toLowerCase().trim();
  if (emailNorm && ARCHIVADOS_CONOCIDOS.has(emailNorm)) return false;

  const nomCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
  if (nomCompleto && ARCHIVADOS_CONOCIDOS.has(nomCompleto)) return false;

  const primerNombre = (u.nombre ?? '').trim().toLowerCase();
  if (primerNombre && ARCHIVADOS_CONOCIDOS.has(primerNombre)) return false;

  return true;
}

/** Nombres base conocidos en compras/operaciones (excluyendo estrictamente archivados) */
export const NOMBRES_CONOCIDOS_MENCIONES: string[] = Array.from(
  new Set(
    Object.values(PERSONAS_CONOCIDAS_COMPRAS).filter(
      (n) => !ARCHIVADOS_CONOCIDOS.has(n.toLowerCase().trim())
    )
  )
).sort((a, b) => b.length - a.length);

/**
 * Extrae menciones con formato @Nombre, @Nombre Apellido o @correo.
 * Evita engullir palabras posteriores si no coinciden con nombres conocidos.
 */
export function extraerMenciones(
  texto: string,
  usuariosExtra: Array<{
    nombre?: string | null;
    apellido?: string | null;
    email?: string | null;
    estado?: string | null;
    archivado_en?: string | null;
    bloqueado?: boolean | null;
  }> = []
): string[] {
  if (!texto || !texto.includes('@')) return [];

  const nombresCombinados = new Set<string>(NOMBRES_CONOCIDOS_MENCIONES);
  for (const u of usuariosExtra) {
    if (!esUsuarioActivoParaMencion(u)) continue;
    const full = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toUpperCase();
    if (full) nombresCombinados.add(full);
  }

  const listaNombres = Array.from(nombresCombinados).sort((a, b) => b.length - a.length);
  const nombresRegexEscapados = listaNombres.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  // 1. Mención a nombre compuesto conocido (@Jesus Lozada)
  // 2. Mención a correo electrónico (@usuario@dominio.com)
  // 3. Mención a identificador simple (@Kelvin)
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
 * con RESTRICCIÓN ESTRICTA: Solo usuarios activos. Los archivados,
 * inhabilitados y desvinculados quedan totalmente excluidos.
 */
export function resolverDestinatariosMenciones(
  menciones: string[],
  usuarios: Usuario[] = [],
): DestinatarioMencion[] {
  const destinatarios: DestinatarioMencion[] = [];
  const emailsVistos = new Set<string>();

  // Exclusión estricta de usuarios archivados, deshabilitados o bloqueados
  const inactivosSet = new Set<string>();

  for (const u of usuarios) {
    const esActivo = esUsuarioActivoParaMencion(u);
    if (!esActivo) {
      if (u.email) inactivosSet.add(u.email.toLowerCase().trim());
      const nomCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
      if (nomCompleto) inactivosSet.add(nomCompleto);
      const primerNombre = (u.nombre ?? '').trim().toLowerCase();
      if (primerNombre) inactivosSet.add(primerNombre);
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
        const nombreNorm = nombre.toLowerCase().trim();
        if (!inactivosSet.has(nombreNorm) && !ARCHIVADOS_CONOCIDOS.has(nombreNorm)) {
          destinatarios.push({ email: lower, nombre });
          emailsVistos.add(lower);
        }
      }
      continue;
    }

    // 2. Coincidencia en usuarios activos de la base de datos (prioridad máxima)
    let matchEncontrado = false;
    for (const u of usuarios) {
      if (!esUsuarioActivoParaMencion(u)) continue;

      const nomCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim().toLowerCase();
      const uEmail = (u.email ?? '').toLowerCase().trim();
      if (!uEmail || inactivosSet.has(uEmail) || ARCHIVADOS_CONOCIDOS.has(uEmail)) continue;
      if (inactivosSet.has(nomCompleto) || ARCHIVADOS_CONOCIDOS.has(nomCompleto)) continue;

      if (
        nomCompleto === lower ||
        nomCompleto.startsWith(lower + ' ') ||
        (u.nombre && u.nombre.toLowerCase().trim() === lower) ||
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
        const nombreNorm = nombre.toLowerCase().trim();
        const emailNorm = email.toLowerCase().trim();
        if (ARCHIVADOS_CONOCIDOS.has(nombreNorm) || ARCHIVADOS_CONOCIDOS.has(emailNorm)) continue;
        if (inactivosSet.has(nombreNorm) || inactivosSet.has(emailNorm)) continue;

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
