import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Un botón que despliega una lista de acciones.
 *
 * Existe para que una barra de herramientas no crezca sin fin. Cuando una
 * pantalla tiene más botones de los que entran en una fila, la barra envuelve y
 * el botón principal termina bailando de lugar según el ancho de la ventana:
 * el usuario deja de saber dónde está lo que usa todos los días. Metiendo las
 * acciones ocasionales acá, la fila se mantiene en una sola línea y cada cosa
 * queda siempre en el mismo sitio.
 *
 * Se cierra al elegir algo, al tocar afuera y con Escape.
 */
export function MenuBoton({
  etiqueta, titulo, children, alineacion = 'derecha',
}: {
  /** Texto del botón que abre el menú. */
  etiqueta: ReactNode;
  titulo?: string;
  /** Los ítems. Reciben `cerrar` para poder cerrarse al ejecutarse. */
  children: (cerrar: () => void) => ReactNode;
  alineacion?: 'izquierda' | 'derecha';
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', afuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', afuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  return (
    <div ref={caja} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className={`btn ${abierto ? 'btn-primary' : 'btn-ghost'}`}
        aria-haspopup="menu" aria-expanded={abierto} title={titulo}
        onClick={() => setAbierto((v) => !v)}>
        {etiqueta} <span aria-hidden style={{ fontSize: '.7em', opacity: .8 }}>▾</span>
      </button>

      {abierto && (
        <div role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + .35rem)', zIndex: 60,
            ...(alineacion === 'derecha' ? { right: 0 } : { left: 0 }),
            minWidth: 210, padding: '.3rem',
            display: 'flex', flexDirection: 'column', gap: '.15rem',
            background: 'var(--bg-1)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,.45)',
          }}>
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  );
}

/** Un ítem del menú. Ocupa todo el ancho y se lee como una lista, no como botones sueltos. */
export function MenuItem({
  onClick, href, title, children,
}: {
  onClick?: () => void;
  /** Si viene, el ítem es un enlace (se abre en otra pestaña). */
  href?: string;
  title?: string;
  children: ReactNode;
}) {
  const estilo: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    padding: '.45rem .6rem', borderRadius: 7, whiteSpace: 'nowrap',
  };
  if (href) {
    return (
      <a role="menuitem" className="btn btn-ghost" href={href} target="_blank" rel="noopener noreferrer"
        title={title} style={estilo} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" className="btn btn-ghost" title={title} style={estilo} onClick={onClick}>
      {children}
    </button>
  );
}
