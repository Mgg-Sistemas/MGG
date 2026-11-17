/* ============================================================
   MGG · RRHH · Banner de Cumpleañeros del día
   Diseño festivo unificado idéntico a Golden Touch (GT).
   Muestra un banner dorado con pastillas para cada cumpleañero
   activo del día (Nombre en ámbar/dorado, cargo y edad).
   ============================================================ */
import type { Cumpleanero } from './cumpleanos';

interface Props {
  cumpleaneros: Cumpleanero[];
}

export function CumpleaneroBanner({ cumpleaneros }: Props) {
  if (!cumpleaneros || cumpleaneros.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Cumpleañeros del día"
      style={{
        background: 'linear-gradient(135deg, rgba(255, 153, 0, 0.15) 0%, rgba(255, 204, 0, 0.22) 100%)',
        border: '1px solid rgba(255, 170, 0, 0.45)',
        boxShadow: '0 4px 16px rgba(255, 160, 0, 0.12)',
        borderRadius: '12px',
        padding: '0.85rem 1.15rem',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          fontSize: '1.8rem',
          lineHeight: 1,
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
          animation: 'bounce 2s infinite',
        }}
        aria-hidden="true"
      >
        🎂
      </div>

      <div style={{ flex: '1 1 280px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: '0.95rem',
              color: 'var(--text, #fff)',
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
            }}
          >
            🎉 Cumpleañero{cumpleaneros.length > 1 ? 's' : ''} del día:
          </span>
          <span style={{ fontSize: '0.88rem', color: 'var(--text-muted, #ccc)' }}>
            ¡Hoy celebramos y felicitamos a nuestro equipo!
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
          {cumpleaneros.map((p) => {
            const anios = p.edad;
            const nombreCompleto = p.nombreCompleto || `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Trabajador';
            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--bg-1, rgba(20, 20, 20, 0.6))',
                  border: '1px solid rgba(255, 180, 0, 0.35)',
                  borderRadius: '20px',
                  padding: '0.25rem 0.75rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: '0.88rem',
                }}
              >
                <span style={{ fontWeight: 700, color: '#ffb300' }}>
                  {nombreCompleto}
                </span>
                {p.cargo && (
                  <span style={{ opacity: 0.85, fontSize: '0.8rem', color: 'var(--text-muted, #aaa)' }}>
                    · {p.cargo}
                  </span>
                )}
                {anios !== null && (
                  <span
                    style={{
                      background: 'rgba(255, 180, 0, 0.2)',
                      color: '#ffd54f',
                      fontWeight: 700,
                      borderRadius: '10px',
                      padding: '0.05rem 0.45rem',
                      fontSize: '0.78rem',
                      marginLeft: '0.15rem',
                    }}
                  >
                    {anios} años
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Alias para compatibilidad con Golden Touch
export { CumpleaneroBanner as CumpleaneroAlerta };
