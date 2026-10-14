/* ============================================================
   MGG · RRHH · Directorio de fotos del personal (14-10-2026)

   Traído de La Cantera (nómina → «Directorio con fotos») con otro formato:
   en pantalla las fotos van una AL LADO de la otra (tarjetas con nombre y
   cargo); al imprimir van una DEBAJO de la otra (una fila por persona, como
   el PDF original). Solo lo ve la administración: una lista con caras es un
   dato más sensible que una tabla de nombres.

   Acá vive lo que no toca el navegador: la cuenta del encuadre de la foto
   (la misma que usan los carnets: zoom + posición), el texto de cada tarjeta
   y el orden del directorio.
   ============================================================ */
import type { Personal } from '@/shared/lib/types';

export interface PersonaDirectorio {
  id: string;
  ficha: string;
  nombre: string;
  cargo: string;
  departamento: string;
  cedula: string;
  fechaIngreso: string | null;
  /** Ya recortada con el encuadre de la persona (JPEG data URL). Null sin foto o si no cargó. */
  fotoDataUrl: string | null;
}

/** Dónde y de qué tamaño se dibuja la imagen dentro de un marco w×h, con el encuadre guardado en la ficha. */
export function encuadreFoto(
  img: { width: number; height: number },
  w: number, h: number,
  p: Pick<Personal, 'foto_zoom' | 'foto_pos_x' | 'foto_pos_y'>,
): { x: number; y: number; dw: number; dh: number } {
  const zoom = Math.min(4, Math.max(1, Number(p.foto_zoom) || 1));
  const posX = Math.min(1, Math.max(0, p.foto_pos_x == null ? 0.5 : Number(p.foto_pos_x)));
  const posY = Math.min(1, Math.max(0, p.foto_pos_y == null ? 0.5 : Number(p.foto_pos_y)));
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  return { x: -(dw - w) * posX, y: -(dh - h) * posY, dw, dh };
}

/** Iniciales para el marco sin foto. */
export function inicialesDe(p: Pick<Personal, 'nombre' | 'apellido'>): string {
  const a = (p.nombre ?? '').trim()[0] ?? '';
  const b = (p.apellido ?? '').trim()[0] ?? '';
  return (a + b).toUpperCase() || '·';
}

export const nombreCompleto = (p: Pick<Personal, 'nombre' | 'apellido'>) => `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim();

/** «Cargo · Departamento» (lo que haya). */
export function textoCargo(p: Pick<Personal, 'cargo' | 'departamento'>): string {
  return [p.cargo, p.departamento].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ') || 'Sin cargo';
}

/** Los datos de la persona sin la foto (la foto la resuelve el navegador aparte). */
export function personaDirectorio(p: Personal): Omit<PersonaDirectorio, 'fotoDataUrl'> {
  return {
    id: p.id,
    ficha: (p.numero_ficha ?? '').trim(),
    nombre: nombreCompleto(p),
    cargo: (p.cargo ?? '').trim(),
    departamento: (p.departamento ?? '').trim(),
    cedula: (p.cedula ?? '').trim(),
    fechaIngreso: p.fecha_ingreso ?? null,
  };
}

/** Orden del directorio: por departamento y nombre (así se lee en pared). */
export function ordenarDirectorio<T extends { departamento: string; nombre: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => (a.departamento || 'zzz').localeCompare(b.departamento || 'zzz', 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

/** «3 de 48 personas · filtro aplicado» para el encabezado. */
export function resumenDirectorio(cuantos: number, total: number): string {
  const p = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;
  return cuantos === total ? `${p(total)} · todo el personal del listado` : `${p(cuantos)} de ${total} · con el filtro de la lista`;
}
