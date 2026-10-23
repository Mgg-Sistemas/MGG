/* ============================================================
   Golden Touch · Retenciones · Qué RIF está mal y dónde se corrige (D43)

   El registro se bloquea con un RIF inválido, y el mensaje dice CUÁL y
   DÓNDE: en una practicada el RIF viene de la ficha del proveedor (solo
   lectura aquí), así que se corrige en Proveedores; en una recibida se
   escribió en el formulario.
   ============================================================ */

export interface TextoRif {
  /** El mensaje que bloquea el registro. */
  error: string;
  /** La línea corta bajo el campo. */
  hint: string;
}

/** Los textos de un RIF inválido. `direccion`: quién retuvo; `nombre`: el proveedor o la contraparte. */
export function textoRifInvalido(o: { direccion: 'practicada' | 'recibida'; rif: string; nombre?: string | null }): TextoRif {
  const rif = o.rif.trim();
  const nombre = o.nombre?.trim();
  if (o.direccion === 'practicada') {
    return {
      error: `El RIF del proveedor ${nombre ? `«${nombre}» ` : ''}es «${rif}» y no es válido. Corrígelo en su ficha (Proveedores) y vuelve a intentarlo.`,
      hint: `El RIF «${rif}» no es válido: se corrige en la ficha del proveedor.`,
    };
  }
  return {
    error: `El RIF «${rif}» no es válido: revisa la letra, los números y el dígito verificador.`,
    hint: `«${rif}» no es válido: letra, 8 o 9 números y dígito verificador.`,
  };
}

/** La ruta de la ficha del proveedor (Proveedores abre el detalle con ?detalle=). */
export const rutaFichaProveedor = (proveedorId: string) => `/app/proveedores?detalle=${encodeURIComponent(proveedorId)}`;
