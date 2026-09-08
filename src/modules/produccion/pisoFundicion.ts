/* ============================================================
   MGG · Fundición · El material entregado al piso
   Una salida de material de MATANZA puede marcar una línea como
   «va para fundición». Ese material se descuenta del inventario AHÍ,
   en la salida, y la fundición después solo puede quemar lo que se
   le entregó — sin volver a descontar. Eso era el doble descuento.

   El disponible NO se guarda en ninguna parte: se calcula.
       disponible = entregado − fundido − devuelto
   Un saldo guardado sería un número más que puede desfasarse del
   inventario; uno calculado no puede mentir sobre sus fuentes.
   ============================================================ */

/** Una línea de salida marcada para fundición (salida ya ejecutada). */
export interface EntregaFundicion {
  producto_id: string;
  producto_nombre?: string | null;
  unidad?: string | null;
  cantidad: number;
  /** Costo unitario al que salió: es lo que va a costar la colada. */
  precio_unit?: number | null;
  /** Código de la salida, para poder decir de qué entrega vino. */
  codigo?: string | null;
  fecha?: string | null;
}

/** Lo que una colada quemó del piso (produccion_materiales.desde_fundicion). */
export interface ConsumoFundicion {
  producto_id: string;
  cantidad: number;
}

/** Material devuelto del piso al inventario (movimiento de entrada). */
export interface DevolucionFundicion {
  producto_id: string;
  cantidad: number;
}

export interface DisponibleFundicion {
  producto_id: string;
  producto_nombre: string;
  unidad: string | null;
  entregado: number;
  fundido: number;
  devuelto: number;
  /** Lo que queda para quemar o devolver. Nunca negativo. */
  disponible: number;
  /** Promedio ponderado de lo entregado: con qué costo entra a la colada. */
  costo_unitario: number;
  /** Entregas que lo alimentaron, de la más vieja a la más nueva. */
  entregas: EntregaFundicion[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * El piso de fundición, producto por producto.
 *
 * Se listan también los productos que quedaron en cero: sirve para ver que se
 * entregó y ya se quemó todo, en vez de que la fila desaparezca sin explicación.
 * Para el desplegable de materiales usá `soloConSaldo`.
 */
export function calcularPisoFundicion(
  entregas: EntregaFundicion[],
  consumos: ConsumoFundicion[],
  devoluciones: DevolucionFundicion[],
): DisponibleFundicion[] {
  const porProducto = new Map<string, DisponibleFundicion>();

  const fila = (id: string): DisponibleFundicion => {
    let f = porProducto.get(id);
    if (!f) {
      f = {
        producto_id: id, producto_nombre: '', unidad: null,
        entregado: 0, fundido: 0, devuelto: 0, disponible: 0,
        costo_unitario: 0, entregas: [],
      };
      porProducto.set(id, f);
    }
    return f;
  };

  for (const e of entregas ?? []) {
    if (!e?.producto_id) continue;
    const cant = num(e.cantidad);
    if (cant <= 0) continue;
    const f = fila(e.producto_id);
    f.entregado = r4(f.entregado + cant);
    if (!f.producto_nombre && e.producto_nombre) f.producto_nombre = e.producto_nombre;
    if (!f.unidad && e.unidad) f.unidad = e.unidad;
    f.entregas.push({ ...e, cantidad: cant });
  }

  for (const c of consumos ?? []) {
    if (!c?.producto_id) continue;
    const f = fila(c.producto_id);
    f.fundido = r4(f.fundido + num(c.cantidad));
  }

  for (const d of devoluciones ?? []) {
    if (!d?.producto_id) continue;
    const f = fila(d.producto_id);
    f.devuelto = r4(f.devuelto + Math.abs(num(d.cantidad)));
  }

  for (const f of porProducto.values()) {
    // Nunca negativo: un consumo viejo mal atribuido no debe dejar el piso en
    // rojo y bloquear la operación. Se muestra 0 y se ve en las columnas.
    f.disponible = r4(Math.max(0, f.entregado - f.fundido - f.devuelto));
    f.entregas.sort((a, b) => String(a.fecha ?? '').localeCompare(String(b.fecha ?? '')));
    // El costo es el promedio ponderado de lo ENTREGADO: la colada tiene que
    // costar lo que costó el material que salió, no el PMP de hoy.
    const conCosto = f.entregas.filter((e) => num(e.precio_unit) > 0);
    const kilos = conCosto.reduce((a, e) => a + num(e.cantidad), 0);
    f.costo_unitario = kilos > 0
      ? r4(conCosto.reduce((a, e) => a + num(e.cantidad) * num(e.precio_unit), 0) / kilos)
      : 0;
  }

  return [...porProducto.values()].sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre, 'es'));
}

/** Solo lo que se puede quemar o devolver hoy. */
export function soloConSaldo(piso: DisponibleFundicion[]): DisponibleFundicion[] {
  return piso.filter((f) => f.disponible > 0);
}

/** Cuánto hay de un producto puntual (0 si no se le entregó nada). */
export function disponibleDe(piso: DisponibleFundicion[], productoId: string | null | undefined): number {
  return piso.find((f) => f.producto_id === productoId)?.disponible ?? 0;
}

/**
 * ¿Se puede sacar esta cantidad? Devuelve el motivo cuando no, para poder
 * mostrarlo al lado del campo en vez de un «no se pudo» genérico.
 */
export function motivoNoAlcanza(
  piso: DisponibleFundicion[], productoId: string, cantidad: number, unidad?: string | null,
): string | null {
  const cant = num(cantidad);
  if (cant <= 0) return 'La cantidad tiene que ser mayor que 0.';
  const hay = disponibleDe(piso, productoId);
  if (hay <= 0) return 'No hay material de este tipo entregado a fundición. Sacalo por Salidas primero.';
  if (cant > hay) {
    const u = unidad ? ` ${unidad}` : '';
    return `Solo hay ${hay}${u} entregados a fundición.`;
  }
  return null;
}
