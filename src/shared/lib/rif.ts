// Prefijos de RIF válidos en Venezuela (SENIAT). Compartido por el formulario de
// proveedores y por el alta de proveedor en línea desde una OC.
export const PREFIJOS_RIF: { letra: string; desc: string }[] = [
  { letra: 'J', desc: 'Jurídico (empresa)' },
  { letra: 'V', desc: 'Venezolano (natural)' },
  { letra: 'E', desc: 'Extranjero' },
  { letra: 'P', desc: 'Pasaporte' },
  { letra: 'G', desc: 'Gubernamental' },
  { letra: 'C', desc: 'Consejo comunal' },
];

export const LETRAS_RIF = PREFIJOS_RIF.map((p) => p.letra);

/** Separa un RIF guardado ("J-40778442") en su letra y su número (máx. 10 dígitos). */
export function partirRif(rif: string): { letra: string; numero: string } {
  const limpio = (rif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const letra = LETRAS_RIF.includes(limpio[0]) ? limpio[0] : 'J';
  const numero = limpio.replace(/^[A-Z]/, '').slice(0, 10);
  return { letra, numero };
}

/** Limpia un RIF quitando guiones y espacios (ej.: J123456789). */
export function limpiarRif(rif: string | null | undefined): string {
  return String(rif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Forma ÚNICA de guardar el RIF (14-10-2026): «LETRA-DÍGITOS», sin puntos, guiones ni
 * espacios en el número («J-123456789»). La usan el formulario de Proveedores, el alta
 * de proveedor desde una oferta y el alta rápida desde compra o servicio directo, así
 * «J-12345678-9» y «J-123456789» son el mismo proveedor. Sin dígitos devuelve ''.
 */
export function normalizarRif(rif?: string | null): string {
  const { letra, numero } = partirRif(rif ?? '');
  return numero ? `${letra}-${numero}` : '';
}

/**
 * ¿El RIF tiene forma válida? Letra y 9 dígitos, el último de ellos el DÍGITO
 * VERIFICADOR. Un RIF mal escrito invalida el documento donde se imprime, así
 * que conviene cazarlo cuando se carga y no cuando hay que presentarlo.
 */
export function rifValido(rif: string | null | undefined): boolean {
  const v = limpiarRif(rif);
  if (!/^[JGVEPC]\d{9}$/.test(v)) return false;
  return digitoVerificadorRif(v[0], v.slice(1, 9)) === Number(v[9]);
}

/** El dígito verificador (SENIAT) de una letra y sus 8 números. */
export function digitoVerificadorRif(letra: string, ocho: string): number {
  const pesos = [3, 2, 7, 6, 5, 4, 3, 2];
  const letras: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5, C: 3 };
  let suma = (letras[letra] ?? 0) * 4;
  for (let i = 0; i < 8; i += 1) suma += Number(ocho[i]) * pesos[i];
  const dv = 11 - (suma % 11);
  return dv === 11 || dv === 10 ? 0 : dv;
}

/**
 * El RIF completo (J123456789) si es válido o si solo le falta el dígito
 * verificador: con la letra y hasta 8 números, el dígito se calcula (hay uno
 * solo posible) y los números se completan con ceros a la izquierda, como la
 * cédula en el RIF de una persona. null si no tiene arreglo (9 números con el
 * dígito equivocado, letra que no existe, texto como «S/R»).
 */
export function completarRif(rif: string | null | undefined): string | null {
  const v = limpiarRif(rif);
  if (rifValido(v)) return v;
  const m = /^([JGVEPC])(\d{1,8})$/.exec(v);
  if (!m) return null;
  const ocho = m[2].padStart(8, '0');
  return `${m[1]}${ocho}${digitoVerificadorRif(m[1], ocho)}`;
}

/** El RIF con guiones, como se escribe en los documentos: J-50129993-5. */
export function formatearRif(rif: string | null | undefined): string {
  const v = limpiarRif(rif);
  if (!/^[A-Z]\d{9}$/.test(v)) return String(rif ?? '');
  return `${v[0]}-${v.slice(1, 9)}-${v[9]}`;
}
