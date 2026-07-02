import type { CSSProperties, ReactNode } from 'react';

/**
 * Texto de ayuda / explicativo de un módulo. Lleva la clase `hint` para que el botón
 * "?" del topbar lo pueda ocultar globalmente (CSS: `.ayudas-ocultas .hint`).
 * Por defecto se ve `muted` y como párrafo; `as="span"` para textos en línea.
 */
export function Hint({ children, className = '', style, as = 'p' }: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: 'p' | 'span' | 'div' | 'small';
}) {
  const Tag = as;
  return <Tag className={`hint muted ${className}`.trim()} style={style}>{children}</Tag>;
}
