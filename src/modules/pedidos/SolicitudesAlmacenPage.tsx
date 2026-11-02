/* ============================================================
   MGG · Almacén · Solicitudes de Pedido (PC) (29-10-2026)

   Flujo nuevo: la SP pasa primero por ALMACÉN. Cada almacén (Los Pinos y
   Matanza · 30-10) confirma qué tiene de cada renglón; lo que ninguno tiene
   llega a Compras. Esta pantalla lista las SP que esperan a almacén (la más
   vieja primero, con qué sede ya confirmó) y, al elegir una, la revisión.
   La pestaña «Revisadas» muestra cómo quedaron (qué entrega cada almacén) y
   vuelve a abrir el mensaje de WhatsApp de la revisión.
   «Traslados» (30-10): lo que una sede entrega para la SP de la otra se
   traslada desde acá o desde el teléfono (ver TrasladoSolicitudAlmacen).

   Arranca APAGADO (`config.compras.revision_almacen`): mientras tanto se
   avisa con calma y la lista queda vacía porque ninguna SP nace en revisión.

   02-11-2026 (la administradora: «acomódame esto visualmente mejor, tipo lista
   buscable»): «Por revisar» tiene buscador y su propia columna con scroll;
   «Revisadas» pasó de tarjetas grandes a una lista buscable (SP, solicitante,
   producto; sin importar acentos) donde el detalle se abre debajo de la fila;
   y «📄 Ver PDF» abre la SP en la vista previa (nada se descarga solo).
   ============================================================ */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Orden } from '@/shared/lib/types';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { dateTime, relTime } from '@/shared/lib/format';
import { coincideTodo, textoBuscable } from '@/shared/lib/buscar';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { RevisionSolicitudAlmacen, ResumenListas, resultadoRevision } from './RevisionSolicitudAlmacen';
import { quienSolicita } from './quienSolicita';
import { TrasladoSolicitudAlmacen } from './TrasladoSolicitudAlmacen';
import {
  estadoSedes, etiquetaSede, fmtCant, mensajeRevisionAlmacen, mensajeRevisionSede, resumenRevision, sedesQuePuedeResponder, seRevisa,
  trasladosDeSolicitud, trasladosPendientes,
} from './revisionAlmacen';
import { listSolicitudesEnRevision, listSolicitudesRevisadas, useFlujoRevisionAlmacen } from './revisionAlmacen.repository';
import { verSolicitudPedidoPdf } from './solicitudPedidoPdf';

type Pestana = 'pendientes' | 'revisadas' | 'traslados';

/** «MANTENIMIENTO — JOSÉ PÉREZ»: la unidad y la persona que pide. */
function solicitaDe(o: Orden): string {
  return [o.solicitante, quienSolicita(o)].filter(Boolean).join(' — ') || '—';
}

/** Todo lo que se busca de una SP en un solo texto, sin acentos (código, quién, dónde, para qué, productos). */
function textoSp(o: Orden): string {
  return textoBuscable([
    o.codigo, o.solicitante, quienSolicita(o), o.sede_destino?.trim() ? etiquetaSede(o.sede_destino) : '',
    o.finalidad, o.motivo, ...(o.items ?? []).map((i) => i.nombre),
  ]);
}

