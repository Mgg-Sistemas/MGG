/* ============================================================
   Golden Touch · Compras · Resolución de personas (Nombre y Apellido)
   
   En los mensajes de WhatsApp de compras (instrucciones de pago, avisos
   de aprobación para el Gerente General y Cierres diarios), se debe
   mostrar SIEMPRE el Nombre y Apellido del analista de compras y de
   quien aprueba / autoriza.
   
   BAJO NINGUNA CIRCUNSTANCIA debe mostrarse una dirección de correo
   electrónico (ej. @gmail.com) ni un identificador genérico (ej. "ANALISTACOMPRAS")
   en el texto enviado por el chat.
   ============================================================ */
import type { Usuario } from '@/shared/lib/types';
import { APROBADOR_JESUS_EMAIL, APROBADOR_LEYDIS_EMAIL, ELABORADOR_OC } from './aprobadoresOc';

/** Nombres canónicos de aprobadores, analistas de compras y personal de Golden Touch. */
export const PERSONAS_CONOCIDAS_COMPRAS: Record<string, string> = {
  // Aprobadores y directiva
  [APROBADOR_JESUS_EMAIL.toLowerCase()]: 'JESUS LOZADA',
  [APROBADOR_LEYDIS_EMAIL.toLowerCase()]: 'LEYDIS RENGEL',
  'touchgolden1127@gmail.com': 'JESUS LOZADA',
  'jhzgcontabilidad@gmail.com': 'LEYDIS RENGEL',
  'edinsontrabajogt@gmail.com': 'EDINSON ANGULO',
  'mariana.trabajo.gt@gmail.com': 'MARIANA TOVAR',
  'marianatovar@gmail.com': ELABORADOR_OC.nombre,
  'marianatovar1127@gmail.com': ELABORADOR_OC.nombre,

  // Analistas de compras y adquisiciones
  'analista1mgg@gmail.com': 'JAVIER LEIVA',
  'analistaadministrativobra@gmail.com': 'JAVIER LEIVA',
  'analista1': 'JAVIER LEIVA',
  'analista1mgg': 'JAVIER LEIVA',

  'comprasanalista9@gmail.com': 'KELVIN PEÑA',
  'comprasanalista': 'KELVIN PEÑA',
  'comprasanalista9': 'KELVIN PEÑA',

  'analistadecomprasgt@gmail.com': 'JOSE LIENDRO',
  'analistadecomprasgt': 'JOSE LIENDRO',
  'analistadecompras': 'JOSE LIENDRO',
  'analistacompras': 'JOSE LIENDRO',

  'asistentecomprasgt2@gmail.com': 'NAZARET SALAZAR',
  'asistentecomprasgt2': 'NAZARET SALAZAR',
  'asistentecompras': 'NAZARET SALAZAR',

  'admingometales@gmail.com': 'TEODORO GARCIA',
  'admingometales': 'TEODORO GARCIA',

  'analista4mgg@gmail.com': 'ERICK FLORES',
  'analista4': 'ERICK FLORES',
  'analista4mgg': 'ERICK FLORES',

  // Operaciones, almacén y logística
  'maquinariagt2026@gmail.com': 'KEIMER VALERO',
  'combustiblegt@gmail.com': 'JESUS CAMPOS',
  'combustiblegt1@gmail.com': 'ANTHONY CAMPOS',
  'almacengt710@gmail.com': 'JESUS RAMIREZ',
  'almacen.pzo.lospinos@gmail.com': 'ISNER ORENCE',
  'almacenmatanzas2026@gmail.com': 'CARLOS MACHADO',
  'geodestagt@gmail.com': 'MARCOS ROMERO',
  'laboratorio.mgg.2024@gmail.com': 'HECTOR MAITA',
  'mgg.asistente@gmail.com': 'LENISKA LEZAMA',
  'analistaadministrativo2@gmail.com': 'NILVANA VELASQUEZ',
  'impuestosmgg2026@gmail.com': 'SUSEJ ROJAS',
  'lozadawendy2511@gmail.com': 'WENDY LOZADA',
  'rrhhmgg001@gmail.com': 'ZORYS GRILLET',
  'cocina1@gmail.com': 'JESUS TORRES',
  'cocina2@gmail.com': 'ALEXANDER CARREÑO',
  'sistemamgg2@gmail.com': 'ANTHONY MANSILLA',
  'sistemamgg3@gmail.com': 'CHRISTOPHER ORTIZ',
  'kareannysboscan6@gmail.com': 'KAREANNYS BOSCAN',
};

