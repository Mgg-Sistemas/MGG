/* ============================================================
   MGG · Chat interno por Orden de Compra (componente compartido)
   Mismo hilo (`oc_mensajes`) visible desde Pedidos (detalle de la OC) y
   desde Tesorería (Pagar OC). Realtime + marca leídos al abrir.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { listMensajesOc, enviarMensajeOc, marcarLeidosOc } from './ocChat.repository';
import type { OcMensaje } from '@/shared/lib/types';

export function ChatOC({
  ordenId,
  ordenCodigo,
  userId,
  autorEmail,
  autorNombre,
  personaMap,
}: {
  ordenId: string;
  ordenCodigo: string;
  userId: string;
  autorEmail: string;
  autorNombre: string;
  /** Mapa email→"Nombre Apellido" para resolver el autor de mensajes ajenos (opcional). */
  personaMap?: Map<string, string>;
}) {
  const [mensajes, setMensajes] = useState<OcMensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const cuerpoRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const msgs = await listMensajesOc(ordenId);
      setMensajes(msgs);
      // Al verlos, se marcan leídos (baja el badge 💬 para este usuario).
      if (userId) { try { await marcarLeidosOc(ordenId, userId); } catch { /* no crítico */ } }
    } catch { /* hilo vacío si falla */ } finally { setCargando(false); }
  }, [ordenId, userId]);

  useEffect(() => { void cargar(); }, [cargar]);
  // Realtime propio: el hilo se actualiza al instante aunque el modal esté abierto.
  useRealtime(['oc_mensajes'], () => { void cargar(); });

  // Autoscroll al último mensaje (dentro del contenedor, sin mover la página).
  useEffect(() => {
    const el = cuerpoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensajes.length]);

  function nombreDe(m: OcMensaje): string {
    if (m.autor_nombre && m.autor_nombre.trim()) return m.autor_nombre;
    const mail = (m.autor_email ?? '').toLowerCase();
    return (mail && personaMap?.get(mail)) || m.autor_email || 'Usuario';
  }
  const esMio = (m: OcMensaje) =>
    (!!userId && m.autor === userId) || (!!autorEmail && (m.autor_email ?? '').toLowerCase() === autorEmail.toLowerCase());

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await enviarMensajeOc({ ordenId, texto: t, autorEmail, autorNombre });
      setTexto('');
      await cargar();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo enviar el mensaje', 'error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        marginTop: '1.25rem', padding: '1rem',
        border: '2px solid var(--brand, #ff8a00)', borderRadius: 12,
        background: 'var(--brand-soft, rgba(255,138,0,.06))',
      }}
    >
      <h4 style={{ marginTop: 0, marginBottom: '.5rem', color: 'var(--brand, #ff8a00)' }}>💬 Chat interno · {ordenCodigo}</h4>
      <p className="muted" style={{ fontSize: '.78rem', marginTop: 0, marginBottom: '.5rem' }}>
        Hilo de seguimiento interno de esta orden (no se envía al proveedor). Lo ven Compras y Tesorería.
      </p>
      <div
        ref={cuerpoRef}
        style={{
          maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8,
          padding: '.6rem', background: 'var(--surface-2, rgba(0,0,0,.02))', display: 'flex',
          flexDirection: 'column', gap: '.5rem',
        }}
      >
        {cargando ? (
          <p className="muted" style={{ margin: 'auto', fontSize: '.85rem' }}>Cargando…</p>
        ) : mensajes.length === 0 ? (
          <p className="muted" style={{ margin: 'auto', fontSize: '.85rem' }}>Sin mensajes. Iniciá la conversación.</p>
        ) : (
          mensajes.map((m) => {
            const mio = esMio(m);
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mio ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '80%', padding: '.4rem .6rem', borderRadius: 10,
                  background: mio ? 'var(--primary)' : 'var(--surface, #fff)',
                  color: mio ? '#fff' : 'inherit',
                  border: mio ? 'none' : '1px solid var(--border)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.texto}
                </div>
                <span className="muted" style={{ fontSize: '.68rem', marginTop: '.15rem' }}>
                  {mio ? 'Vos' : nombreDe(m)} · {dateTime(m.created_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={enviar} style={{ display: 'flex', gap: '.5rem', marginTop: '.5rem' }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Escribí un mensaje…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={2000}
        />
        <button className="btn btn-primary" type="submit" disabled={enviando || !texto.trim()}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
