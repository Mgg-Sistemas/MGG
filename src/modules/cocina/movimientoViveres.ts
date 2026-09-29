/* ============================================================
   MGG · Cocina · Qué pasó con cada víver en un período

   La pregunta que el resumen no sabía contestar: «¿cuánto HABÍA, cuánto se
   COMIÓ, qué se fue por inventario y cuánto QUEDA?». El modal mostraba el
   consumo por un lado y el stock de hoy por el otro, sin nada que los uniera:
   había que sacar la cuenta a mano y nunca daba, porque entre medio pasan
   entradas de compra, traslados, salidas manuales y ajustes.

   Acá se arma el renglón completo, y cierra por construcción:

       había + entradas + traslados − consumido − salidas = queda

   CÓMO SE SABE LO QUE HABÍA. No se guarda en ningún lado: se reconstruye
   caminando el kardex hacia atrás desde el stock de HOY, que es el único dato
   que no puede mentir.

       queda = stock_hoy − Σ movimientos posteriores a `hasta`
       había = stock_hoy − Σ movimientos desde `desde` en adelante

   Un saldo guardado sería un número más que puede desfasarse; uno reconstruido
   no puede contradecir a sus fuentes.

   ⚠ Esto SOLO da exacto porque el movimiento de una comida se fecha con la
   COMIDA (29-09-2026, ver `crearComida`). Mientras la salida llevaba la hora en
   que alguien la tecleaba, el consumo caía en un período y su descuento de
   stock en otro, y este renglón no habría cerrado nunca.
   ============================================================ */
import { deltaEfectivo } from './mercadoComparar';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Un movimiento del kardex, con lo justo para clasificarlo. */
export interface MovimientoViver {
  producto_id: string;
  at: string;
  delta: number;
  stock_antes?: number | null;
  stock_despues?: number | null;
  tipo?: string | null;
  ref_tipo?: string | null;
  detalle?: string | null;
  actor_name?: string | null;
  almacen?: string | null;
  precio_unitario?: number | null;
  costo_promedio?: number | null;
}

/**
 * En qué columna cae un movimiento.
 *
 * Son las cuatro cosas distintas que le pueden pasar a un víver, y se separan
 * porque contestan preguntas distintas: `comida` es lo que se sirvió, `salida`
 * es lo que se fue sin servirse (y hay que explicar), `entrada` es lo que se
 * repuso y `traslado` es lo que cambió de almacén sin salir de la empresa.
 */
export type ClaseMovimiento = 'entrada' | 'traslado' | 'comida' | 'salida';

/** Un renglón del kardex del víver, ya clasificado. */
export interface RenglonKardex {
  at: string;
  clase: ClaseMovimiento;
  /** Con signo, y ya topado: lo que el almacén movió de verdad. */
  delta: number;
  /** El `tipo` del kardex: entrada, salida, ajuste, transferencia… */
  tipo: string;
  motivo: string | null;
  actor: string | null;
  almacen: string | null;
}

/** Una salida o ajuste hecho desde Inventario: lo que hay que poder señalar. */
export interface SalidaDeInventario {
  producto_id: string;
  at: string;
  /** Positivo: cuánto salió. */
  cantidad: number;
  /** 'salida', 'ajuste', 'transferencia'… tal como lo guarda el kardex. */
  tipo: string;
  motivo: string | null;
  actor: string | null;
  almacen: string | null;
}

export interface FilaViver {
  producto_id: string;
  sku: string;
  nombre: string;
  unidad: string;
  precio: number;
  /** Lo que había al empezar el período (reconstruido). */
  habia: number;
  /** Entró por compra/recepción/ajuste al alza. No incluye traslados. */
  entradas: number;
  /** Neto de traslados entre almacenes, con signo. */
  traslados: number;
  /** Lo que se comió: salidas de las comidas de cocina. */
  consumido: number;
  /** Lo que salió por Inventario sin ser comida ni traslado: salidas y ajustes a la baja. */
  salidas: number;
  /** Lo que queda al cerrar el período. */
  queda: number;
  /** Valor de lo consumido, al costo del movimiento. */
  valorConsumido: number;
  /** Cada salida/ajuste de inventario, para poder mostrarlas una por una. */
  detalleSalidas: SalidaDeInventario[];
  /**
   * TODO lo que le pasó al víver en el período, movimiento por movimiento,
   * de lo más nuevo a lo más viejo. Es lo que hace «detallado» al reporte: el
   * total de la columna dice cuánto, y esto dice cuándo, de dónde y por qué.
   */
  movimientos: RenglonKardex[];
}

