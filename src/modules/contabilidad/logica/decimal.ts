/* ============================================================
   MGG · Contabilidad · Aritmética decimal exacta (lógica pura)

   Los montos se cuentan en CENTAVOS y las tasas en MILLONÉSIMAS, como
   enteros (BigInt): monto × tasa y monto ÷ tasa se redondean a centavos
   con «mitad hacia arriba» (HALF_UP), igual que el Decimal de Python del
   generador del Carril BD y que numeric(18,2) de Postgres. Así ningún
   centavo depende de la coma flotante: con miles de asientos, un
   x.xx5 mal representado basta para descuadrar un comprobante.
   ============================================================ */

/** Un decimal escrito como texto («1234.56», «-0.5», «710.674415») a entero con `escala` decimales. */
export function aEntero(valor: string | number, escala: number): bigint {
  const texto = typeof valor === 'number' ? valor.toFixed(escala) : valor.trim();
  const neg = texto.startsWith('-');
  const [ent, fr = ''] = (neg ? texto.slice(1) : texto).split('.');
  if (!/^\d*$/.test(ent) || !/^\d*$/.test(fr)) throw new Error(`Número no válido: «${texto}».`);
  const resto = fr.slice(escala);
  let n = BigInt(ent || '0') * 10n ** BigInt(escala) + BigInt((fr.slice(0, escala) + '0'.repeat(escala)).slice(0, escala) || '0');
  // Lo que pase de la escala se redondea mitad hacia arriba (lejos de cero).
  if (resto && resto[0] >= '5') n += 1n;
  return neg ? -n : n;
}

export const aCentavos = (v: string | number): bigint => aEntero(v, 2);
export const aMillonesimas = (v: string | number): bigint => aEntero(v, 6);

/** a ÷ b redondeado a entero, mitad lejos de cero. */
function dividirRedondeado(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('División por cero.');
  const neg = (a < 0n) !== (b < 0n);
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (2n * x + y) / (2n * y);
  return neg ? -q : q;
}

/** centavos × tasa (en millonésimas) → centavos, HALF_UP. */
export const multiplicarTasa = (centavos: bigint, tasa: bigint): bigint => dividirRedondeado(centavos * tasa, 1_000_000n);

/** centavos ÷ tasa (en millonésimas) → centavos, HALF_UP. */
export const dividirTasa = (centavos: bigint, tasa: bigint): bigint => dividirRedondeado(centavos * 1_000_000n, tasa);

/** De centavos al número del modelo (numeric(18,2)). */
export const deCentavos = (c: bigint): number => Number(c) / 100;

/** De millonésimas al número del modelo (numeric(18,6)). */
export const deMillonesimas = (m: bigint): number => Number(m) / 1_000_000;
