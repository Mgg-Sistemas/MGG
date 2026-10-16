/* ============================================================
   MGG · Retenciones · Varias líneas por documento

   Una factura puede llevar varias líneas de un mismo impuesto, cada una con
   su fila de la tabla de clasificación (un concepto, una actividad) y su %
   (decisión del usuario, 14/10 10:14). Cada línea es una fila de
   `retenciones` con su propia foto (acordado con BD, 16/10).

   El mínimo y el sustraendo van «por línea» por defecto (usuario, 14/10
   13:27). Con alcance «factura», lo dice la regla:
   · el mínimo se compara con la base de todo el documento;
   · el sustraendo se calcula con la primera línea y se descuenta una sola
     vez; si la primera línea no lo absorbe entero, sigue en la siguiente.
   ============================================================ */

import {
  calcularLinea, redondear, sustraendoDelDocumento,
  type ContextoCalculo, type EntradaLinea, type ResultadoCalculo,
} from './motor';
import { fmt2 } from './numeros';
import type { Componente, FilaClasificacion, SupuestoMarcado, TipoDocumento, VersionRegla } from './regla';

export interface LineaDocumento {
  montos: Readonly<Partial<Record<Componente, number>>>;
  fila: FilaClasificacion | null;
}

export interface EntradaDocumento {
  moneda: string;
  tipo: TipoDocumento;
  supuestos: readonly SupuestoMarcado[];
  lineas: readonly LineaDocumento[];
}

export interface ResultadoDocumento {
  estado: 'calculado' | 'sin_dato';
  lineas: ResultadoCalculo[];
  /** Con su signo. 0 si alguna línea no se pudo calcular: el total no se da por bueno. */
  total: number;
}

export function calcularDocumento(version: VersionRegla, doc: EntradaDocumento, ctx: ContextoCalculo): ResultadoDocumento {
  const entrada = (l: LineaDocumento): EntradaLinea => ({ montos: l.montos, moneda: doc.moneda, tipo: doc.tipo, fila: l.fila, supuestos: doc.supuestos });
  const p = version.pasos ?? {};
  const minimoFactura = p.minimo?.alcance === 'factura';
  const sustraendoFactura = p.sustraendo?.alcance === 'factura';

  if (!doc.lineas.length) return { estado: 'calculado', lineas: [], total: 0 };
  if (!minimoFactura && !sustraendoFactura) return cerrar(doc.lineas.map((l) => calcularLinea(version, entrada(l), ctx)));

  // La base de cada línea (pasos 1 y 2), para el mínimo del documento.
  let baseMinimo: number | undefined;
  if (minimoFactura) {
    const sinMinimo = { ...version, pasos: { ...p, minimo: null } };
    const previas = doc.lineas.map((l) => calcularLinea(sinMinimo, entrada(l), ctx));
    const falla = previas.find((r) => r.estado === 'sin_dato');
    if (falla) return cerrar(previas);
    baseMinimo = previas.reduce((a, r) => a + (r.estado === 'calculado' ? r.base : 0), 0);
  }

  let disponible: number | undefined;
  if (sustraendoFactura) {
    const primera = sustraendoDelDocumento(version, entrada(doc.lineas[0]), ctx);
    if (primera.estado === 'sin_dato') return cerrar([primera]);
    disponible = primera.sustraendo;
  }

  const resultados: ResultadoCalculo[] = [];
  let lineaQueAbsorbio = 0;
  doc.lineas.forEach((l, i) => {
    const nota = disponible === 0 && lineaQueAbsorbio ? `El sustraendo del documento se descontó en la línea ${lineaQueAbsorbio}.` : undefined;
    const r = calcularLinea(version, entrada(l), ctx, { baseMinimo, sustraendoDisponible: disponible, notaSustraendo: nota });
    if (disponible != null && r.estado === 'calculado' && r.sustraendo > 0) {
      disponible = redondear(Math.max(0, disponible - r.sustraendo), 6);
      lineaQueAbsorbio = i + 1;
    }
    resultados.push(r);
  });
  // Lo que sobra después de la última línea se pierde (nunca negativo), y la foto lo dice.
  const ultima = resultados[resultados.length - 1];
  if (disponible != null && disponible > 0 && ultima?.estado === 'calculado') {
    ultima.foto.pasos.push({
      paso: 'sustraendo', operacion: 'sobrante', entradas: { sobrante: redondear(disponible) }, valor: ultima.magnitud,
      nota: `Quedaron ${fmt2(redondear(disponible))} del sustraendo sin descontar: las líneas no alcanzan.`,
    });
  }
  return cerrar(resultados);
}

function cerrar(lineas: ResultadoCalculo[]): ResultadoDocumento {
  if (lineas.some((r) => r.estado === 'sin_dato')) return { estado: 'sin_dato', lineas, total: 0 };
  const total = redondear(lineas.reduce((a, r) => a + (r.estado === 'calculado' ? r.monto : 0), 0));
  return { estado: 'calculado', lineas, total };
}

/** Reparte un monto según unos pesos (por ejemplo, 60 y 40); la última parte absorbe el redondeo. */
export function repartirBase(total: number, pesos: readonly number[]): number[] {
  const suma = pesos.reduce((a, p) => a + p, 0);
  if (!pesos.length || suma <= 0) return pesos.map(() => 0);
  const partes = pesos.slice(0, -1).map((p) => redondear((total * p) / suma));
  return [...partes, redondear(total - partes.reduce((a, p) => a + p, 0))];
}

export type Bloqueo = { bloquea: false } | { bloquea: true; codigo: string | null; motivo: string };

/**
 * Una regla que exige tabla no se registra sin una fila de esa tabla: sin
 * código, queda por definir; con un código que no está, se bloquea
 * (la actividad fuera del catálogo, 14/10 10:25). `tabla` es el nombre de
 * la tabla de clasificación, tal como está en el catálogo.
 */
export function bloqueoPorFila(codigo: string | null, tabla: string, filas: ReadonlyMap<string, FilaClasificacion>): Bloqueo {
  if (!codigo) return { bloquea: true, codigo: null, motivo: `Por definir: falta el código de «${tabla}» de la contraparte.` };
  if (!filas.has(codigo)) {
    return { bloquea: true, codigo, motivo: `No se registra: el código ${codigo} no está en «${tabla}», y sin él no hay %.` };
  }
  return { bloquea: false };
}
