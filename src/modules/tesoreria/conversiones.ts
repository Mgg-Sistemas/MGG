/* ============================================================
   MGG · Tesorería · Historial de conversiones

   Una conversión deja DOS renglones en el libro: el que sale de una
   moneda y el que entra en la otra. Acá se leen de a pares y se filtran,
   para responder lo que se pregunta en la práctica: cuándo se cambió,
   quién lo hizo, a qué tasa y entre qué monedas.
   ============================================================ */

export interface Conversion {
  /** Ata las dos patas: es el `conversion_id` de la base. */
  id: string;
  /** Fecha y hora del asiento (ISO). Puede ser anterior al día en que se cargó. */
  at: string;
  actor: string;
  actorName: string | null;
  deMoneda: string;
  deMonto: number;
  deCajaId: string;
  aMoneda: string;
  aMonto: number;
  aCajaId: string;
  motivo: string | null;
}

export interface FiltroConversiones {
  /** Busca en monedas, quién, cajas y motivo. */
  texto: string;
  /** '' = todas. */
  moneda: string;
  /** Correo de quien la hizo. '' = todos. */
  actor: string;
  desde: string;
  hasta: string;
}

export const FILTRO_CONVERSIONES_VACIO: FiltroConversiones = {
  texto: '', moneda: '', actor: '', desde: '', hasta: '',
};

/** El día del asiento, en YYYY-MM-DD, para comparar con los campos de fecha. */
export function diaDe(c: Conversion): string {
  return (c.at ?? '').slice(0, 10);
}

/**
 * Cuántas unidades de la moneda destino por 1 de la de origen.
 *
 * Se recalcula desde los montos en vez de guardarla: así la tasa que se muestra
 * es la que REALMENTE se aplicó, comisión incluida, y no la que se tipeó antes
 * de redondear.
 */
export function tasaDe(c: Conversion): number | null {
  const de = Number(c.deMonto) || 0;
  if (de <= 0) return null;
  return (Number(c.aMonto) || 0) / de;
}

/** El par de monedas, para el filtro y para agrupar: 'USDT → Bs'. */
export function parDe(c: Conversion): string {
  return `${c.deMoneda} → ${c.aMoneda}`;
}

function textoDe(c: Conversion, nombreCaja: (id: string) => string): string {
  return [
    c.deMoneda, c.aMoneda, parDe(c), c.actorName ?? '', c.actor,
    nombreCaja(c.deCajaId), nombreCaja(c.aCajaId), c.motivo ?? '',
  ].join(' ').toUpperCase();
}

export function coincide(c: Conversion, f: FiltroConversiones, nombreCaja: (id: string) => string = () => ''): boolean {
  const dia = diaDe(c);
  if (f.desde && dia < f.desde) return false;
  if (f.hasta && dia > f.hasta) return false;
  if (f.actor && c.actor !== f.actor) return false;
  // La moneda matchea de los dos lados: filtrar por Bs trae lo que entró en Bs
  // y lo que salió de Bs, que es lo que uno espera al preguntar «¿y los Bs?».
  if (f.moneda && c.deMoneda !== f.moneda && c.aMoneda !== f.moneda) return false;
  const t = f.texto.trim().toUpperCase();
  if (t && !textoDe(c, nombreCaja).includes(t)) return false;
  return true;
}

export function filtrar(lista: Conversion[], f: FiltroConversiones, nombreCaja: (id: string) => string = () => ''): Conversion[] {
  return lista.filter((c) => coincide(c, f, nombreCaja)).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Las monedas presentes, para poblar el desplegable sin inventar opciones vacías. */
export function monedasDe(lista: Conversion[]): string[] {
  const set = new Set<string>();
  lista.forEach((c) => { if (c.deMoneda) set.add(c.deMoneda); if (c.aMoneda) set.add(c.aMoneda); });
  return Array.from(set).sort();
}

/** Quiénes hicieron conversiones: [correo, nombre a mostrar]. */
export function actoresDe(lista: Conversion[]): { actor: string; nombre: string }[] {
  const map = new Map<string, string>();
  lista.forEach((c) => { if (c.actor && !map.has(c.actor)) map.set(c.actor, (c.actorName ?? '').trim() || c.actor); });
  return Array.from(map, ([actor, nombre]) => ({ actor, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