export function SolicitudesAlmacenPage() {
  const activo = useFlujoRevisionAlmacen();
  const { soloTelefono, puedeVista, isAdmin } = usePermissions();
  const nombreDe = useNombreUsuario();
  const { sedes: misSedes } = useSectorizacion();
  const [pestana, setPestana] = useState<Pestana>('pendientes');
  const [pendientes, setPendientes] = useState<Orden[]>([]);
  const [revisadas, setRevisadas] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  /** Mensajes por mostrar, uno tras otro (la respuesta de la sede y, si cerró, la revisión completa). */
  const [mensajes, setMensajes] = useState<Array<{ titulo: string; texto: string }>>([]);
  const mensaje = mensajes[0] ?? null;
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

  // Buscadores de «Por revisar» y «Revisadas» (02-11-2026); la fila abierta de revisadas.
  const [qPend, setQPend] = useState('');
  const [qRev, setQRev] = useState('');
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const pendFiltradas = useMemo(() => pendientes.filter((o) => coincideTodo(textoSp(o), qPend)), [pendientes, qPend]);
  const revFiltradas = useMemo(() => revisadas.filter((o) => coincideTodo(textoSp(o), qRev)), [revisadas, qRev]);

  // Traslados por SP que le tocan a mis sedes (sin sede asignada: ninguna; el admin, todas).
  const sedesMias = useMemo(() => sedesQuePuedeResponder(misSedes, isAdmin), [misSedes, isAdmin]);
  const traslados = useMemo(() => revisadas.flatMap((o) => trasladosPendientes(o, sedesMias).map((t) => ({ orden: o, t }))), [revisadas, sedesMias]);
  const [trasSel, setTrasSel] = useState<{ ordenId: string; sede: string } | null>(null);
  const trasladoAbierto = useMemo(
    () => (trasSel ? traslados.find((x) => x.orden.id === trasSel.ordenId && x.t.sede === trasSel.sede) ?? null : null),
    [traslados, trasSel],
  );

  // Si la SP abierta la cerró otro usuario (o el teléfono), se avisa y se suelta.
  useEffect(() => {
    if (!selId || cargando || sel) return;
    const cerrada = revisadas.find((o) => o.id === selId);
    if (cerradaAca.current !== selId) {
      toast(cerrada ? `${cerrada.codigo} ya la revisó ${nombreDe(null, cerrada.revisada_almacen_por) || 'otro usuario'}` : 'La solicitud ya no está en revisión', 'info');
    }
    setSelId(null);
  }, [selId, sel, cargando, revisadas, nombreDe]);

  const nombreCorreo = useCallback((correo: string) => nombreDe(null, correo), [nombreDe]);

  function alConfirmar(actualizada: Orden, sede: string, revisor: string) {
    const cola = [{ titulo: `🏬 Almacén respondió ${actualizada.codigo}`, texto: mensajeRevisionSede(actualizada, sede, { revisor }) }];
    if (actualizada.estado !== 'revision_almacen') {
      // Respondieron todos: la SP salió de almacén.
      cerradaAca.current = actualizada.id;
      setSelId(null);
      cola.push({ titulo: `✅ Almacén revisó ${actualizada.codigo}`, texto: mensajeRevisionAlmacen(actualizada, { nombre: nombreCorreo }) });
    }
    setMensajes(cola);
    void reload();
  }

  function verMensajeRevision(o: Orden) {
    setMensajes([{
      titulo: `✅ Revisión de ${o.codigo}`,
      texto: mensajeRevisionAlmacen(o, { revisor: nombreDe(null, o.revisada_almacen_por), nombre: nombreCorreo }),
    }]);
  }

  /** La SP en la vista previa de PDF (solo con el botón: nada se descarga solo). */
  const [pdfId, setPdfId] = useState<string | null>(null);
  async function verPdf(o: Orden) {
    setPdfId(o.id);
    try {
      await verSolicitudPedidoPdf(o, { nombre: nombreCorreo });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo armar el PDF', 'error');
    } finally {
      setPdfId(null);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📋 Solicitudes de Pedido</h1>
          <p className="hint muted">
            Los almacenes de Los Pinos y Matanza confirman qué tienen de cada solicitud antes de que llegue a Compras. Lo que ninguno tiene pasa a Compras para cotizar.
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
        <button type="button" className={pestana === 'traslados' ? 'active' : ''} onClick={() => setPestana('traslados')}>
          🔁 Traslados por hacer ({traslados.length})
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
          <div className="spa-pendientes">
            <div className="spa-lista-pc">
              <input
                className="input"
                type="search"
                placeholder="🔎 Buscar SP, solicitante o producto"
                aria-label="Buscar solicitudes por revisar"
                value={qPend}
                onChange={(e) => setQPend(e.target.value)}
              />
              <div className="spa-lista-scroll">
                {!pendFiltradas.length && <p className="muted" style={{ fontSize: '.85rem', margin: '.3rem 0' }}>Nada coincide con la búsqueda.</p>}
                {pendFiltradas.map((o) => {
                  const n = (o.items ?? []).filter(seRevisa).length;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`card spa-sp${o.urgente ? ' urgente' : ''}`}
                      onClick={() => setSelId(o.id)}
                      aria-pressed={o.id === selId}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center' }}>
                        <strong className="mono">{o.codigo}</strong>
                        <span style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                          {o.urgente && <span className="badge danger" style={{ fontSize: '.7rem' }}>🚨 Urgente</span>}
                          <span className="muted" style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>{relTime(o.created_at)}</span>
                        </span>
                      </div>
                      <div style={{ fontSize: '.86rem', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {solicitaDe(o)}
                      </div>
                      <div className="muted" style={{ fontSize: '.78rem', marginTop: '.1rem' }}>
                        {n} producto(s){o.sede_destino?.trim() ? ` · 📍 ${etiquetaSede(o.sede_destino)}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                        {estadoSedes(o).map((e) => (
                          <span key={e.sede} className={`badge ${e.confirmada ? 'success' : e.revisados > 0 ? 'info' : 'warning'}`} style={{ fontSize: '.7rem' }}>
                            {e.etiqueta} {e.confirmada ? '✓' : e.revisados > 0 ? `${e.revisados}/${e.total}` : 'pendiente'}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ flex: '3 1 440px', minWidth: 0 }}>
              {sel ? (
                <RevisionSolicitudAlmacen key={sel.id} orden={sel} onConfirmada={alConfirmar} />
              ) : (
                <EmptyState icon="👈" message="Elige una solicitud de la lista para revisarla." />
              )}
            </div>
          </div>
        )
      )}

      {!cargando && pestana === 'traslados' && (
        trasladoAbierto ? (
          <div style={{ maxWidth: 720 }}>
            <TrasladoSolicitudAlmacen
              key={`${trasladoAbierto.orden.id}-${trasladoAbierto.t.sede}`}
              orden={trasladoAbierto.orden}
              traslado={trasladoAbierto.t}
              onCancel={() => setTrasSel(null)}
              onHecho={(actualizada, texto) => {
                setTrasSel(null);
                setMensajes([{ titulo: `🔁 Traslado ${actualizada.codigo}`, texto }]);
                void reload();
              }}
            />
          </div>
        ) : !traslados.length ? (
          <EmptyState icon="🔁" message={sedesMias.length === 1
            ? `${etiquetaSede(sedesMias[0])} no tiene traslados pendientes por solicitudes.`
            : 'No hay traslados pendientes por solicitudes.'} />
        ) : (
          <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {traslados.map(({ orden: o, t }) => (
              <div key={`${o.id}-${t.sede}`} className="card" style={{ padding: '.75rem .9rem', ...(o.urgente ? { borderColor: 'var(--danger)' } : {}) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong className="mono">{o.codigo}</strong>
                  <span className="badge info">{t.etiqueta} → {t.etiquetaDestino}</span>
                </div>
                <div style={{ fontSize: '.86rem', marginTop: '.2rem' }}>
                  {solicitaDe(o)}
                </div>
                <ul style={{ margin: '.4rem 0', paddingLeft: '1.1rem', fontSize: '.84rem' }}>
                  {t.renglones.map((r) => <li key={r.sku}>{r.nombre} — {fmtCant(r.cantidad)} {r.unidad}</li>)}
                </ul>
                <div className="muted" style={{ fontSize: '.78rem' }}>
                  {t.completo ? '📦 Stock completo' : '📦 Una parte del pedido'} · revisada {dateTime(o.revisada_almacen_en)}
                </div>
                <button type="button" className="btn btn-sm btn-primary" style={{ marginTop: '.6rem' }}
                  onClick={() => setTrasSel({ ordenId: o.id, sede: t.sede })}>
                  🔁 Trasladar a {t.etiquetaDestino}
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {!cargando && pestana === 'revisadas' && (
        !revisadas.length ? (
          <EmptyState icon="✅" message="Almacén no ha revisado solicitudes en los últimos 30 días." />
        ) : (
          <>
            <div className="spa-buscar">
              <input
                className="input"
                type="search"
                placeholder="🔎 Buscar SP, solicitante o producto"
                aria-label="Buscar solicitudes revisadas"
                value={qRev}
                onChange={(e) => setQRev(e.target.value)}
              />
              <span className="muted" style={{ fontSize: '.82rem' }}>
                {revFiltradas.length === revisadas.length ? `${revisadas.length} solicitud(es)` : `${revFiltradas.length} de ${revisadas.length}`} · últimos 30 días · toca una fila para ver el detalle
              </span>
            </div>
            {!revFiltradas.length ? (
              <EmptyState icon="🔎" message="Nada coincide con la búsqueda." />
            ) : (
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="table spa-revisadas">
                  <thead>
                    <tr>
                      <th>SP</th>
                      <th>Solicitante</th>
                      <th>Se necesita en</th>
                      <th>Resultado</th>
                      <th>Revisaron</th>
                      <th style={{ textAlign: 'right' }}>📦 Tiene · 🛒 Compras</th>
                      <th>Traslado</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {revFiltradas.map((o) => {
                      const abierta = o.id === abiertaId;
                      const res = resultadoRevision(o);
                      const r = resumenRevision(o.items ?? []);
                      const trs = trasladosDeSolicitud(o);
                      const conf = estadoSedes(o).filter((e) => e.confirmada);
                      const alternar = () => setAbiertaId(abierta ? null : o.id);
                      return (
                        <Fragment key={o.id}>
                          <tr
                            className={`fila${abierta ? ' abierta' : ''}`}
                            onClick={alternar}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } }}
                            tabIndex={0}
                            aria-expanded={abierta}
                            title={abierta ? 'Ocultar el detalle' : 'Ver el detalle'}
                          >
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <strong className="mono">{abierta ? '▾' : '▸'} {o.codigo}</strong>
                              {o.urgente && <div className="sub"><span className="badge danger" style={{ fontSize: '.68rem' }}>🚨 Urgente</span></div>}
                            </td>
                            <td>{solicitaDe(o)}</td>
                            <td>{o.sede_destino?.trim() ? etiquetaSede(o.sede_destino) : <span className="muted">—</span>}</td>
                            <td><span className={`badge ${res.clase}`}>{res.texto}</span></td>
                            <td>
                              {conf.length
                                ? conf.map((e) => <div key={e.sede}>{e.etiqueta}: {nombreDe(null, e.confirmacion?.confirmada_por) || '—'}</div>)
                                : <div>{nombreDe(null, o.revisada_almacen_por) || '—'}</div>}
                              <div className="sub">{dateTime(o.revisada_almacen_en)}</div>
                            </td>
                            <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>📦 {r.tiene.length} · 🛒 {r.falta.length}</td>
                            <td>
                              {!trs.length ? <span className="muted">—</span>
                                : trs.every((t) => t.hecho) ? <span className="badge success">Trasladado</span>
                                  : <span className="badge warning">Pendiente</span>}
                            </td>
                            <td className="actions">
                              <button type="button" className="btn btn-ghost btn-sm" disabled={pdfId === o.id}
                                onClick={(e) => { e.stopPropagation(); void verPdf(o); }} title="Abre la SP en la vista previa de PDF">
                                {pdfId === o.id ? 'Armando…' : '📄 Ver PDF'}
                              </button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); verMensajeRevision(o); }}>
                                💬 Mensaje de la revisión
                              </button>
                            </td>
                          </tr>
                          {abierta && (
                            <tr className="detalle">
                              <td colSpan={8}>
                                <div className="spa-rev-detalle">
                                  <ResumenListas {...r} />
                                  <div style={{ display: 'grid', gap: '.35rem', fontSize: '.84rem', alignContent: 'start' }}>
                                    {estadoSedes(o).map((e) => (
                                      <div key={e.sede}>
                                        🏬 <strong>{e.etiqueta}</strong>:{' '}
                                        {e.confirmada
                                          ? <>confirmó {nombreDe(null, e.confirmacion?.confirmada_por) || '—'} <span className="muted">· {dateTime(e.confirmacion?.confirmada_en)}</span></>
                                          : <span className="muted">sin confirmación</span>}
                                      </div>
                                    ))}
                                    {trs.map((t) => (
                                      <div key={t.sede}>
                                        🔁 {t.etiqueta} → {t.etiquetaDestino}:{' '}
                                        {t.hecho
                                          ? <span className="badge success">trasladado · {nombreDe(null, t.hecho.por) || '—'} · {dateTime(t.hecho.en)}</span>
                                          : <span className="badge warning">traslado pendiente</span>}
                                      </div>
                                    ))}
                                    {o.nota_almacen?.trim() && <div className="muted">📝 {o.nota_almacen.trim()}</div>}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {mensaje && <MensajeWhatsappModal key={mensaje.titulo} titulo={mensaje.titulo} texto={mensaje.texto} onClose={() => setMensajes((m) => m.slice(1))} />}
    </div>
  );
}
