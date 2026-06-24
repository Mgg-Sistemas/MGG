import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import {
  registrarBiometria,
  listarCredenciales,
  eliminarCredencial,
  biometriaDisponible,
  type CredencialBiometrica,
} from './webauthn.repository';

/** Fecha corta es-VE. */
function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch { return iso; }
}

/**
 * Administra el acceso biométrico (huella / Windows Hello / Face ID) del usuario.
 * Permite activar la huella en ESTE dispositivo y quitar credenciales viejas.
 */
export function BiometriaModal({ onClose }: { onClose: () => void }) {
  const [soporta, setSoporta] = useState<boolean | null>(null);
  const [creds, setCreds] = useState<CredencialBiometrica[]>([]);
  const [cargando, setCargando] = useState(true);
  const [activando, setActivando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const dominio = window.location.hostname;

  async function cargar() {
    setCargando(true);
    try { setCreds(await listarCredenciales()); } catch { /* sin red */ }
    setCargando(false);
  }
  useEffect(() => {
    biometriaDisponible().then(setSoporta).catch(() => setSoporta(false));
    void cargar();
  }, []);

  async function activar() {
    setMsg(null); setActivando(true);
    try {
      await registrarBiometria();
      setMsg({ tipo: 'ok', texto: '¡Listo! Ya podés entrar con la huella en este dispositivo.' });
      await cargar();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo activar.' });
    } finally {
      setActivando(false);
    }
  }

  async function quitar(id: string) {
    setMsg(null);
    try {
      await eliminarCredencial(id);
      await cargar();
    } catch (e) {
      setMsg({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo quitar.' });
    }
  }

  // Credenciales registradas en ESTE dominio (las que sirven acá).
  const credsDominio = creds.filter((c) => c.rp_id === dominio);
  const credsOtros = creds.filter((c) => c.rp_id !== dominio);

  return (
    <Modal title="🔒 Acceso con huella" size="md" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Activá el ingreso con <strong>huella dactilar</strong> (o Windows Hello / Face ID) en este equipo.
        La huella <strong>nunca sale de tu dispositivo</strong>: el sistema solo guarda una llave de
        seguridad. La clave de siempre sigue funcionando como respaldo.
      </p>

      {soporta === false && (
        <div className="badge warning" style={{ display: 'block', padding: '.6rem .8rem', marginBottom: '.8rem' }}>
          Este equipo/navegador no tiene un sensor biométrico compatible. Probá desde un teléfono o una laptop con huella/Windows Hello.
        </div>
      )}

      {msg && (
        <div className={`badge ${msg.tipo === 'ok' ? 'success' : 'danger'}`} style={{ display: 'block', padding: '.6rem .8rem', marginBottom: '.8rem' }}>
          {msg.texto}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', justifyContent: 'center', gap: '.5rem' }}
        onClick={activar}
        disabled={activando || soporta === false}
      >
        {activando ? 'Esperando la huella…' : '➕ Activar huella en este dispositivo'}
      </button>
      <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
        Dominio actual: <strong className="mono">{dominio}</strong> · la huella sirve solo en este dominio.
      </small>

      <div style={{ marginTop: '1.2rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>Dispositivos activos</div>
        {cargando ? (
          <p className="muted" style={{ fontSize: '.82rem' }}>Cargando…</p>
        ) : creds.length === 0 ? (
          <p className="muted" style={{ fontSize: '.82rem' }}>Todavía no activaste la huella en ningún dispositivo.</p>
        ) : (
          <>
            {credsDominio.map((c) => (
              <div key={c.id} className="card" style={{ margin: '0 0 .4rem', padding: '.55rem .7rem', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                <span style={{ fontSize: '1.1rem' }}>🔒</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '.86rem' }}>{c.device_label || 'Dispositivo'}</div>
                  <div className="muted" style={{ fontSize: '.72rem' }}>
                    Activado {fechaCorta(c.created_at)} · último uso {fechaCorta(c.last_used_at)}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => quitar(c.id)} title="Quitar esta huella">✕</button>
              </div>
            ))}
            {credsOtros.length > 0 && (
              <details style={{ marginTop: '.4rem' }}>
                <summary className="muted" style={{ fontSize: '.78rem', cursor: 'pointer' }}>
                  Otros dominios ({credsOtros.length})
                </summary>
                {credsOtros.map((c) => (
                  <div key={c.id} className="card" style={{ margin: '.4rem 0 0', padding: '.5rem .7rem', display: 'flex', alignItems: 'center', gap: '.6rem', opacity: .75 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '.82rem' }}>{c.device_label || 'Dispositivo'}</div>
                      <div className="muted mono" style={{ fontSize: '.7rem' }}>{c.rp_id}</div>
                    </div>
                    <button className="btn btn-sm btn-ghost" onClick={() => quitar(c.id)} title="Quitar">✕</button>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