/**
 * Convierte un correo electrónico tipo "nombre.apellido@dominio.com" en "NOMBRE APELLIDO".
 * Elimina dominios (@...), separadores (. _ -) y números finales.
 */
export function derivarNombreDesdeCorreo(correo: string): string {
  const parteUsuario = correo.split('@')[0]?.trim() || '';
  if (!parteUsuario) return '';

  // Limpiar posibles números pegados al final (ej. "kelvin2026" → "kelvin", "analista1" → "analista")
  const sinDigitosFinales = parteUsuario.replace(/\d+$/, '').trim() || parteUsuario;

  // Separar por puntos, guiones o guiones bajos
  const palabras = sinDigitosFinales
    .split(/[._\-+]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (!palabras.length) return parteUsuario.toUpperCase();
  return palabras.map((p) => p.toUpperCase()).join(' ');
}

/**
 * Resuelve el Nombre y Apellido de una persona a partir de su correo, ID o nombre libre.
 * Garantiza que el resultado NUNCA contenga una arroba (@) ni dominio de correo,
 * y mapea las cuentas institucionales de compras a su Nombre y Apellido real.
 */
export function nombrePersonaCompras(
  identificador: string | null | undefined,
  personas?: Map<string, string>,
): string {
  const raw = (identificador ?? '').trim();
  if (!raw) return '';

  const norm = raw.toLowerCase().trim();

  // 1. Búsqueda en el mapa provisto (usuarios cargados desde la base de datos)
  if (personas) {
    const enMapa = personas.get(norm) || personas.get(raw);
    if (enMapa && enMapa.trim() && !enMapa.includes('@')) {
      return enMapa.trim();
    }
  }

  // 2. Aprobadores, analistas de compras y personal institucional conocido
  if (PERSONAS_CONOCIDAS_COMPRAS[norm]) {
    return PERSONAS_CONOCIDAS_COMPRAS[norm];
  }

  // 3. Reglas de coincidencia para cuentas institucionales de compras
  if (norm.includes('analistadecompras') || norm.includes('analistacompras')) {
    return 'JOSE LIENDRO';
  }
  if (norm.includes('comprasanalista')) {
    return 'KELVIN PEÑA';
  }
  if (norm.includes('asistentecompras')) {
    return 'NAZARET SALAZAR';
  }
  if (norm.includes('admingometales')) {
    return 'TEODORO GARCIA';
  }
  if (norm.includes('analista1')) {
    return 'JAVIER LEIVA';
  }
  if (norm.includes('analista4')) {
    return 'ERICK FLORES';
  }

  // Directiva y otros cargos clave
  if (norm.includes('touchgolden') || (norm.includes('jesus') && norm.includes('lozada'))) {
    return 'JESUS LOZADA';
  }
  if (norm.includes('jhzgcontabilidad') || (norm.includes('leydis') && norm.includes('rengel'))) {
    return 'LEYDIS RENGEL';
  }
  if (norm.includes('mariana') && norm.includes('tovar')) {
    return ELABORADOR_OC.nombre;
  }
  if (norm.includes('edinson') && norm.includes('angulo')) {
    return 'EDINSON ANGULO';
  }

  // 4. Si viene con formato de correo electrónico (@...), derivar Nombre y Apellido limpio
  if (raw.includes('@')) {
    return derivarNombreDesdeCorreo(raw);
  }

  // 5. Si ya es un nombre sin @, devolverlo limpio en mayúsculas
  return raw.toUpperCase();
}

/**
 * Construye un mapa email|id → "NOMBRE APELLIDO" a partir de la lista de usuarios,
 * incorporando de antemano a los aprobadores y analistas institucionales.
 */
export function crearMapaPersonasCompras(usuarios: Usuario[] = []): Map<string, string> {
  const map = new Map<string, string>();

  // Base institucional fija
  for (const [correo, nombre] of Object.entries(PERSONAS_CONOCIDAS_COMPRAS)) {
    map.set(correo.toLowerCase(), nombre);
  }

  // Usuarios de la base de datos
  for (const u of usuarios) {
    const nombreCompleto = `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim();
    if (nombreCompleto) {
      const nombreMayusc = nombreCompleto.toUpperCase();
      if (u.email) {
        map.set(u.email.toLowerCase().trim(), nombreMayusc);
      }
      if (u.id) {
        map.set(u.id.trim(), nombreMayusc);
      }
    }
  }

  return map;
}
