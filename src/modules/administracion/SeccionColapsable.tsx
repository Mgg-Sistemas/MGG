/* ============================================================
   Golden Touch · Administración · Sección colapsable (acordeón)
   Contenedor reutilizable para ordenar Configuración sin abrumar:
   cada sección se abre/cierra; «Categorías» arranca cerrada.
   El estado inicial se calcula con un helper puro (testeable).
   ============================================================ */
import { useState, type ReactNode } from 'react';

/** Mapa clave→abierta para el estado inicial de un grupo de secciones.
 *  Las claves en `cerradasPorDefecto` arrancan cerradas (false); el resto abiertas (true). */
export function estadoInicialSecciones(
  claves: string[],
  opciones?: { cerradasPorDefecto?: string[] },
): Record<string, boolean> {
  const cerradas = new Set(opciones?.cerradasPorDefecto ?? []);
  const estado: Record<string, boolean> = {};
  for (const clave of claves) estado[clave] = !cerradas.has(clave);
  return estado;
}

export function SeccionColapsable({
  titulo,
  subtitulo,
  abiertoPorDefecto = true,
  accionCabecera,
  children,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  abiertoPorDefecto?: boolean;
  /** Botón/elemento opcional alineado a la derecha de la cabecera (no alterna la sección). */
  accionCabecera?: ReactNode;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '.5rem',
          padding: '.85rem 1rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setAbierto((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={abierto}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setAbierto((v) => !v);
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', flex: 1, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              transition: 'transform .15s ease',
              transform: abierto ? 'rotate(90deg)' : 'rotate(0deg)',
              color: 'var(--muted)',
              fontSize: '.8rem',
            }}
          >
            ▶
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="card-title" style={{ margin: 0 }}>{titulo}</div>
            {subtitulo && !abierto && (
              <p className="muted hint" style={{ margin: '.15rem 0 0', fontSize: '.74rem' }}>{subtitulo}</p>
            )}
          </div>
        </div>
        {accionCabecera && (
          <div onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
            {accionCabecera}
          </div>
        )}
      </div>
      {abierto && (
        <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid var(--border)' }}>
          <div style={{ paddingTop: '.85rem' }}>{children}</div>
        </div>
      )}
    </div>
  );
}
