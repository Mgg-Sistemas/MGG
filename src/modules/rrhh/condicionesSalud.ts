/* ============================================================
   MGG · RRHH · Condiciones de salud del trabajador

   Dos preguntas: ¿es alérgico a algo? ¿padece alguna enfermedad? Cada una con
   su detalle. Las reglas viven acá, sin base de datos y sin pantalla, para
   poder probarlas.

   POR QUÉ TRES ESTADOS Y NO DOS
   `true` = sí, `false` = no, `null` = todavía no se preguntó. Sin el `null`,
   toda ficha vieja diría «no tiene alergias» sin que nadie lo haya contestado
   nunca, y eso es peor que decir «no sabemos»: en una emergencia alguien lo
   leería como un dato confirmado.

   POR QUÉ EL DETALLE SE BORRA AL DECIR «NO»
   Si alguien marca «sí, alergia a la penicilina» y después corrige a «no», el
   detalle viejo quedaría colgado y el QR del carnet seguiría mostrando una
   alergia que la persona ya dijo que no tiene. La base lo prohíbe con un
   `check`; acá se limpia antes de mandar para que nunca llegue a rechazarlo.
   ============================================================ */

/** `true` = sí · `false` = no · `null` = no se preguntó. */
export type RespuestaSalud = boolean | null;

export interface CondicionesSalud {
  tiene_alergias?: RespuestaSalud;
  alergias_detalle?: string | null;
  tiene_enfermedad?: RespuestaSalud;
  enfermedad_detalle?: string | null;
}

/** Mínimo del detalle. «si» no le sirve a nadie parado frente a la persona. */
export const MIN_DETALLE_SALUD = 3;

/** Tope del detalle. Es un renglón de un carnet, no una historia clínica. */
export const MAX_DETALLE_SALUD = 300;

/** «Sí» / «No» / «—». */
export function textoRespuesta(v: RespuestaSalud | undefined): string {
  if (v === true) return 'Sí';
  if (v === false) return 'No';
  return '—';
}

/**
 * Deja las condiciones como se guardan: el detalle SOLO sobrevive si la
 * respuesta es «sí». Cualquier otra cosa lo borra.
 */
export function normalizarSalud(c: CondicionesSalud): CondicionesSalud {
  const detalle = (v: unknown) => String(v ?? '').trim().slice(0, MAX_DETALLE_SALUD) || null;
  return {
    tiene_alergias: c.tiene_alergias ?? null,
    alergias_detalle: c.tiene_alergias === true ? detalle(c.alergias_detalle) : null,
    tiene_enfermedad: c.tiene_enfermedad ?? null,
    enfermedad_detalle: c.tiene_enfermedad === true ? detalle(c.enfermedad_detalle) : null,
  };
}

/**
 * Qué está mal, en palabras. `null` si se puede guardar.
 *
 * Decir «sí» sin decir a qué no sirve de nada: en una emergencia el que lee el
 * carnet necesita el nombre del alérgeno, no el aviso de que existe uno.
 */
export function errorCondicionesSalud(c: CondicionesSalud): string | null {
  if (c.tiene_alergias === true) {
    const d = String(c.alergias_detalle ?? '').trim();
    if (!d) return 'Decí a qué es alérgico. Un «sí» solo no le sirve a quien lo atienda.';
    if (d.length < MIN_DETALLE_SALUD) return `El detalle de la alergia necesita al menos ${MIN_DETALLE_SALUD} caracteres.`;
  }
  if (c.tiene_enfermedad === true) {
    const d = String(c.enfermedad_detalle ?? '').trim();
    if (!d) return 'Decí qué enfermedad padece. Un «sí» solo no le sirve a quien lo atienda.';
    if (d.length < MIN_DETALLE_SALUD) return `El detalle de la enfermedad necesita al menos ${MIN_DETALLE_SALUD} caracteres.`;
  }
  return null;
}

/** ¿Hay algo que declarar? Para no ocupar espacio con dos «No» en el carnet. */
export function hayCondiciones(c: CondicionesSalud): boolean {
  return c.tiene_alergias === true || c.tiene_enfermedad === true;
}

/** ¿Se preguntó alguna de las dos? Distingue «todo en no» de «ficha sin llenar». */
export function saludCargada(c: CondicionesSalud): boolean {
  return c.tiene_alergias != null || c.tiene_enfermedad != null;
}

export interface RenglonSalud { etiqueta: string; valor: string }

/**
 * Los dos renglones como van en la ficha técnica, en pantalla y en PDF.
 * Cuando la respuesta es «sí» el detalle va pegado: «Sí · penicilina».
 */
export function renglonesSalud(c: CondicionesSalud): RenglonSalud[] {
  const arma = (r: RespuestaSalud | undefined, d: string | null | undefined) => {
    const base = textoRespuesta(r ?? null);
    const det = String(d ?? '').trim();
    return r === true && det ? `${base} · ${det}` : base;
  };
  return [
    { etiqueta: 'Alergias', valor: arma(c.tiene_alergias, c.alergias_detalle) },
    { etiqueta: 'Enfermedad', valor: arma(c.tiene_enfermedad, c.enfermedad_detalle) },
  ];
}

/** Cuánto detalle entra en el QR. Más largo agranda el QR y deja de leerse
 *  impreso en un carnet de 5 cm. */
export const MAX_DETALLE_QR = 60;

/**
 * Lo que se ve al escanear el QR del carnet. Vacío si no hay nada que declarar:
 * el QR se imprime chico y dos «No» solo le quitan lugar a lo que importa.
 */
export function lineasSaludQR(c: CondicionesSalud): string[] {
  const corta = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s.length > MAX_DETALLE_QR ? `${s.slice(0, MAX_DETALLE_QR - 1).trimEnd()}…` : s;
  };
  const out: string[] = [];
  if (c.tiene_alergias === true) out.push(`ALERGIAS: ${corta(c.alergias_detalle) || 'sí (sin detalle)'}`);
  if (c.tiene_enfermedad === true) out.push(`ENFERMEDAD: ${corta(c.enfermedad_detalle) || 'sí (sin detalle)'}`);
  return out;
}
