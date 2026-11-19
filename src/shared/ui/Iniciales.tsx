/* ============================================================
   MGG · Iniciales de una persona
   El avatar del sistema: las iniciales sobre el color de su ROL.
   Nació en el Directorio de Usuarios y lo usa también
   Ajustes, para que un mismo color signifique el mismo rol en
   todo el sistema.
   ============================================================ */
import type { CSSProperties } from 'react';
import './iniciales.css';

export interface InicialesProps {
  nombre?: string | null;
  apellido?: string | null;
  /** Respaldo cuando no hay nombre ni apellido (normalmente el correo). */
  respaldo?: string | null;
  /** Color del rol (`custom_roles.color`). Sin él usa el gris del sistema. */
  color?: string | null;
  tamano?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function calcularIniciales(nombre?: string | null, apellido?: string | null, respaldo?: string | null): string {
  const n = (nombre ?? '').trim();
  const a = (apellido ?? '').trim();
  const letras = `${n.charAt(0)}${a.charAt(0)}`.trim();
  return (letras || (respaldo ?? '?').trim().charAt(0) || '?').toUpperCase();
}

export function Iniciales({ nombre, apellido, respaldo, color, tamano = 'md', className }: InicialesProps) {
  return (
    <span
      className={`mgg-iniciales gt-iniciales mgg-iniciales-${tamano} gt-iniciales-${tamano}${className ? ` ${className}` : ''}`}
      style={{ '--rol-color': color ?? undefined } as CSSProperties}
      aria-hidden="true"
    >
      {calcularIniciales(nombre, apellido, respaldo)}
    </span>
  );
}
