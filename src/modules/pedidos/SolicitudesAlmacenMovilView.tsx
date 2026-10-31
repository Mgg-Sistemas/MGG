/* ============================================================
   MGG · Almacén · Solicitudes de Pedido · pantalla de teléfono (29-10-2026)

   Para el almacenista con el teléfono en la mano, entre los estantes: tarjetas
   grandes (por revisar / urgentes / revisadas), un buscador y la lista. Al
   tocar una SP se abre la misma revisión que en la PC, con botones grandes:
   el almacenista responde por SU sede (Los Pinos o Matanza · 30-10) y en la
   lista se ve qué sede ya confirmó. Cada toque se guarda solo y se ve en vivo
   en la PC (`ordenes` en realtime).

   «🔁 Traslados» (30-10): si lo pedido lo tiene la otra sede, su almacenista
   lo traslada desde acá a la sede donde se necesita (ver TrasladoSolicitudAlmacen).
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Orden } from '@/shared/lib/types';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { dateTime, relTime } from '@/shared/lib/format';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { RevisionSolicitudAlmacen, resultadoRevision } from './RevisionSolicitudAlmacen';
import { quienSolicita } from './quienSolicita';
import { TrasladoSolicitudAlmacen } from './TrasladoSolicitudAlmacen';
import {
  etiquetaSede, fmtCant, mensajeRevisionAlmacen, mensajeRevisionSede, resumenRevision, sedesQuePuedeResponder, seRevisa,
  textoEstadoSedes, trasladosPendientes,
} from './revisionAlmacen';
import { listSolicitudesEnRevision, listSolicitudesRevisadas, useFlujoRevisionAlmacen } from './revisionAlmacen.repository';

const RUTA = '/app/solicitudes-pedido/telefono';

type Filtro = 'pendientes' | 'urgentes' | 'revisadas' | 'traslados';

/** Las revisadas se listan de la última semana; los traslados pendientes, del último mes. */
const DIAS_REVISADAS = 7;
const DIAS_TRASLADOS = 30;

function textoBusqueda(o: Orden): string {
  return [o.codigo, o.solicitante, quienSolicita(o), o.finalidad, o.motivo, ...(o.items ?? []).map((i) => i.nombre)]
    .filter(Boolean).join(' ').toUpperCase();
}

