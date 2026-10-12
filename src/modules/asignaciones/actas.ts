/* ============================================================
   MGG · Asignaciones · El acta de entrega (lo que se puede probar sin base)

   Hasta el 12-10-2026 las asignaciones se llevaban en Drive con una carta
   por entrega: «ASIGNACIÓN 026-2026», quién entrega (la Gerente General,
   con su cédula), a quién, qué, firma y huella de quien recibe, y un
   ANEXO FOTOGRÁFICO. Acá vive el texto de esa carta y las reglas del
   número, para que el PDF del sistema diga exactamente lo mismo que el
   papel que ya firman.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';
import type { AsignacionBase } from './asignaciones';

/** El número del acta: NNN-AAAA («026-2026»), correlativo por año. */
export const FORMATO_NUMERO_ACTA = /^\d{3,}-\d{4}$/;

/** Máximo de fotos del anexo fotográfico por acta. */
export const MAX_FOTOS_ACTA = 4;

/** Pie de página del acta, tal cual el papel del Drive. */
export const PIE_ACTA = {
  linea1: 'Domicilio Fiscal: Urbanización Villa Betania, Manzana 3, Parcela Nro 15',
  linea2: 'Puerto Ordaz, Municipio Caroní, Estado Bolívar zona Postal 8050.',
  linea3: 'Teléfono: +58 424-8473665   correo: mineralgroupguayanaca@gmail.com',
} as const;

export const EMPRESA_ACTA = 'Mineral Group Guayana C.A.';

/**
 * Qué está mal con un número de acta escrito a mano (una carga histórica del
 * Drive). Vacío no es error: el sistema pone el siguiente del año.
 */
export function errorNumeroActa(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (!FORMATO_NUMERO_ACTA.test(s)) return 'El número del acta va como 026-2026 (correlativo-año).';
  return null;
}

/** «026-2026» a partir de un correlativo y un año: lo que arma la base cuando el número viene vacío. */
export function numeroActa(correlativo: number, anio: number): string {
  return `${String(Math.max(1, Math.trunc(correlativo))).padStart(3, '0')}-${anio}`;
}

/**
 * El siguiente número del año, mirando los que ya existen. Sirve para
 * mostrarlo en el formulario ANTES de guardar; la base lo recalcula con
 * candado al insertar, así que dos personas a la vez no lo repiten.
 */
export function siguienteNumeroActa(existentes: readonly string[], anio: number): string {
  let max = 0;
  for (const n of existentes) {
    const m = /^(\d+)-(\d{4})$/.exec((n ?? '').trim());
    if (m && Number(m[2]) === anio) max = Math.max(max, Number(m[1]));
  }
  return numeroActa(max + 1, anio);
}

