import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signIn, signOutLocal } from './authStore';
import { isSupabaseConfigured } from '@/shared/lib/supabase';
import { entrarConBiometria, biometriaDisponible } from './webauthn.repository';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bioOk, setBioOk] = useState(false);     // el equipo tiene sensor biométrico
  const [bioBusy, setBioBusy] = useState(false);
  const [verClave, setVerClave] = useState(false); // mostrar/ocultar la contraseña

  // ¿Este equipo soporta huella / Windows Hello / Face ID? (para mostrar el botón)
  useEffect(() => { biometriaDisponible().then(setBioOk).catch(() => setBioOk(false)); }, []);

  async function handleBiometria() {
    setError(null);
    if (!email.trim()) { setError('Escribí tu correo y luego usá la huella.'); return; }
    setBioBusy(true);
    try {
      await entrarConBiometria(email);
      navigate('/app');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entrar con huella.');
    } finally {
      setBioBusy(false);
    }
  }

  // Forzar logout al abrir el login: el usuario debe autenticarse siempre.
  const didCleanRef = useRef(false);
  useEffect(() => {
    if (didCleanRef.current) return;
    didCleanRef.current = true;
    if (isSupabaseConfigured) {
      signOutLocal().catch(() => {});
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setError('Supabase no configurado. Crea .env.local con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: authError } = await signIn(email, password);
    setSubmitting(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    navigate('/app');
  }

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div
          className="login-aside-content"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            flex: 1,
            gap: '1.5rem',
          }}
        >
          <div className="brand" style={{ flexDirection: 'column', alignItems: 'center', gap: '.75rem' }}>
            <img src="/image.jpeg" alt="MGG" style={{ width: 72, height: 72 }} />
            <div className="brand-text" style={{ alignItems: 'center' }}>
              <strong>MGG</strong>
              <small>Mineral Group Guayana</small>
            </div>
          </div>

          <p className="quote" style={{ maxWidth: 480 }}>
            <strong>Mineral Group Guayana C.A.</strong>
            <br />
            <span className="grad">Empresa líder en la comercialización y exportación de minerales.</span>
            <br />
            <br />
            Bienvenido al Sistema de Gestión de la Empresa.
          </p>
        </div>

        <div className="footnote">
          <span>© Mineral Group Guayana C.A.</span>
          <span>v0.3.0</span>
        </div>
      </aside>

      <div className="login-form-wrap">
        <form className="login-form" onSubmit={handleSubmit}>
          <Link to="/" className="back-link">← Volver al inicio</Link>

          <h1>Iniciar sesión</h1>
          <p className="sub">Ingresa con tu cuenta corporativa MGG.</p>

          {!isSupabaseConfigured && (
            <div className="badge warning" style={{ marginBottom: '1rem', display: 'block', padding: '.6rem .8rem' }}>
              Supabase aún no configurado · revisa .env.local
            </div>
          )}

          <div className="form-row">
            <label htmlFor="email">Correo</label>
            <input
              id="email"
              type="email"
              className="input"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="form-row">
            <label htmlFor="password">Contraseña</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={verClave ? 'text' : 'password'}
                className="input"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ paddingRight: '2.6rem', width: '100%' }}
              />
              <button
                type="button"
                onClick={() => setVerClave((v) => !v)}
                title={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verClave}
                style={{
                  position: 'absolute', top: '50%', right: '.5rem', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer', padding: '.25rem',
                  fontSize: '1.05rem', lineHeight: 1, color: 'var(--muted)',
                }}
              >
                {verClave ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && (
            <div className="badge danger" style={{ display: 'block', padding: '.6rem .8rem', marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </button>

          {bioOk && isSupabaseConfigured && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', margin: '1rem 0 .8rem', color: 'var(--muted)', fontSize: '.78rem' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />o<span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'center', gap: '.5rem' }}
                onClick={handleBiometria}
                disabled={bioBusy || submitting}
                title="Entrar con la huella / Windows Hello / Face ID de este dispositivo"
              >
                {bioBusy ? 'Verificando…' : '🔒 Entrar con huella'}
              </button>
              <div className="login-help" style={{ marginTop: '.5rem' }}>
                Escribí tu correo y usá la huella. Primero hay que activarla desde el sistema, en este mismo equipo.
              </div>
            </>
          )}

          <div className="login-help">
            ¿Sin cuenta? Pídele al administrador que te dé acceso.
          </div>
        </form>
      </div>
    </div>
  );
}