/** Datos del producto que el kardex no trae. */
export interface FichaViver {
  id: string; sku: string; nombre: string; unidad?: string | null; precio?: number | null;
}

/**
 * ¿El movimiento es una comida de cocina?
 *
 * Se mira `ref_tipo`, no el texto: el detalle lo escribe una persona y cambia.
 * Incluye los REVERSOS (delta > 0) de editar o borrar una comida, que también
 * llevan `ref_tipo='cocina'` y tienen que restar del consumo, no sumar entradas.
 */
export function esDeCocina(m: Pick<MovimientoViver, 'ref_tipo'>): boolean {
  return (m.ref_tipo ?? '') === 'cocina';
}

/** ¿Es una de las dos patas de un traslado entre almacenes? */
export function esTraslado(m: Pick<MovimientoViver, 'tipo'>): boolean {
  return (m.tipo ?? '') === 'transferencia';
}

/**
 * Qué pasó con cada víver entre `desde` y `hasta`.
 *
 * `movs` tiene que traer TODOS los movimientos desde `desde` en adelante
 * (incluidos los posteriores a `hasta`): los de después son los que permiten
 * retroceder el stock de hoy hasta el cierre del período.
 *
 * Se devuelven solo los víveres que tuvieron algo: un catálogo entero en cero
 * no dice nada y esconde las tres filas que importan.
 */
