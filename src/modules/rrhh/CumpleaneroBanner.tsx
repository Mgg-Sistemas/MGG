/* ============================================================
   MGG · RRHH · Banner de Cumpleañero del día
   Muestra un mensaje informativo y festivo cuando uno o varios
   trabajadores activos están de cumpleaños hoy.
   ============================================================ */
import { useState } from 'react';
import type { Cumpleanero } from './cumpleanos';

interface Props {
  cumpleaneros: Cumpleanero[];
}

export function CumpleaneroBanner({ cumpleaneros }: Props) {
  const [cerrado, setCerrado] = useState(false);

  if (cerrado || !cumpleaneros.length) return null;

  const esUnico = cumpleaneros.length === 1;

  return (
    <div
      role="region"
      aria-label="Cumpleaños del día"
      style={{
        background: 'linear-gradient(135deg, rgba(255, 138, 0, 0.12) 0%, rgba(245, 158, 11, 0.08) 50%, rgba(255, 193, 7, 0.14) 100%)',
        border: '1px solid rgba(255, 138, 0, 0.35)',
        borderRadius: 12,
        padding: '.85rem 1.1rem',
        marginBottom: '1rem',
        boxShadow: '0 3px 12px rgba(255, 138, 0, 0.08)',
        position: 'relative',
      }}
    >
      {/* Botón discreto para cerrar si se desea */}
      <button
        type="button"
        onClick={() => setCerrado(true)}
        aria-label="Cerrar aviso de cumpleaños"
        title="Ocultar por ahora"
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          background: 'none',
          border: 'none',
          fontSize: '1.1rem',
          cursor: 'pointer',
          color: 'var(--muted, #666)',
          lineHeight: 1,
          padding: '4px 6px',
          borderRadius: 4,
        }}
      >
        ×
      </button>

      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.65rem', paddingRight: '1.5rem' }}>
        <span style={{ fontSize: '1.35rem', lineHeight: 1 }} aria-hidden="true">🎂</span>
        <span style={{ fontWeight: 800, fontSize: '1.02rem', color: '#d97706', letterSpacing: '.01em' }}>
          {esUnico ? 'Cumpleañero del día:' : 'Cumpleañeros del día:'}
        </span>
        <span style={{ fontSize: '.84rem', color: 'var(--text-muted, #555)', fontStyle: 'italic' }}>
          🎉 ¡Hoy la empresa celebra su día! Deséale un feliz cumpleaños.
        </span>
      </div>

      {/* Tarjeta(s) de cumpleañero(s) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esUnico ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '.7rem',
        }}
      >
        {cumpleaneros.map((c) => {
          const iniciales = `${c.nombre?.[0] ?? ''}${c.apellido?.[0] ?? ''}`.toUpperCase() || '👤';
          return (
            <div
              key={c.id}
              style={{
                background: 'var(--card-bg, #ffffff)',
                border: '1px solid rgba(255, 138, 0, 0.28)',
                borderRadius: 10,
                padding: '.65rem .85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '.85rem',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.04)',
              }}
            >
              {/* Foto o avatar con marco festivo */}
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, #ff8a00, #f59e0b)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  border: '2px solid #ff8a00',
                  boxShadow: '0 2px 6px rgba(255, 138, 0, 0.3)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: c.foto_url ? '1rem' : '1.1rem',
                }}
              >
                {c.foto_url ? (
                  <img
                    src={c.foto_url}
                    alt={c.nombreCompleto}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span>{iniciales}</span>
                )}
              </div>

              {/* Información */}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '.95rem', color: 'var(--text, #1a1a1a)' }}>
                    {c.nombreCompleto}
                  </strong>
                  {c.edad != null && (
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #ff8a00, #f59e0b)',
                        color: '#ffffff',
                        fontSize: '.72rem',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 10,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🎉 ¡{c.edad} años!
                    </span>
                  )}
                  {c.empresa && c.empresa !== 'MGG' && (
                    <span
                      className="badge"
                      style={{ fontSize: '.7rem', padding: '1px 6px' }}
                      title={`Nómina ${c.empresa}`}
                    >
                      {c.empresa}
                    </span>
                  )}
                </div>

                <div
                  className="muted"
                  style={{
                    fontSize: '.82rem',
                    marginTop: '.2rem',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={[c.cargo, c.departamento].filter(Boolean).join(' · ')}
                >
                  {c.cargo || 'Personal'}
                  {c.departamento ? ` · ${c.departamento}` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

