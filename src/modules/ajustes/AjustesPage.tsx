import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useRealtime } from '@/shared/lib/useRealtime';
import { signOut, useSession } from '@/modules/auth/authStore';
import { BiometriaModal } from '@/modules/auth/BiometriaModal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import type { Usuario } from '@/shared/lib/types';
import { labelRol } from '@/modules/usuarios/usuarios.repository';
import {
  getNotifPrefs,
  playNotificationPattern,
  setNotifPrefs,
  stopNotificationPattern,
} from '@/shared/lib/sound';

const VIEW_KEY = 'mgg.view.pedidos';
const SCOPE_KEY = 'mgg.scope.pedidos';

export function AjustesPage() {
  const { user, session } = useSession();
  const navigate = useNavigate();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);

  // Perfil editable
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [biometriaOpen, setBiometriaOpen] = useState(false);

  // Preferencias locales (localStorage)
  const [viewPref, setViewPref] = useState<'kanban' | 'lista'>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(VIEW_KEY) === 'lista') ? 'lista' : 'kanban',
  );
  const [scopePref, setScopePref] = useState<'pedidos' | 'oc'>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(SCOPE_KEY) === 'oc') ? 'oc' : 'pedidos',
  );

  // Preferencias de notificaciones
  const [notifEnabled, setNotifEnabled] = useState(() => getNotifPrefs().enabled);
  const [notifSound, setNotifSound] = useState(() => getNotifPrefs().sound);
  const [notifDuration, setNotifDuration] = useState(() => getNotifPrefs().duration);

  const cargarPerfil = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase.from('usuarios').select('*').eq('id', user.id).maybeSingle();
    const u = (data ?? null) as Usuario | null;
    setUsuario(u);
    setNombre(u?.nombre ?? '');
    setApellido(u?.apellido ?? '');
    setTelefono(u?.telefono ?? '');
    setDepartamento(u?.departamento ?? '');
    setLoading(false);
  }, [user]);

  useEffect(() => { void cargarPerfil(); }, [cargarPerfil]);
  // Realtime: si cambian mi perfil/rol desde Usuarios, se refleja acá en vivo.
  useRealtime(['usuarios'], cargarPerfil);

  async function handleGuardarPerfil() {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from('usuarios')
        .update({
          nombre: nombre.trim(),
          apellido: apellido.trim() || null,
          telefono: telefono.trim() || null,
          departamento: departamento.trim() || null,
        })
        .eq('id', user.id);
      if (error) throw error;
      toast('Perfil actualizado', 'success');
      setUsuario((u) => u ? { ...u, nombre: nombre.trim(), apellido: apellido.trim() || null, telefono: telefono.trim() || null, departamento: departamento.trim() || null } : u);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al guardar', 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  function setView(v: 'kanban' | 'lista') {
    setViewPref(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* localStorage no disponible */ }
    toast(`Vista preferida: ${v === 'kanban' ? 'Kanban' : 'Lista'}`, 'info');
  }

  function setScope(s: 'pedidos' | 'oc') {
    setScopePref(s);
    try { localStorage.setItem(SCOPE_KEY, s); } catch { /* localStorage no disponible */ }
    toast(`Vista preferida: ${s === 'oc' ? 'Órdenes de Compra' : 'Solicitud de Pedido'}`, 'info');
  }

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  function handleCambiarClave() {
    // Pasamos `from` para que la pantalla de cambio sepa volver acá
    // en lugar de cerrar sesión y mandar al landing.
    navigate('/cambiar-clave', { state: { from: '/app/ajustes' } });
  }

  if (loading) return <div className="p-8">Cargando…</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ajustes</h1>
          <p className="hint muted">Configura tu perfil y preferencias del sistema.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>

        {/* Perfil */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '1rem' }}>
            <span>Perfil</span>
          </div>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div
              className="avatar"
              style={{
                width: 60, height: 60, borderRadius: '50%',
                overflow: 'hidden',
                background: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid var(--border)',
                flexShrink: 0,
              }}
            >
              <img
                src="/image.jpeg"
                alt="Avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                {[nombre, apellido].filter(Boolean).join(' ') || '—'}
              </div>
              <div className="muted mono" style={{ fontSize: '.82rem' }}>{user?.email}</div>
              <div style={{ marginTop: '.4rem' }}>
                <span className="badge primary">{labelRol(usuario?.role)}</span>
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>Nombre</label>
              <input
                className="input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, '').toUpperCase())}
                placeholder="Solo letras"
              />
            </div>
            <div className="form-row">
              <label>Apellido</label>
              <input
                className="input"
                value={apellido}
                onChange={(e) => setApellido(e.target.value.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, '').toUpperCase())}
                placeholder="Solo letras"
              />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Teléfono</label>
              <input
                className="input"
                inputMode="numeric"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value.replace(/\D/g, '').slice(0, 15))}
                placeholder="Solo dígitos"
                maxLength={15}
              />
            </div>
            <div className="form-row">
              <label>Departamento</label>
              <input
                className="input"
                value={departamento}
                onChange={(e) => setDepartamento(e.target.value.toUpperCase())}
                placeholder="Opcional"
              />
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleGuardarPerfil} disabled={savingProfile}>
            {savingProfile ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>

        {/* Notificaciones */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '1rem' }}>
            <span>Notificaciones</span>
          </div>

          <div className="setting-row">
            <div>
              <strong>Recibir notificaciones</strong>
              <div className="muted" style={{ fontSize: '.82rem' }}>
                Mostrar alertas in-app (campana del topbar) y toasts.
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={(e) => {
                  setNotifEnabled(e.target.checked);
                  setNotifPrefs({ enabled: e.target.checked });
                }}
              />
              <span className="slider-toggle"></span>
            </label>
          </div>

          <div className="setting-row">
            <div>
              <strong>Sonido al recibir</strong>
              <div className="muted" style={{ fontSize: '.82rem' }}>
                Reproduce un patrón sonoro intermedio (doble-beep).
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={notifSound}
                disabled={!notifEnabled}
                onChange={(e) => {
                  setNotifSound(e.target.checked);
                  setNotifPrefs({ sound: e.target.checked });
                }}
              />
              <span className="slider-toggle"></span>
            </label>
          </div>

          <div className="setting-row">
            <div style={{ flex: 1 }}>
              <strong>Duración del sonido</strong>
              <div className="muted" style={{ fontSize: '.82rem' }}>
                <span className="mono">{notifDuration} s</span> de repetición al sonar el patrón.
              </div>
              <input
                type="range"
                min={3}
                max={30}
                step={1}
                value={notifDuration}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setNotifDuration(v);
                  setNotifPrefs({ duration: v });
                }}
                disabled={!notifEnabled || !notifSound}
                style={{ width: '100%', marginTop: '.5rem', accentColor: 'var(--primary)' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
            <button
              className="btn btn-ghost"
              onClick={() => playNotificationPattern(notifDuration)}
              disabled={!notifEnabled || !notifSound}
            >
              🔊 Probar sonido
            </button>
            <button className="btn btn-ghost" onClick={stopNotificationPattern}>
              ■ Detener
            </button>
          </div>
        </div>

        {/* Seguridad */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '1rem' }}>
            <span>Seguridad</span>
          </div>
          <p className="hint muted" style={{ fontSize: '.85rem', marginBottom: '1rem' }}>
            Cambia tu clave de acceso al sistema. Vas a ser redirigido al login después de actualizarla.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={handleCambiarClave}>
              🔑 Cambiar mi clave
            </button>
            <button className="btn btn-ghost" onClick={() => setBiometriaOpen(true)} title="Activar el acceso con huella en este dispositivo">
              🔒 Acceso con huella
            </button>
          </div>
          <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.6rem' }}>
            El acceso con huella se activa por dispositivo. Lo podés configurar acá cuando quieras.
          </p>
        </div>

        {/* Preferencias de vista */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '1rem' }}>
            <span>Vista preferida (Pedidos)</span>
          </div>
          <p className="hint muted" style={{ fontSize: '.85rem', marginBottom: '.75rem' }}>
            Modo por defecto del módulo Pedidos/Compras. Igualmente puedes alternar dentro del módulo.
          </p>

          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
            <button className={`chip${viewPref === 'kanban' ? ' chip-active' : ''}`} onClick={() => setView('kanban')}>▦ Kanban</button>
            <button className={`chip${viewPref === 'lista' ? ' chip-active' : ''}`} onClick={() => setView('lista')}>☰ Lista</button>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className={`chip${scopePref === 'pedidos' ? ' chip-active' : ''}`} onClick={() => setScope('pedidos')}>✉ Solicitud de Pedido</button>
            <button className={`chip${scopePref === 'oc' ? ' chip-active' : ''}`} onClick={() => setScope('oc')}>🧾 Órdenes de Compra</button>
          </div>
        </div>

        {/* Sesión */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <div className="card-title" style={{ marginBottom: '1rem' }}>
            <span>Sesión</span>
          </div>
          <div className="detail-row">
            <div className="k">Correo</div>
            <div className="v mono">{user?.email}</div>
          </div>
          <div className="detail-row">
            <div className="k">Rol</div>
            <div className="v">{labelRol(usuario?.role)}</div>
          </div>
          <div className="detail-row">
            <div className="k">Estado</div>
            <div className="v">
              {usuario?.estado === 'activo'
                ? <span className="badge success">Activo</span>
                : <span className="badge danger">Inactivo</span>}
            </div>
          </div>
          {session?.user?.last_sign_in_at && (
            <div className="detail-row">
              <div className="k">Inicio de sesión</div>
              <div className="v muted" style={{ fontSize: '.85rem' }}>
                {dateTime(session.user.last_sign_in_at)}
              </div>
            </div>
          )}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '.5rem' }}>
            <button className="btn btn-danger" onClick={handleLogout}>
              ⎋ Cerrar sesión
            </button>
          </div>
        </div>

      </div>

      {biometriaOpen && <BiometriaModal onClose={() => setBiometriaOpen(false)} />}
    </div>
  );
}
