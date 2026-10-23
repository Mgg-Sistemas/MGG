/* ============================================================
   MGG · Retenciones v8 · El salto directo a un N° de comprobante (lógica pura)

   El de la maqueta (v8-3-listas.js:234, v8Directo): si lo buscado es un N°
   completo (de 8 a 14 cifras), la lista dice a cuál corresponde y ofrece
   «Abrir»; si el mismo número existe en varias series (cada impuesto numera
   aparte, y las de clientes traen la serie del cliente), se dice y se elige.
   ============================================================ */
import type { RetencionPracticada } from '../datos/puerta';
import { nombreImpuesto } from './pendientesPorDocumento';
import { estadoDe } from './realizadasYLibro';

export interface OpcionDirecto { r: RetencionPracticada; texto: string }

export type Directo =
  | { tipo: 'uno'; numero: string; r: RetencionPracticada; texto: string }
  | { tipo: 'varios'; numero: string; series: string; opciones: OpcionDirecto[] }
  | { tipo: 'ninguno'; numero: string };

const serie = (r: RetencionPracticada) => `${nombreImpuesto(r.tipo)}${r.direccion === 'recibida' ? ' de un cliente' : ''}`;
const texto = (r: RetencionPracticada) => `${serie(r)} · ${r.contraparteNombre ?? '—'} · ${estadoDe(r)}`;

export function directoPorNumero(q: string, retenciones: readonly RetencionPracticada[]): Directo | null {
  const numero = String(q ?? '').trim();
  if (!/^\d{8,14}$/.test(numero)) return null;
  const xs = retenciones.filter((r) => r.numeroComprobante === numero);
  if (xs.length === 1) return { tipo: 'uno', numero, r: xs[0], texto: texto(xs[0]) };
  if (xs.length > 1) return { tipo: 'varios', numero, series: xs.map(serie).join(' · '), opciones: xs.map((r) => ({ r, texto: texto(r) })) };
  return { tipo: 'ninguno', numero };
}
