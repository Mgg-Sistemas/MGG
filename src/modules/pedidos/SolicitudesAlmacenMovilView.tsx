/* ============================================================
   MGG · Almacén · Solicitudes de Pedido · pantalla de teléfono (29-10-2026)

   Para el almacenista con el teléfono en la mano, entre los estantes: tarjetas
   grandes (por revisar / urgentes / revisadas), un buscador y la lista. Al
   tocar una SP se abre la misma revisión que en la PC, con botones grandes.
   Cada toque se guarda solo y se ve en vivo en la PC (`ordenes` en realtime).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Orden } from '@/shared/lib/types';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { dateTime, relTime } from '@/shared/lib/format';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { RevisionSolicitudAlmacen, resultadoRevision } from './RevisionSolicitudAlmacen';
import { quienSolicita } from './quienSolicita';
import { mensajeRevisionAlmacen, resumenRevision, seRevisa } from './revisionAlmacen';
import { listSolicitudesEnRevision, listSolicitudesRevisadas, useFlujoRevisionAlmacen } from './revisionAlmacen.repository';

const RUTA = '/app/solicitudes-pedido/telefono';

type Filtro = 'pendientes' | 'urgentes' | 'revisadas';

function textoBusqueda(o: Orden): string {
  return [o.codigo, o.solicitante, quienSolicita(o), o.finalidad, o.motivo, ...(o.items ?? []).map((i) => i.nombre)]
    .filter(Boolean).join(' ').toUpperCase();
}

export function SolicitudesAlmacenMovilView() {
  const activo = useFlujoRevisionAlmacen();
  const { user } = useSession();
  const { appUser, soloTelefono, role } = usePermissions();
  const nombreDe = useNombreUsuario();
  const actorName = appUser?.nombre?.trim() || user?.email || '';

  const [pendientes, setPendientes] = useState<Orden[]>([]);
  const [revisadas, setRevisadas] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ titulo: string; texto: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listSolicitudesEnRevision(), listSolicitudesRevisadas(7)]);
      setPendientes(p);
      setRevisadas(r);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar las solicitudes', 'error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['ordenes'], () => { void reload(); });

  const sel = useMemo(() => pendientes.find((o) => o.id === selId) ?? null, [pendientes, selId]);

  // La SP abierta la cerró otro (la PC, otro teléfono): se avisa y se vuelve a la lista.
  useEffect(() => {
    if (!selId || cargando || sel) return;
    const cerrada = revisadas.find((o) => o.id === selId);
    toast(cerrada ? `${cerrada.codigo} ya la revisó ${nombreDe(null, cerrada.revisada_almacen_por) || 'otro usuario'}` : 'La solicitud ya no está en revisión', 'info');
    setSelId(null);
  }, [selId, sel, cargando, revisadas, nombreDe]);

  const urgentes = useMemo(() => pendientes.filter((o) => o.urgente), [pendientes]);
  const lista = useMemo(() => {
    const base = filtro === 'revisadas' ? revisadas : filtro === 'urgentes' ? urgentes : pendientes;
    const t = q.trim().toUpperCase();
    return t ? base.filter((o) => textoBusqueda(o).includes(t)) : base;
  }, [filtro, revisadas, urgentes, pendientes, q]);

  function alRevisar(actualizada: Orden, revisor: string) {
    setSelId(null);
    setMensaje({ titulo: `✅ Almacén revisó ${actualizada.codigo}`, texto: mensajeRevisionAlmacen(actualizada, { revisor }) });
    void reload();
  }

  function abrirRevisada(o: Orden) {
    setMensaje({
      titulo: `✅ Revisión de ${o.codigo}`,
      texto: mensajeRevisionAlmacen(o, { revisor: nombreDe(null, o.revisada_almacen_por) }),
    });
  }

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>📋 Solicitudes de Pedido</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}>
            {actorName}{role ? ` · ${role.toUpperCase()}` : ''} · Almacén
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {sel && <button type="button" className="btn btn-ghost" onClick={() => setSelId(null)}>← Lista</button>}
          {!soloTelefono && <Link to="/app/solicitudes-pedido" className="btn btn-ghost">🖥 Módulo completo</Link>}
        </div>
      </header>
      <AtajosTelefono actual={RUTA} />

      {!activo && (
        <div className="aviso info sm" style={{ margin: '0 0 .75rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>Este flujo se activa cuando la administración lo indique; por ahora las solicitudes siguen yendo directo a Compras.</div>
        </div>
      )}

      {sel ? (
        <RevisionSolicitudAlmacen key={sel.id} orden={sel} variante="telefono" onRevisada={alRevisar} />
      ) : (
        <>
          <div className="surt-acciones">
            <button type="button" className="surt-btn primario" aria-pressed={filtro === 'pendientes'} onClick={() => setFiltro('pendientes')}
              style={{ gridColumn: 'auto', ...(filtro === 'pendientes' ? {} : { opacity: .8 }) }}>
              <span className="icono" aria-hidden>🕒</span>
              <span>{pendientes.length}</span>
              <small>Por revisar</small>
            </button>
            <button type="button" className="surt-btn merma" aria-pressed={filtro === 'urgentes'} onClick={() => setFiltro('urgentes')}
              style={{ gridColumn: 'auto', ...(filtro === 'urgentes' ? { background: 'color-mix(in srgb, var(--danger) 14%, transparent)' } : { opacity: .8 }) }}>
              <span className="icono" aria-hidden>🚨</span>
              <span>{urgentes.length}</span>
              <small>Urgentes</small>
            </button>
            <button type="button" className="surt-btn entrada" aria-pressed={filtro === 'revisadas'} onClick={() => setFiltro('revisadas')}
              style={{ gridColumn: '1 / -1', minHeight: 84, ...(filtro === 'revisadas' ? { background: 'color-mix(in srgb, var(--success) 14%, transparent)' } : { opacity: .8 }) }}>
              <span className="icono" aria-hidden style={{ fontSize: '1.6rem' }}>✅</span>
              <span style={{ fontSize: '1.05rem' }}>Revisadas ({revisadas.length})</span>
              <small>Últimos 7 días · toca una para el mensaje de WhatsApp</small>
            </button>
          </div>

          <input
            className="input surt-input"
            type="search"
            placeholder="🔎 Buscar SP, solicitante o producto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: '100%', marginBottom: '.75rem' }}
          />

          {cargando && <p className="muted">Cargando…</p>}

          {!cargando && !lista.length && (
            <EmptyState
              icon={filtro === 'revisadas' ? '✅' : '📋'}
              message={q.trim() ? 'Nada coincide con la búsqueda.'
                : filtro === 'revisadas' ? 'No hay solicitudes revisadas en los últimos 7 días.'
                  : filtro === 'urgentes' ? 'No hay solicitudes urgentes por revisar.'
                    : 'No hay solicitudes esperando revisión de almacén.'}
            />
          )}

          <div className="surt-lista">
            {!cargando && lista.map((o) => {
              const solicita = [o.solicitante, quienSolicita(o)].filter(Boolean).join(' — ') || '—';
              if (filtro === 'revisadas') {
                const res = resultadoRevision(o);
                const r = resumenRevision(o.items ?? []);
                return (
                  <button key={o.id} type="button" className="surt-mov" onClick={() => abrirRevisada(o)}>
                    <span className="icono" aria-hidden>{o.estado === 'atendida_almacen' ? '📦' : '🛒'}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="titulo" style={{ display: 'block' }}>{o.codigo} · {solicita}</span>
                      <span className="sub" style={{ display: 'block' }}>
                        <span className={`badge ${res.clase}`} style={{ fontSize: '.7rem' }}>{res.texto}</span> {dateTime(o.revisada_almacen_en)}
                      </span>
                    </span>
                    <span className="litros" style={{ fontSize: '.85rem', textAlign: 'right' }}>
                      📦 {r.tiene.length}<br />🛒 {r.falta.length}
                    </span>
                  </button>
                );
              }
              const n = (o.items ?? []).filter(seRevisa).length;
              const revisados = (o.items ?? []).filter((it) => seRevisa(it) && it.almacen_revisado).length;
              return (
                <button key={o.id} type="button" className="surt-mov" onClick={() => setSelId(o.id)}
                  style={o.urgente ? { borderColor: 'var(--danger)' } : undefined}>
                  <span className="icono" aria-hidden>{o.urgente ? '🚨' : '📋'}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="titulo" style={{ display: 'block' }}>{o.codigo} · {solicita}</span>
                    <span className="sub" style={{ display: 'block' }}>
                      {n} producto(s) · {relTime(o.created_at)}{revisados > 0 ? ` · ${revisados} revisado(s)` : ''}
                    </span>
                  </span>
                  <span className="litros">{n}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {mensaje && <MensajeWhatsappModal titulo={mensaje.titulo} texto={mensaje.texto} onClose={() => setMensaje(null)} />}
    </div>
  );
}
