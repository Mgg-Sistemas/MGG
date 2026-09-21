import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSession, signOut } from '@/modules/auth/authStore';
import { cambiarMiClave } from './usuarios.repository';
import { toast } from '@/shared/ui/Toast';

export function CambiarClavePage() {
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // El error también se muestra EN la tarjeta, no solo en un toast: el toast se
  // va solo y el usuario se queda mirando la pantalla sin saber qué pasó.
  const [error, setError] = useState<string | null>(null);

  // Si el usuario llega desde otra pantalla del app (ej. Ajustes), `state.from`
  // viene seteado: "Volver" lo lleva de regreso allá sin cerrar sesión.
  // "Aceptar" siempre cierra sesión y manda al landing porque al cambiar la
  // clave el JWT vigente queda obsoleto y se debe reingresar.
  const fromInterno = (location.state as { from?: string } | null)?.from;
  const esCambioVoluntario = Boolean(fromInterno);

  // Validación en vivo: la confirmación debe coincidir con la clave nueva.
  const claveTrim = clave.trim();
  const confTrim = confirmacion.trim();
  const largoOk = claveTrim.length >= 6;
  const coincide = largoOk && claveTrim === confTrim;
  const mostrarNoCoincide = confTrim.length > 0 && claveTrim !== confTrim;

  if (loading) return <div className="p-8">Cargando…</div>;
  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  async function handleAceptar() {
    const c = clave.trim();
    setError(null);
    if (c.length < 6) {
      const faltan = 6 - c.length;
      const msg = c.length === 0
        ? 'Escribí la clave nueva: tiene que tener al menos 6 caracteres.'
        : `La clave es muy corta: le ${faltan === 1 ? 'falta 1 caracter' : `faltan ${faltan} caracteres`} para llegar al mínimo de 6.`;
      setError(msg);
      toast(msg, 'error');
      return;
    }
    if (c !== confirmacion.trim()) {
      const msg = 'Las dos claves no coinciden. Repetí la misma en los dos campos.';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    setSubmitting(true);
    try {
      await cambiarMiClave(c);
      // Independientemente de cómo se llegó, tras cambiar la clave se cierra
      // sesión y se manda al landing para que el usuario reingrese.
      toast('Clave cambiada · debes iniciar sesión nuevamente', 'success');
      await signOut();
      navigate('/', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo cambiar la clave';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVolver() {
    if (esCambioVoluntario && fromInterno) {
      // Cancela y regresa a la pantalla de origen, sin cerrar sesión.
      navigate(fromInterno, { replace: true });
      return;
    }
    // Cambio forzado: cancelar cierra la sesión y vuelve al landing. El flag
    // must_change_password queda intacto, por lo que la próxima vez que el
    // usuario entre se le volverá a forzar el cambio.
    try { await signOut(); } catch { /* opcional */ }
    navigate('/', { replace: true });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        minHeight: '100vh',
        width: '100vw',
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(255,138,0,0.18), transparent 60%), var(--bg-0)',
        padding: '1.5rem',
        overflow: 'auto',
        zIndex: 50,
      }}
    >
      <div
        className="login-card"
        style={{
          width: '100%',
          maxWidth: 460,
          padding: '2rem 2rem 1.75rem',
          borderRadius: 'var(--r-lg, 14px)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto .75rem',
              borderRadius: '50%',
              background: 'rgba(255,138,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
            }}
            aria-hidden="true"
          >
            🔑
          </div>
          <h2 style={{ margin: 0 }}>Cambio de clave</h2>
          <p className="hint muted" style={{ margin: '.4rem 0 0', fontSize: '.9rem' }}>
            Ingresa una nueva clave para tu cuenta <strong>{user.email}</strong>.
          </p>
        </div>

        {error && (
          <div
            className="card"
            role="alert"
            style={{ borderColor: 'var(--danger)', margin: '0 0 1rem', padding: '.6rem .8rem' }}
          >
            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ {error}</span>
          </div>
        )}

        <div className="form-row">
          <label>Ingrese clave nueva</label>
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            value={clave}
            onChange={(e) => { setClave(e.target.value); setError(null); }}
            placeholder="Mínimo 6 caracteres"
            disabled={submitting}
            style={claveTrim.length > 0 && !largoOk ? { borderColor: 'var(--danger)' } : undefined}
            autoFocus
          />
          {/* El largo se dice MIENTRAS se escribe: antes el botón quedaba
              deshabilitado en silencio y parecía que el sistema no hacía nada. */}
          {claveTrim.length > 0 && !largoOk && (
            <small style={{ color: 'var(--danger)', marginTop: '.35rem', display: 'block' }}>
              Le {6 - claveTrim.length === 1 ? 'falta 1 caracter' : `faltan ${6 - claveTrim.length} caracteres`} para llegar al mínimo de 6.
            </small>
          )}
          {largoOk && (
            <small style={{ color: 'var(--success)', marginTop: '.35rem', display: 'block' }}>
              ✓ Largo suficiente ({claveTrim.length} caracteres).
            </small>
          )}
        </div>

        <div className="form-row">
          <label>Confirmación de clave</label>
          <input
            type="password"
            className="input"
            autoComplete="new-password"
            value={confirmacion}
            onChange={(e) => { setConfirmacion(e.target.value); setError(null); }}
            placeholder="Repite la clave nueva"
            disabled={submitting}
            style={mostrarNoCoincide ? { borderColor: 'var(--danger)' } : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) handleAceptar(); }}
          />
          {mostrarNoCoincide && (
            <small style={{ color: 'var(--danger)', marginTop: '.35rem', display: 'block' }}>
              Las claves no coinciden.
            </small>
          )}
          {coincide && (
            <small style={{ color: 'var(--success)', marginTop: '.35rem', display: 'block' }}>
              ✓ Las claves coinciden.
            </small>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={handleVolver}
            disabled={submitting}
            style={{ minWidth: 120, justifyContent: 'center', textAlign: 'center' }}
          >
            Volver
          </button>
          <button
            className="btn btn-primary"
            onClick={handleAceptar}
            /* A propósito NO se deshabilita por la validación: un botón apagado
               en silencio es lo que hacía parecer que el sistema no respondía.
               Ahora se puede hacer clic siempre y el motivo aparece en pantalla. */
            disabled={submitting}
            style={{ minWidth: 160, justifyContent: 'center', textAlign: 'center' }}
          >
            {submitting ? 'Guardando…' : 'Aceptar'}
          </button>
        </div>
      </div>
    </div>
  );
}