export function movimientoDeViveres(
  fichas: FichaViver[],
  stockHoy: Map<string, number>,
  movs: MovimientoViver[],
  desde: string,
  hasta: string,
): FilaViver[] {
  const t0 = Date.parse(desde);
  const t1 = Date.parse(hasta);
  const porId = new Map<string, FilaViver>();

  const fila = (f: FichaViver): FilaViver => {
    let x = porId.get(f.id);
    if (!x) {
      x = {
        producto_id: f.id, sku: f.sku, nombre: f.nombre, unidad: f.unidad ?? '',
        precio: Number(f.precio) || 0,
        habia: 0, entradas: 0, traslados: 0, consumido: 0, salidas: 0, queda: 0,
        valorConsumido: 0, detalleSalidas: [], movimientos: [],
      };
      porId.set(f.id, x);
    }
    return x;
  };

  // Arranque: había y queda parten del stock de hoy y se caminan hacia atrás.
  const fichaDe = new Map(fichas.map((f) => [f.id, f] as const));
  for (const f of fichas) {
    const x = fila(f);
    const hoy = Number(stockHoy.get(f.id)) || 0;
    x.habia = hoy;
    x.queda = hoy;
  }

  for (const m of movs) {
    const f = fichaDe.get(m.producto_id);
    if (!f) continue;                       // no es un víver de cocina
    const t = Date.parse(m.at);
    if (!Number.isFinite(t) || t < t0) continue;
    const x = fila(f);
    // Lo que el almacén movió DE VERDAD (una salida de más queda topada en 0).
    const d = r2(deltaEfectivo(m));

    // Retroceder el stock: todo lo que pasó desde `desde` sale de «había»; lo
    // posterior a `hasta` sale además de «queda».
    x.habia = r2(x.habia - d);
    if (t > t1) { x.queda = r2(x.queda - d); continue; }  // fuera del período: solo corre el saldo

    const tipo = String(m.tipo ?? 'salida');
    const motivo = (m.detalle ?? '')?.trim() || null;
    const actor = (m.actor_name ?? '')?.trim() || null;
    const alm = (m.almacen ?? '')?.trim() || null;
    const anotar = (clase: ClaseMovimiento) =>
      x.movimientos.push({ at: m.at, clase, delta: d, tipo, motivo, actor, almacen: alm });

    if (esDeCocina(m)) {
      // El reverso de una comida editada o borrada devuelve stock: resta consumo.
      x.consumido = r2(x.consumido - d);
      const precio = Number(m.costo_promedio) || Number(m.precio_unitario) || x.precio;
      x.valorConsumido = r2(x.valorConsumido - d * precio);
      anotar('comida');
      continue;
    }
    if (esTraslado(m)) { x.traslados = r2(x.traslados + d); anotar('traslado'); continue; }
    if (d > 0) { x.entradas = r2(x.entradas + d); anotar('entrada'); continue; }
    if (d < 0) {
      x.salidas = r2(x.salidas - d);
      anotar('salida');
      x.detalleSalidas.push({
        producto_id: f.id, at: m.at, cantidad: r2(-d), tipo, motivo, actor, almacen: alm,
      });
    }
  }

  const filas = [...porId.values()].filter(
    (x) => x.habia !== 0 || x.queda !== 0 || x.entradas !== 0 || x.consumido !== 0 || x.salidas !== 0 || x.traslados !== 0,
  );
  for (const x of filas) {
    x.detalleSalidas.sort((a, b) => b.at.localeCompare(a.at));
    x.movimientos.sort((a, b) => b.at.localeCompare(a.at));
  }
  // Lo más consumido primero: es lo que se va a mirar.
  return filas.sort((a, b) => b.consumido - a.consumido || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface TotalesViveres {
  habia: number; entradas: number; traslados: number;
  consumido: number; salidas: number; queda: number;
  valorConsumido: number;
  /** Cuántos víveres tuvieron alguna salida o ajuste por inventario. */
  conSalidas: number;
  /** Cuántos quedaron en cero. */
  enCero: number;
}

/**
 * Los totales del pie.
 *
 * OJO: sumar cantidades de unidades distintas (kg con unidades) no da una
 * magnitud con sentido físico. Se totaliza igual porque sirve para CUADRAR
 * —la fila de totales también cumple había + entradas + traslados − consumido
 * − salidas = queda— y porque el valor en $ sí es comparable.
 */
export function totalesDeViveres(filas: FilaViver[]): TotalesViveres {
  const t: TotalesViveres = {
    habia: 0, entradas: 0, traslados: 0, consumido: 0, salidas: 0, queda: 0,
    valorConsumido: 0, conSalidas: 0, enCero: 0,
  };
  for (const f of filas) {
    t.habia = r2(t.habia + f.habia);
    t.entradas = r2(t.entradas + f.entradas);
    t.traslados = r2(t.traslados + f.traslados);
    t.consumido = r2(t.consumido + f.consumido);
    t.salidas = r2(t.salidas + f.salidas);
    t.queda = r2(t.queda + f.queda);
    t.valorConsumido = r2(t.valorConsumido + f.valorConsumido);
    if (f.detalleSalidas.length) t.conSalidas += 1;
    if (f.queda <= 0) t.enCero += 1;
  }
  return t;
}

/** Cómo se llama cada clase de movimiento en pantalla y en el papel. */
export const ETIQUETA_CLASE: Record<ClaseMovimiento, string> = {
  entrada: 'Entrada',
  traslado: 'Traslado',
  comida: 'Comida',
  salida: 'Salida / ajuste',
};

/** Un renglón del kardex con el víver al que pertenece. */
export interface RenglonConViver extends RenglonKardex {
  producto_id: string; sku: string; nombre: string; unidad: string;
}

/**
 * El kardex detallado del período: cada movimiento de cada víver.
 *
 * Agrupado por víver (alfabético) y, dentro de cada uno, de lo más viejo a lo
 * más nuevo — que es como se lee un kardex: se sigue el saldo hacia adelante.
 * `clases` acota a lo que se quiera ver (ej. solo salidas y ajustes).
 */
export function kardexDetallado(
  filas: FilaViver[],
  clases?: ClaseMovimiento[],
): RenglonConViver[] {
  const filtra = clases && clases.length ? new Set(clases) : null;
  return [...filas]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .flatMap((f) => f.movimientos
      .filter((m) => !filtra || filtra.has(m.clase))
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((m) => ({ ...m, producto_id: f.producto_id, sku: f.sku, nombre: f.nombre, unidad: f.unidad })));
}

/** Todas las salidas/ajustes de inventario del período, de la más nueva a la más vieja. */
export function salidasDeInventario(filas: FilaViver[]): Array<SalidaDeInventario & { nombre: string; sku: string; unidad: string }> {
  const out = filas.flatMap((f) => f.detalleSalidas.map((s) => ({
    ...s, nombre: f.nombre, sku: f.sku, unidad: f.unidad,
  })));
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
