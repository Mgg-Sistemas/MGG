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

/**
 * Forma ÚNICA de guardar el RIF (14-10-2026): «LETRA-DÍGITOS», sin puntos, guiones ni
 * espacios en el número («J-123456789»). La usan el formulario de Proveedores, el alta
 * de proveedor desde una oferta y el alta rápida desde compra o servicio directo, así
 * «J-12345678-9» y «J-123456789» son el mismo proveedor. Sin dígitos devuelve ''.
 */
export function normalizarRif(rif: string | null | undefined): string {
  const { letra, numero } = partirRif(rif ?? '');
  return numero ? `${letra}-${numero}` : '';
}
