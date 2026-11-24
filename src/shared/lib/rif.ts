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

/** Normaliza un RIF a J123456789 (sin guiones ni espacios, en mayúsculas). */
export function normalizarRif(rif: string | null | undefined): string {
  return String(rif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * ¿El RIF tiene forma válida? Letra y 9 dígitos, el último de ellos el DÍGITO
 * VERIFICADOR. Un RIF mal escrito invalida el documento donde se imprime, así
 * que conviene cazarlo cuando se carga y no cuando hay que presentarlo.
 */
export function rifValido(rif: string | null | undefined): boolean {
  const v = normalizarRif(rif);
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
  const v = normalizarRif(rif);
  if (rifValido(v)) return v;
  const m = /^([JGVEPC])(\d{1,8})$/.exec(v);
  if (!m) return null;
  const ocho = m[2].padStart(8, '0');
  return `${m[1]}${ocho}${digitoVerificadorRif(m[1], ocho)}`;
}

/** El RIF con guiones, como se escribe en los documentos: J-50129993-5. */
export function formatearRif(rif: string | null | undefined): string {
  const v = normalizarRif(rif);
  if (!/^[A-Z]\d{9}$/.test(v)) return String(rif ?? '');
  return `${v[0]}-${v.slice(1, 9)}-${v[9]}`;
}

/**
 * El CI o RIF de unos datos de pago, como se escribe (04/11/2026): «RIF: J-50046044-9»,
 * «CI: V-12345678», «Pasaporte: P-1131881». Si no trae letra, se toma la del RIF del
 * proveedor cuando son los mismos números; si no, 9 números = RIF jurídico (J) y
 * hasta 8 = cédula venezolana (V). Lo que no tiene forma de documento se deja tal cual.
 */
export function documentoIdentidad(
  raw: string | null | undefined,
  rifProveedor?: string | null,
): { etiqueta: 'RIF' | 'CI' | 'Pasaporte' | 'CI/RIF'; valor: string } | null {
  const texto = String(raw ?? '').trim();
  if (!texto) return null;
  const m = /^([JGVEPC])?(\d{5,10})$/.exec(normalizarRif(texto));
  if (!m) return { etiqueta: 'CI/RIF', valor: texto };
  const digitos = m[2];
  let letra = m[1];
  if (!letra) {
    const prov = normalizarRif(rifProveedor);
    if (/^[JGVEPC]\d+$/.test(prov) && (prov.slice(1) === digitos || prov.slice(1, 9) === digitos)) letra = prov[0];
    else letra = digitos.length >= 9 ? 'J' : 'V';
  }
  if (letra === 'P') return { etiqueta: 'Pasaporte', valor: `P-${digitos}` };
  if (digitos.length === 9) return { etiqueta: 'RIF', valor: `${letra}-${digitos.slice(0, 8)}-${digitos[8]}` };
  if (letra === 'J' || letra === 'G' || letra === 'C') return { etiqueta: 'RIF', valor: `${letra}-${digitos}` };
  return { etiqueta: 'CI', valor: `${letra}-${digitos}` };
}