/** V-12874838 → V-12.874.838 (como se escribe en la carta). */
export function cedulaConPuntos(c: string | null | undefined): string {
  const s = (c ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  const m = /^([VEJPG])?-?(\d+)$/.exec(s);
  if (!m) return s;
  const digitos = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${m[1] ?? 'V'}-${digitos}`;
}

const UNIDADES = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];

/**
 * «un (1)», «dos (2)», «treinta y cinco (35)»: como se escribe la cantidad
 * en la carta. Pasado de 99, o con decimales, va solo el número.
 */
export function cantidadEnLetras(n: number | string | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (!Number.isInteger(v) || v > 99) return String(v);
  let letras: string;
  if (v < 30) letras = UNIDADES[v];
  else {
    const d = Math.floor(v / 10); const u = v % 10;
    letras = u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d];
  }
  return `${letras} (${v})`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «Puerto Ordaz, 24 de septiembre del 2026», con la fecha pura (YYYY-MM-DD) sin corrimiento de zona. */
export function fechaCartaVE(iso: string | null | undefined, ciudad = 'Puerto Ordaz'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return ciudad;
  return `${ciudad}, ${Number(m[3])} de ${MESES[Number(m[2]) - 1] ?? ''} del ${m[1]}`;
}

/** Nombre completo de una ficha, en mayúsculas como va en la carta. */
export function nombreCarta(p: Pick<Personal, 'nombre' | 'apellido'> | null | undefined): string {
  return `${p?.nombre ?? ''} ${p?.apellido ?? ''}`.trim().toUpperCase();
}

/**
 * Quién entrega por defecto: la Gerente General, que es quien firma las
 * actas del Drive. Si no hay nadie con ese cargo, el último que se usó; si
 * tampoco, nadie (se elige a mano).
 */
export function entregaPorDefecto(personal: readonly Personal[], ultimoId?: string | null): string {
  const ultimo = ultimoId ? personal.find((p) => p.id === ultimoId && p.activo) : null;
  if (ultimo) return ultimo.id;
  const gerente = personal.find((p) => p.activo && /gerente\s+general/i.test(p.cargo ?? ''));
  return gerente?.id ?? '';
}

/** Un ítem como se nombra en la carta: «un (1) BOLSO TIPO MALETÍN, serial ABC123». */
export function textoItemActa(a: Pick<AsignacionBase, 'descripcion' | 'cantidad' | 'serial' | 'numero_linea'> & { unidad?: string | null }): string {
  const cant = cantidadEnLetras(a.cantidad ?? 1);
  const unidad = (a.unidad ?? '').trim();
  const conUnidad = unidad && !/^(und|unidad|unidades|u)$/i.test(unidad) ? `${cant} ${unidad.toLowerCase()} de ` : `${cant} `;
  const extra = [a.serial ? `serial ${a.serial}` : '', a.numero_linea ? `línea ${a.numero_linea}` : ''].filter(Boolean).join(', ');
  return `${conUnidad}${(a.descripcion ?? '').trim().toUpperCase()}${extra ? `, ${extra}` : ''}`;
}

/** «A, B y C»: la lista de lo entregado, en una frase. */
export function listaItemsActa(items: readonly Parameters<typeof textoItemActa>[0][]): string {
  const partes = items.map(textoItemActa).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join('; ')} y ${partes[partes.length - 1]}`;
}

/** A partir de cuántos ítems la carta los pone en tabla en vez de en la frase. */
export const ITEMS_EN_TABLA = 4;

/**
 * El cuerpo de la carta, igual al del Drive. Lo que cambia es solo lo que
 * cambia en el papel: quién entrega, a quién, qué, y si vuelve o no.
 *
 * Si nada es retornable (una dotación), no se le pide «devolución inmediata»
 * a nadie: sería pedirle que devuelva el uniforme.
 */
export function parrafoActa(o: {
  entregaNombre: string; entregaCedula: string; entregaCargo: string;
  recibeNombre: string;
  items: readonly (Parameters<typeof textoItemActa>[0] & { retornable?: boolean | null })[];
  observaciones?: string | null;
}): string {
  const quien = [o.entregaNombre.toUpperCase(), o.entregaCedula ? `titular de la cédula de identidad N° ${cedulaConPuntos(o.entregaCedula)}` : '',
    o.entregaCargo ? `${o.entregaCargo} de la Empresa ${EMPRESA_ACTA}` : `de la Empresa ${EMPRESA_ACTA}`].filter(Boolean).join(', ');
  const enTabla = o.items.length >= ITEMS_EN_TABLA;
  const que = enTabla ? 'los bienes que se detallan a continuación' : listaItemsActa(o.items);
  const obs = (o.observaciones ?? '').trim();
  const finalidad = obs && obs.length <= 120 && !enTabla ? `, ${obs.replace(/\.$/, '')}` : '';
  const vuelve = o.items.some((i) => i.retornable !== false);
  const compromiso = vuelve
    ? 'comprometiéndose a su uso profesional, cuidado físico y devolución inmediata en caso de cese de la relación laboral.'
    : 'comprometiéndose a su uso profesional y cuidado físico.';
  const plural = o.items.length > 1 || enTabla;
  return `Quien suscribe, ${quien}. Le hace entrega a: ${o.recibeNombre.toUpperCase()} ${que}${finalidad}. `
    + `Por medio de esta se da constancia de que acepta que ${plural ? 'los bienes asignados son parte' : 'lo asignado es parte'} de sus herramientas de trabajo `
    + `PROPIEDAD de ${EMPRESA_ACTA}, ${compromiso}`;
}

/** Qué está mal con las fotos que se quieren subir. Null si todas sirven. */
export function errorFotosActa(archivos: readonly { name: string; type: string; size: number }[], yaCargadas = 0): string | null {
  if (archivos.length + yaCargadas > MAX_FOTOS_ACTA) return `El anexo fotográfico admite hasta ${MAX_FOTOS_ACTA} fotos.`;
  for (const f of archivos) {
    if (f.type && !f.type.startsWith('image/')) return `«${f.name}» no es una imagen.`;
    if (f.size > 10 * 1024 * 1024) return `«${f.name}» pesa más de 10 MB.`;
  }
  return null;
}
