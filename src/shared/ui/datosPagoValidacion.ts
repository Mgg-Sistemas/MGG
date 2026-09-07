/* ============================================================
   MGG · Validación de los datos de pago del beneficiario
   Un teléfono y un número de cuenta son dos cosas distintas, pero
   se cargan en campos parecidos y se copian del mismo papel: pasó
   que el CÓDIGO DEL BANCO terminara guardado como teléfono
   («01340869618», banco 0134). Once dígitos numéricos, así que
   ningún filtro de largo lo atajaba: lo delata el PREFIJO.
   Vive suelto de la pantalla para poder probarlo.
   ============================================================ */

/** Operadores celulares de Venezuela. 0422 es de Digitel, de las últimas series. */
export const PREFIJOS_CELULAR = ['0412', '0414', '0416', '0422', '0424', '0426'] as const;

export const LARGO_TELEFONO = 11;
export const LARGO_CUENTA = 20;

/** Deja solo los dígitos: la gente pega «0424-969.21.72» y así viene igual. */
export function soloDigitos(v: string | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '');
}

/**
 * Revisa un teléfono venezolano. Devuelve el motivo del rechazo, o null si está bien.
 * Celular: 11 dígitos con prefijo de operador. Fijo: 11 dígitos que arrancan en 02.
 */
export function errorTelefono(valor: string | null | undefined): string | null {
  const d = soloDigitos(valor);
  if (!d) return 'Indicá el teléfono';
  if (d.length !== LARGO_TELEFONO) {
    return `El teléfono debe tener ${LARGO_TELEFONO} dígitos y tiene ${d.length}`;
  }
  const pre = d.slice(0, 4);
  if ((PREFIJOS_CELULAR as readonly string[]).includes(pre)) return null;
  if (d.startsWith('02')) return null; // fijo (0212, 0286, 0285…)
  return `«${pre}» no es un operador telefónico. Un celular arranca con ${PREFIJOS_CELULAR.join(', ')}; un fijo con 02`;
}

/**
 * El teléfono no puede ser el código del banco elegido ni un número de cuenta.
 * Es el error que de verdad pasó, y el prefijo solo no siempre lo cubre.
 */
export function errorTelefonoContraBanco(telefono: string | null | undefined, banco: string | null | undefined): string | null {
  const t = soloDigitos(telefono);
  const b = soloDigitos(banco);
  if (!t || !b) return null;
  if (t.startsWith(b) && b.length === 4) {
    return `Ese número arranca con «${b}», que es el código del banco: parece la cuenta, no el teléfono`;
  }
  return null;
}

/** Cuenta bancaria: exactamente 20 dígitos. */
export function errorCuenta(valor: string | null | undefined): string | null {
  const d = soloDigitos(valor);
  if (!d) return 'Indicá el número de cuenta';
  if (d.length !== LARGO_CUENTA) {
    return `El número de cuenta debe tener ${LARGO_CUENTA} dígitos y tiene ${d.length}`;
  }
  return null;
}

/**
 * CI o RIF: una letra opcional (V E J G P), los dígitos, y nada más.
 * Se coló un «J-30646306-2 BANESCO»: el nombre del banco pegado al RIF.
 */
export function errorCiRif(valor: string | null | undefined): string | null {
  const s = String(valor ?? '').trim();
  if (!s) return 'Indicá el CI o RIF';
  if (/[A-Za-z]{2,}/.test(s.replace(/^[VEJGPvejgp]\s*[-–]?\s*/, ''))) {
    return 'El CI/RIF lleva solo la letra y los números (ej. J-30646306-2): sacá el texto de más';
  }
  const d = soloDigitos(s);
  if (d.length < 6 || d.length > 10) {
    return `El CI/RIF tiene ${d.length} dígitos: revisá que esté completo`;
  }
  return null;
}
