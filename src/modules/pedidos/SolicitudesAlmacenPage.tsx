/* ============================================================
   MGG · Almacén · Solicitudes de Pedido (PC) (29-10-2026)

   Flujo nuevo: la SP pasa primero por ALMACÉN, que revisa qué tiene de cada
   renglón; lo que falta llega a Compras. Esta pantalla lista las SP que
   esperan a almacén (la más vieja primero) y, al elegir una, la revisión.
   La pestaña «Revisadas» muestra cómo quedaron y vuelve a abrir el mensaje
   de WhatsApp de la revisión.

   Arranca APAGADO (`config.compras.revision_almacen`): mientras tanto se
   avisa con calma y la lista queda vacía porque ninguna SP nace en revisión.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Orden } from '@/shared/lib/types';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { dateTime, relTime } from '@/shared/lib/format';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { RevisionSolicitudAlmacen, ResumenListas, resultadoRevision } from './RevisionSolicitudAlmacen';
import { quienSolicita } from './quienSolicita';
import { mensajeRevisionAlmacen, resumenRevision, seRevisa } from './revisionAlmacen';
import { listSolicitudesEnRevision, listSolicitudesRevisadas, useFlujoRevisionAlmacen } from './revisionAlmacen.repository';

type Pestana = 'pendientes' | 'revisadas';

export function SolicitudesAlmacenPage() {
  const activo = useFlujoRevisionAlmacen();
  const { soloTelefono, puedeVista } = usePermissions();
  const nombreDe = useNombreUsuario();
  const [pestana, setPestana] = useState<Pestana>('pendientes');
  const [pendientes, setPendientes] = useState<Orden[]>([]);
  const [revisadas, setRevisadas] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ titulo: string; texto: string } | null>(null);
  /** La SP que se acaba de cerrar acá: si sale de la lista no se avisa como «la revisó otro». */
  const cerradaAca = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listSolicitudesEnRevision(), listSolicitudesRevisadas(30)]);
      setPendientes(p);
      setRevisadas(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['ordenes'], () => { void reload(); });

  const sel = useMemo(() => pendientes.find((o) => o.id === selId) ?? null, [pendientes, selId]);

  // Si la SP abierta la cerró otro usuario (o el teléfono), se avisa y se suelta.
  useEffect(() => {
    if (!selId || cargando || sel) return;
    const cerrada = revisadas.find((o) => o.id === selId);
    if (cerradaAca.current !== selId) {
      toast(cerrada ? `${cerrada.codigo} ya la revisó ${nombreDe(null, cerrada.revisada_almacen_por) || 'otro usuario'}` : 'La solicitud ya no está en revisión', 'info');
    }
    setSelId(null);
  }, [selId, sel, cargando, revisadas, nombreDe]);

  function alRevisar(actualizada: Orden, revisor: string) {
    cerradaAca.current = actualizada.id;
    setSelId(null);
    setMensaje({
      titulo: `✅ Almacén revisó ${actualizada.codigo}`,
      texto: mensajeRevisionAlmacen(actualizada, { revisor }),
    });
    void reload();
  }

  function verMensajeRevision(o: Orden) {
    setMensaje({
      titulo: `✅ Revisión de ${o.codigo}`,
      texto: mensajeRevisionAlmacen(o, { revisor: nombreDe(null, o.revisada_almacen_por) }),
    });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📋 Solicitudes de Pedido</h1>
          <p className="hint muted">
            Almacén revisa qué tiene de cada solicitud antes de que llegue a Compras. Lo que falta pasa a Compras para cotizar.
          </p>
        </div>
        <div className="actions">
          {!soloTelefono && puedeVista('solicitudes') && (
            <Link to="/app/solicitudes-pedido/telefono" className="btn btn-ghost">📱 Vista de teléfono</Link>
          )}
        </div>
      </div>

      {!activo && (
        <div className="aviso info" style={{ marginBottom: '1rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>Este flujo se activa cuando la administración lo indique; por ahora las solicitudes siguen yendo directo a Compras.</div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="view-toggle" role="tablist" aria-label="Solicitudes de pedido" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" className={pestana === 'pendientes' ? 'active' : ''} onClick={() => setPestana('pendientes')}>
          🕒 Por revisar ({pendientes.length})
        </button>
        <button type="button" className={pestana === 'revisadas' ? 'active' : ''} onClick={() => setPestana('revisadas')}>
          ✅ Revisadas ({revisadas.length})
        </button>
      </div>

      {cargando && <p className="muted">Cargando…</p>}

      {!cargando && pestana === 'pendientes' && (
        !pendientes.length ? (
          <EmptyState icon="📋" message="No hay solicitudes esperando revisión de almacén." />
        ) : (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 280px', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {pendientes.map((o) => {
                const n = (o.items ?? []).filter(seRevisa).length;
                const revisados = (o.items ?? []).filter((it) => seRevisa(it) && it.almacen_revisado).length;
                const activa = o.id === selId;
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="card"
                    onClick={() => setSelId(o.id)}
                    aria-pressed={activa}
                    style={{
                      textAlign: 'left', cursor: 'pointer', padding: '.7rem .85rem', font: 'inherit', color: 'inherit',
                      borderColor: activa ? 'var(--primary)' : o.urgente ? 'var(--danger)' : undefined,
                      boxShadow: activa ? 'inset 0 0 0 1px var(--primary)' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center' }}>
                      <strong className="mono">{o.codigo}</strong>
                      <span style={{ display: 'flex', gap: '.3rem' }}>
                        {o.urgente && <span className="badge danger">🚨 Urgente</span>}
                        {revisados > 0 && <span className="badge info">{revisados}/{n}</span>}
                      </span>
                    </div>
                    <div style={{ fontSize: '.86rem', marginTop: '.2rem' }}>
                      {[o.solicitante, quienSolicita(o)].filter(Boolean).join(' — ') || '—'}
                    </div>
                    <div className="muted" style={{ fontSize: '.78rem', marginTop: '.15rem' }}>
                      {n} producto(s) · {relTime(o.created_at)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ flex: '3 1 440px', minWidth: 0 }}>
              {sel ? (
                <RevisionSolicitudAlmacen key={sel.id} orden={sel} onRevisada={alRevisar} />
              ) : (
                <EmptyState icon="👈" message="Elige una solicitud de la lista para revisarla." />
              )}
            </div>
          </div>
        )
      )}

      {!cargando && pestana === 'revisadas' && (
        !revisadas.length ? (
          <EmptyState icon="✅" message="Almacén no ha revisado solicitudes en los últimos 30 días." />
        ) : (
          <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {revisadas.map((o) => {
              const res = resultadoRevision(o);
              const r = resumenRevision(o.items ?? []);
              return (
                <div key={o.id} className="card" style={{ padding: '.75rem .9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong className="mono">{o.codigo}</strong>
                    <span className={`badge ${res.clase}`}>{res.texto}</span>
                  </div>
                  <div style={{ fontSize: '.86rem', marginTop: '.2rem' }}>
                    {[o.solicitante, quienSolicita(o)].filter(Boolean).join(' — ') || '—'}
                  </div>
                  <div className="muted" style={{ fontSize: '.78rem', margin: '.15rem 0 .5rem' }}>
                    Revisó {nombreDe(null, o.revisada_almacen_por) || '—'} · {dateTime(o.revisada_almacen_en)}
                  </div>
                  <ResumenListas tiene={r.tiene} falta={r.falta} />
                  {o.nota_almacen?.trim() && <div className="muted" style={{ fontSize: '.82rem', marginTop: '.4rem' }}>📝 {o.nota_almacen.trim()}</div>}
                  <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.6rem' }} onClick={() => verMensajeRevision(o)}>
                    💬 Mensaje de la revisión
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {mensaje && <MensajeWhatsappModal titulo={mensaje.titulo} texto={mensaje.texto} onClose={() => setMensaje(null)} />}
    </div>
  );
}