export function SolicitudesAlmacenMovilView() {
  const activo = useFlujoRevisionAlmacen();
  const { user } = useSession();
  const { appUser, soloTelefono, role } = usePermissions();
  const nombreDe = useNombreUsuario();
  const { sedes: misSedes } = useSectorizacion();
  const actorName = appUser?.nombre?.trim() || user?.email || '';

  const [pendientes, setPendientes] = useState<Orden[]>([]);
  const [revisadas, setRevisadas] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  /** Mensajes por mostrar, uno tras otro (la respuesta de la sede y, si cerró, la revisión completa). */
  const [mensajes, setMensajes] = useState<Array<{ titulo: string; texto: string }>>([]);
  const mensaje = mensajes[0] ?? null;
  /** La SP que se acaba de cerrar acá: si sale de la lista no se avisa como «la revisó otro». */
  const cerradaAca = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listSolicitudesEnRevision(), listSolicitudesRevisadas(DIAS_TRASLADOS)]);
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

  // Traslados que le tocan a MIS sedes (sin sede asignada: todas).
  const sedesMias = useMemo(() => sedesQuePuedeResponder(misSedes), [misSedes]);
  const traslados = useMemo(() => revisadas.flatMap((o) => trasladosPendientes(o, sedesMias).map((t) => ({ orden: o, t }))), [revisadas, sedesMias]);
  const [trasSel, setTrasSel] = useState<{ ordenId: string; sede: string } | null>(null);
  const trasladoAbierto = useMemo(
    () => (trasSel ? traslados.find((x) => x.orden.id === trasSel.ordenId && x.t.sede === trasSel.sede) ?? null : null),
    [traslados, trasSel],
  );
  const recientes = useMemo(() => {
    const desde = Date.now() - DIAS_REVISADAS * 86_400_000;
    return revisadas.filter((o) => new Date(o.revisada_almacen_en ?? 0).getTime() >= desde);
  }, [revisadas]);

  // La SP abierta la cerró otro (la PC, otro teléfono): se avisa y se vuelve a la lista.
  useEffect(() => {
    if (!selId || cargando || sel) return;
    const cerrada = revisadas.find((o) => o.id === selId);
    if (cerradaAca.current !== selId) toast(cerrada ? `${cerrada.codigo} ya la revisó ${nombreDe(null, cerrada.revisada_almacen_por) || 'otro usuario'}` : 'La solicitud ya no está en revisión', 'info');
    setSelId(null);
  }, [selId, sel, cargando, revisadas, nombreDe]);

  const urgentes = useMemo(() => pendientes.filter((o) => o.urgente), [pendientes]);
  const lista = useMemo(() => {
    const base = filtro === 'revisadas' ? recientes : filtro === 'urgentes' ? urgentes : pendientes;
    const t = q.trim().toUpperCase();
    return t ? base.filter((o) => textoBusqueda(o).includes(t)) : base;
  }, [filtro, recientes, urgentes, pendientes, q]);

  const nombreCorreo = useCallback((correo: string) => nombreDe(null, correo), [nombreDe]);

  function alConfirmar(actualizada: Orden, sede: string, revisor: string) {
    const cola = [{ titulo: `🏬 Almacén respondió ${actualizada.codigo}`, texto: mensajeRevisionSede(actualizada, sede, { revisor }) }];
    if (actualizada.estado !== 'revision_almacen') {
      // Respondieron todos: la SP salió de almacén.
      cerradaAca.current = actualizada.id;
      cola.push({ titulo: `✅ Almacén revisó ${actualizada.codigo}`, texto: mensajeRevisionAlmacen(actualizada, { nombre: nombreCorreo }) });
    }
    setSelId(null);
    setMensajes(cola);
    void reload();
  }

  function abrirRevisada(o: Orden) {
    setMensajes([{
      titulo: `✅ Revisión de ${o.codigo}`,
      texto: mensajeRevisionAlmacen(o, { revisor: nombreDe(null, o.revisada_almacen_por), nombre: nombreCorreo }),
    }]);
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
          {(sel || trasladoAbierto) && <button type="button" className="btn btn-ghost" onClick={() => { setSelId(null); setTrasSel(null); }}>← Lista</button>}
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

      {trasladoAbierto ? (
        <TrasladoSolicitudAlmacen
          key={`${trasladoAbierto.orden.id}-${trasladoAbierto.t.sede}`}
          orden={trasladoAbierto.orden}
          traslado={trasladoAbierto.t}
          variante="telefono"
          onCancel={() => setTrasSel(null)}
          onHecho={(actualizada, texto) => {
            setTrasSel(null);
            setMensajes([{ titulo: `🔁 Traslado ${actualizada.codigo}`, texto }]);
            void reload();
          }}
        />
      ) : sel ? (
        <RevisionSolicitudAlmacen key={sel.id} orden={sel} variante="telefono" onConfirmada={alConfirmar} />
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
            <button type="button" className="surt-btn traslado" aria-pressed={filtro === 'traslados'} onClick={() => setFiltro('traslados')}
              style={{ gridColumn: '1 / -1', minHeight: 84, ...(filtro === 'traslados' ? { background: 'color-mix(in srgb, var(--info) 14%, transparent)' } : { opacity: .8 }), ...(traslados.length ? { borderColor: 'var(--info)' } : {}) }}>
              <span className="icono" aria-hidden style={{ fontSize: '1.6rem' }}>🔁</span>
              <span style={{ fontSize: '1.05rem' }}>Traslados por hacer ({traslados.length})</span>
              <small>Lo pedido lo tiene tu sede y se necesita en la otra</small>
            </button>
            <button type="button" className="surt-btn entrada" aria-pressed={filtro === 'revisadas'} onClick={() => setFiltro('revisadas')}
              style={{ gridColumn: '1 / -1', minHeight: 84, ...(filtro === 'revisadas' ? { background: 'color-mix(in srgb, var(--success) 14%, transparent)' } : { opacity: .8 }) }}>
              <span className="icono" aria-hidden style={{ fontSize: '1.6rem' }}>✅</span>
              <span style={{ fontSize: '1.05rem' }}>Revisadas ({recientes.length})</span>
              <small>Últimos {DIAS_REVISADAS} días · toca una para el mensaje de WhatsApp</small>
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

          {filtro === 'traslados' && !cargando && (
            traslados.length ? (
              <div className="surt-lista">
                {traslados.filter(({ orden: o }) => !q.trim() || textoBusqueda(o).includes(q.trim().toUpperCase())).map(({ orden: o, t }) => (
                  <button key={`${o.id}-${t.sede}`} type="button" className="surt-mov" onClick={() => setTrasSel({ ordenId: o.id, sede: t.sede })}
                    style={o.urgente ? { borderColor: 'var(--danger)' } : undefined}>
                    <span className="icono" aria-hidden>🔁</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="titulo" style={{ display: 'block' }}>{o.codigo} · {t.etiqueta} → {t.etiquetaDestino}</span>
                      <span className="sub" style={{ display: 'block' }}>
                        {t.renglones.map((r) => `${r.nombre} ${fmtCant(r.cantidad)}`).join(' · ')}
                      </span>
                      <span className="sub" style={{ display: 'block' }}>
                        {t.completo ? '📦 Stock completo' : '📦 Una parte del pedido'} · revisada {relTime(o.revisada_almacen_en ?? o.created_at)}
                      </span>
                    </span>
                    <span className="litros">{t.renglones.length}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon="🔁" message={sedesMias.length === 1
                ? `${etiquetaSede(sedesMias[0])} no tiene traslados pendientes por solicitudes.`
                : 'No hay traslados pendientes por solicitudes.'} />
            )
          )}

          {filtro !== 'traslados' && !cargando && !lista.length && (
            <EmptyState
              icon={filtro === 'revisadas' ? '✅' : '📋'}
              message={q.trim() ? 'Nada coincide con la búsqueda.'
                : filtro === 'revisadas' ? 'No hay solicitudes revisadas en los últimos 7 días.'
                  : filtro === 'urgentes' ? 'No hay solicitudes urgentes por revisar.'
                    : 'No hay solicitudes esperando revisión de almacén.'}
            />
          )}

          <div className="surt-lista">
            {filtro !== 'traslados' && !cargando && lista.map((o) => {
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
              return (
                <button key={o.id} type="button" className="surt-mov" onClick={() => setSelId(o.id)}
                  style={o.urgente ? { borderColor: 'var(--danger)' } : undefined}>
                  <span className="icono" aria-hidden>{o.urgente ? '🚨' : '📋'}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="titulo" style={{ display: 'block' }}>{o.codigo} · {solicita}</span>
                    <span className="sub" style={{ display: 'block' }}>
                      {n} producto(s) · {relTime(o.created_at)}
                    </span>
                    <span className="sub" style={{ display: 'block' }}>🏬 {textoEstadoSedes(o)}</span>
                  </span>
                  <span className="litros">{n}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {mensaje && <MensajeWhatsappModal key={mensaje.titulo} titulo={mensaje.titulo} texto={mensaje.texto} onClose={() => setMensajes((m) => m.slice(1))} />}
    </div>
  );
}
