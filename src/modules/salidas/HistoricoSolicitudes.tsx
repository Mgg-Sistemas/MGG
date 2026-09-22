import { useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { dateTime, num } from '@/shared/lib/format';
import type { ScopeSalida, SolicitudSalida } from '@/shared/lib/types';
import { SOL_COLS, colDe, etiquetaCol } from './columnasSalida';
import {
  PAGINA_HISTORICO, accionesDe, directorioDeActores, filtrarHistorico,
  nombreDeActor, personasDelHistorico, verboEvento, type FiltroHistorico,
} from './historicoSalidas';

/**
 * El histórico de solicitudes: TODAS, con filtros y con quién hizo cada cosa.
 *
 * El tablero muestra las últimas de cada columna porque es para trabajar. Acá
 * está el resto —y las últimas también, para no tener que acordarse de en cuál
 * de las dos pantallas mirar—. La pregunta que contesta esta pantalla es «qué
 * pasó con esto» y «qué tocó fulano», y por eso la persona se busca en todo el
 * historial: quien ejecuta no siempre es quien pidió.
 */
export function HistoricoSolicitudes({
  sols, scope, filtroInicial, onVer,
}: {
  sols: SolicitudSalida[];
  scope: ScopeSalida;
  /** Columna con la que abrir (viene del «ver el resto» de una columna del tablero). */
  filtroInicial?: FiltroHistorico;
  onVer: (s: SolicitudSalida) => void;
}) {
  const [f, setF] = useState<FiltroHistorico>(filtroInicial ?? {});
  const [aMostrar, setAMostrar] = useState(PAGINA_HISTORICO);

  const dir = useMemo(() => directorioDeActores(sols), [sols]);
  const personas = useMemo(() => personasDelHistorico(sols), [sols]);
  const solicitantes = useMemo(
    () => Array.from(new Set(sols.map((s) => (s.solicitante ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [sols],
  );
  const filtradas = useMemo(() => filtrarHistorico(sols, f), [sols, f]);
  // Cada cambio de filtro vuelve a la primera tanda: si no, una búsqueda nueva
  // arrancaría mostrando 200 filas porque antes se habían pedido más.
  const poner = (patch: Partial<FiltroHistorico>) => { setF((p) => ({ ...p, ...patch })); setAMostrar(PAGINA_HISTORICO); };
  const limpiar = () => { setF({}); setAMostrar(PAGINA_HISTORICO); };
  const hayFiltro = !!(f.texto?.trim() || f.columna || f.persona || f.solicitante || f.desde || f.hasta);
  const visibles = filtradas.slice(0, aMostrar);

  return (
    <div>
      <div className="filterbar" style={{ gap: '.6rem', marginBottom: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ margin: 0, flex: '1 1 220px', minWidth: 180 }}>
          <label style={{ fontSize: '.72rem' }}>🔎 Buscar</label>
          <input className="input" value={f.texto ?? ''} placeholder="Código, N°, material, destino…"
            onChange={(e) => poner({ texto: e.target.value })} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>🗂 Estado</label>
          <select className="select" value={f.columna ?? ''} onChange={(e) => poner({ columna: e.target.value as FiltroHistorico['columna'] })}>
            <option value="">Todos</option>
            {SOL_COLS.map((c) => <option key={c.key} value={c.key}>{etiquetaCol(c, scope)}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>👤 Quien hizo la acción</label>
          <select className="select" value={f.persona ?? ''} onChange={(e) => poner({ persona: e.target.value })}>
            <option value="">Todos</option>
            {personas.map(([email, nombre]) => <option key={email} value={email}>{nombre}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>🏷 Solicitante</label>
          <select className="select" value={f.solicitante ?? ''} onChange={(e) => poner({ solicitante: e.target.value })}>
            <option value="">Todos</option>
            {solicitantes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>📅 Creada desde</label>
          <input className="input" type="date" value={f.desde ?? ''} onChange={(e) => poner({ desde: e.target.value })} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>📅 Hasta</label>
          <input className="input" type="date" value={f.hasta ?? ''} onChange={(e) => poner({ hasta: e.target.value })} />
        </div>
        {hayFiltro && <button className="btn btn-sm btn-ghost" onClick={limpiar}>✕ Limpiar</button>}
      </div>

      <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.5rem' }}>
        {num(filtradas.length)} de {num(sols.length)} solicitud(es){hayFiltro ? ' con los filtros puestos' : ''}.
        {' '}La persona se busca en <strong>todo el historial</strong>: quien la creó, quien la aprobó y quien la ejecutó.
      </div>

      {!filtradas.length ? (
        <EmptyState message={sols.length ? 'Ninguna solicitud coincide con los filtros.' : 'Todavía no hay solicitudes.'} icon="📚" />
      ) : (<>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th style={{ textAlign: 'center' }}>N°</th>
                <th>Código</th>
                <th>Estado</th>
                <th>Material</th>
                <th>{scope === 'traslado' ? 'Origen → Destino' : 'Origen → Dirigido a'}</th>
                <th>Solicitante</th>
                <th>Quién hizo qué</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => {
                const col = colDe(s);
                const items = s.items?.length ?? 0;
                const acciones = accionesDe(s);
                const material = s.tipo === 'material'
                  ? (items > 1 ? `${s.producto_nombre ?? 'Material'} +${items - 1} más` : (s.producto_nombre ?? 'Material'))
                  : 'Dinero';
                return (
                  <tr key={s.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => onVer(s)} title="Ver detalle">
                    <td className="muted" style={{ fontSize: '.74rem', whiteSpace: 'nowrap' }}>{dateTime(s.created_at)}</td>
                    <td className="mono" style={{ textAlign: 'center', fontWeight: 800, color: 'var(--primary-3)' }}>
                      {s.num_usuario != null ? String(s.num_usuario).padStart(3, '0') : '—'}
                    </td>
                    <td className="mono muted" style={{ fontSize: '.72rem', whiteSpace: 'nowrap' }}>{s.codigo}</td>
                    <td><span className={`badge ${col?.badge ?? 'info'}`}>{etiquetaCol(col, s.scope)}</span></td>
                    <td style={{ fontWeight: 600 }}>{material}</td>
                    <td className="muted" style={{ fontSize: '.76rem' }}>
                      {(s.almacen_origen ?? '—')} → {(s.scope === 'traslado' ? s.almacen_destino : s.destino) ?? '—'}
                    </td>
                    <td style={{ fontSize: '.78rem', color: 'var(--success)', fontWeight: 600 }}>{s.solicitante || '—'}</td>
                    <td>
                      {/* El rastro completo: sin esto hay que abrir la solicitud para
                          saber quién la aprobó, que es justo lo que se viene a ver acá. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.1rem' }}>
                        {acciones.map((a, i) => (
                          <span key={`${a.evento}-${a.at}-${i}`} className="muted" style={{ fontSize: '.7rem', whiteSpace: 'nowrap' }}>
                            {verboEvento(a.evento)} · <strong style={{ color: 'var(--text)' }}>{nombreDeActor(a.actor, dir)}</strong>
                          </span>
                        ))}
                        {!acciones.length && <span className="muted" style={{ fontSize: '.7rem' }}>—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtradas.length > visibles.length && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '.7rem' }}>
            <button className="btn btn-ghost" onClick={() => setAMostrar((n) => n + PAGINA_HISTORICO)}>
              ↓ Ver {Math.min(PAGINA_HISTORICO, filtradas.length - visibles.length)} más
              <span className="muted"> · faltan {num(filtradas.length - visibles.length)}</span>
            </button>
          </div>
        )}
      </>)}
    </div>
  );
}
