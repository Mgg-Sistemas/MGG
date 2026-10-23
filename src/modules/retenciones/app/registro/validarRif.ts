/* ============================================================
   MGG · Retenciones v8 · El RIF de la contraparte

   El comprobante y el TXT llevan el RIF del proveedor; hoy ni la pantalla
   ni la base lo validan (informes/2026-10-20-validacion-campos-v8.md).
   · Formato: una letra válida (J, V, E, P, G o C) y 9 dígitos (8 y el
     verificador). Si no cuadra, no se registra y se dice por qué.
   · Dígito verificador (módulo 11 del SENIAT): solo AVISA, hasta que la
     base tenga su función `rif_valido` y el área fiscal confirme la regla
     (la letra C no tiene peso publicado). Así una regla mal calibrada no
     frena un registro legítimo.
   Nada se corrige en silencio: una letra inválida no pasa a «J».
   ============================================================ */

const LETRAS = ['J', 'V', 'E', 'P', 'G', 'C'];
/** El peso de la letra en el cálculo del verificador. La C no tiene uno publicado. */
const PESO_LETRA: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 };
const PESOS = [3, 2, 7, 6, 5, 4, 3, 2];

export interface RevisionRif {
  /** Impide registrar. */
  error: string | null;
  /** Solo avisa. */
  aviso: string | null;
}

/** El verificador que corresponde a una letra y 8 dígitos, o null si la letra no tiene peso. */
export function digitoVerificador(letra: string, ocho: string): number | null {
  const peso = PESO_LETRA[letra];
  if (peso == null || !/^\d{8}$/.test(ocho)) return null;
  const suma = peso * 4 + [...ocho].reduce((a, d, i) => a + Number(d) * PESOS[i], 0);
  const dv = 11 - (suma % 11);
  return dv >= 10 ? 0 : dv;
}

export function revisarRif(rif: string | null | undefined): RevisionRif {
  const crudo = (rif ?? '').trim();
  if (!crudo) return { error: 'El proveedor no tiene RIF en su ficha: cargarlo en Proveedores antes de registrar.', aviso: null };
  const limpio = crudo.toUpperCase().replace(/[\s.-]/g, '');
  const letra = limpio[0];
  if (!LETRAS.includes(letra)) return { error: `El RIF del proveedor («${crudo}») empieza con una letra que no es válida: J, V, E, P, G o C.`, aviso: null };
  const digitos = limpio.slice(1);
  if (!/^\d{9}$/.test(digitos)) {
    return { error: `El RIF del proveedor («${crudo}») debe tener 9 dígitos después de la letra (8 y el verificador). Corregirlo en Proveedores.`, aviso: null };
  }
  const esperado = digitoVerificador(letra, digitos.slice(0, 8));
  if (esperado != null && esperado !== Number(digitos[8])) {
    return { error: null, aviso: `El dígito verificador del RIF («${crudo}») no cuadra: debería ser ${esperado}. Verificarlo en el Portal Fiscal.` };
  }
  return { error: null, aviso: null };
}
