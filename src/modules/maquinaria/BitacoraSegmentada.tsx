/* ============================================================
   Bitácora por segmentos (12-11-2026, traída de Golden Touch).
   Un «switch» por cosa que se le hace a la máquina (Filtros, Aceite,
   Combustible, Mangueras, Cauchos, Frenos…). Cada uno es su propia
   bitácora: rango de fechas (con atajos) y buscador por todo (tipo,
   trabajo, consumibles, mecánico, ubicación, horómetro…). Al tocar un
   registro se abre su vista previa con todos los detalles y las fotos
   (las del mantenimiento y las de la salida del almacén, si vino de una
   entrega). «Combustible» muestra los surtidos de Combustible de la máquina.
   ============================================================ */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { date as fmtDate, dateTime, num as fmtNum } from '@/shared/lib/format';
import { etiquetaTipoMant, TIPOS_MANTENIMIENTO, type MantenimientoCalc } from './maquinariaMant.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { surtidosDeEquipo, type SurtidoEquipo } from './flota.repository';
import {
  FILTRO_BITACORA_VACIO, SEGMENTOS_BITACORA, conteoPorSegmento, filtrarBitacora, filtrarSurtidos, hoyVE, lineaItem,
  restarDias, tiposDe, type EntregaAlmacen, type FiltroBitacora, type SegmentoBitacora,
} from './entregasAlmacen';
import { getEntrega } from './entregasAlmacen.repository';
import { FotosMiniatura, FotosSalidaEntrega } from './EntregasAlmacenPanel';

const etiquetaSinIcono = (t: string) => TIPOS_MANTENIMIENTO.find((x) => x.value === t)?.label ?? t;

export function BitacoraSegmentada({ rows, equipo, canWrite, loading, onEditar, onBorrar }: {
  rows: MantenimientoCalc[];
  equipo: MaquinariaEquipo;
  canWrite: boolean;
  loading: boolean;
  onEditar: (r: MantenimientoCalc) => void;
  onBorrar: (id: string) => void;
}) {
  const [f, setF] = useState<FiltroBitacora>(FILTRO_BITACORA_VACIO);
  const [surtidos, setSurtidos] = useState<SurtidoEquipo[] | null>(null);
  const [errorSurtidos, setErrorSurtidos] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<MantenimientoCalc | null>(null);
  const esComb = f.segmento === 'combustible';

  useEffect(() => {
    if (!esComb || surtidos) return;
    surtidosDeEquipo(equipo.combustible_equipo, 1000)
      .then((xs) => setSurtidos(xs))
      .catch((e) => { setSurtidos([]); setErrorSurtidos(e instanceof Error ? e.message : 'No se pudieron leer los surtidos'); });
  }, [esComb, surtidos, equipo.combustible_equipo]);

  const conteo = useMemo(() => conteoPorSegmento(rows), [rows]);
  const filtradas = useMemo(() => filtrarBitacora(rows, f, etiquetaSinIcono), [rows, f]);
  const surtidosFiltrados = useMemo(() => filtrarSurtidos(surtidos ?? [], f), [surtidos, f]);
  const set = <K extends keyof FiltroBitacora>(k: K, v: FiltroBitacora[K]) => setF((x) => ({ ...x, [k]: v }));
  const atajo = (dias: number | null) => setF((x) => ({ ...x, desde: dias == null ? '' : restarDias(hoyVE(), dias), hasta: dias == null ? '' : hoyVE() }));
  const litros = surtidosFiltrados.reduce((a, s) => a + (Number(s.litros) || 0), 0);
  const columnas = canWrite ? 11 : 10;

  return (
    <div>
      {/* Switches */}
      <div role="tablist" aria-label="Segmentos de la bitácora" style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: '.6rem' }}>
        {SEGMENTOS_BITACORA.map((s) => {
          const activo = f.segmento === s.valor;
          const n = s.valor === 'combustible' ? surtidos?.length : conteo[s.valor];
          return (
            <button key={s.valor} type="button" role="tab" aria-selected={activo}
              className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => set('segmento', s.valor as SegmentoBitacora)}>
              {s.icono} {s.etiqueta}{n != null ? <span className="badge" style={{ marginLeft: '.3rem' }}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Fechas y buscador del segmento */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', alignItems: 'flex-end', marginBottom: '.6rem' }}>
        <div className="form-row" style={{ margin: 0, flex: '2 1 220px' }}>
          <label htmlFor="bit-seg-buscar">Buscar</label>
          <input id="bit-seg-buscar" className="input" type="search" value={f.texto} onChange={(e) => set('texto', e.target.value)}
            placeholder={esComb ? '🔍 Fecha, litros, horómetro, ubicación, quién autorizó…' : '🔍 Tipo, trabajo, consumibles, mecánico, ubicación, horómetro…'} />
        </div>
        <div className="form-row" style={{ margin: 0, flex: '1 1 130px' }}>
          <label htmlFor="bit-seg-desde">Desde</label>
          <input id="bit-seg-desde" className="input" type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => set('desde', e.target.value)} />
        </div>
        <div className="form-row" style={{ margin: 0, flex: '1 1 130px' }}>
          <label htmlFor="bit-seg-hasta">Hasta</label>
          <input id="bit-seg-hasta" className="input" type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => set('hasta', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', paddingBottom: '.2rem' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => atajo(29)}>30 días</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => atajo(89)}>90 días</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => atajo(364)}>1 año</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => atajo(null)}>Todo</button>
        </div>
      </div>

      {esComb ? (
        <>
          {!equipo.combustible_equipo && <p className="muted">Esta máquina no está vinculada a Combustible: no hay surtidos que mostrar.</p>}
          {errorSurtidos && <p style={{ color: 'var(--danger)' }}>{errorSurtidos}</p>}
          <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th>Fecha</th><th style={{ textAlign: 'right' }}>Litros</th><th style={{ textAlign: 'right' }}>Horómetro</th>
                <th style={{ textAlign: 'right' }}>Km</th><th>Ubicación</th><th>Autorizó</th>
              </tr></thead>
              <tbody>
                {surtidos == null && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Cargando surtidos…</td></tr>}
                {surtidos != null && !surtidosFiltrados.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Sin surtidos en este rango.</td></tr>}
                {surtidosFiltrados.map((s) => (
                  <tr key={s.id}>
                    <td>{fmtDate(s.fecha)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(s.litros)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{s.horometro_fin != null ? fmtNum(s.horometro_fin) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{s.kilometraje != null ? fmtNum(s.kilometraje) : '—'}</td>
                    <td>{s.ubicacion || '—'}</td>
                    <td>{s.autorizado_por || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '.75rem', margin: '.4rem 0 0' }}>
            {surtidosFiltrados.length} surtido(s) · <strong className="mono">{fmtNum(litros)} L</strong> · vienen de ⛽ Combustible ({equipo.combustible_equipo ?? 'sin vincular'}).
          </p>
        </>
      ) : (
        <>
          <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th>Fecha</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Horómetro</th><th style={{ textAlign: 'right' }}>HRS.</th>
                <th style={{ textAlign: 'right' }}>Aceite</th><th style={{ textAlign: 'right' }}>Gasoil</th><th style={{ textAlign: 'right' }}>Lts/h</th>
                <th>Trabajo / consumibles</th><th>Mecánico</th><th>📷</th>{canWrite && <th></th>}
              </tr></thead>
              <tbody>
                {loading && <tr><td colSpan={columnas} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
                {!loading && !filtradas.length && <tr><td colSpan={columnas} className="muted" style={{ textAlign: 'center' }}>Sin registros en este segmento y rango.</td></tr>}
                {filtradas.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(r)} title="Ver el detalle">
                    <td>{fmtDate(r.fecha)}</td>
                    <td style={{ fontSize: '.76rem' }}>
                      {tiposDe(r).map((t) => <div key={t} style={{ whiteSpace: 'nowrap' }}>{etiquetaTipoMant(t)}</div>)}
                      {!tiposDe(r).length && '—'}
                      {r.pieza && <div className="muted" style={{ fontSize: '.72rem' }}>{r.pieza}</div>}
                      {r.entrega_id && <span className="badge info" style={{ fontSize: '.65rem' }}>📦 Del almacén</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.horas != null ? fmtNum(r.horas) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.aceite_lts != null ? fmtNum(r.aceite_lts) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil_lts != null ? fmtNum(r.gasoil_lts) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{r.consumoLh != null ? fmtNum(r.consumoLh) : '—'}</td>
                    <td style={{ fontSize: '.78rem', maxWidth: 260 }}>
                      {r.trabajo || '—'}
                      {r.consumibles && <div className="muted" style={{ fontSize: '.72rem' }}>{r.consumibles}</div>}
                    </td>
                    <td style={{ fontSize: '.78rem' }}>{r.mecanico || '—'}</td>
                    <td>{r.fotos?.length ? <span className="badge">{r.fotos.length}</span> : <span className="muted">—</span>}</td>
                    {canWrite && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-sm btn-ghost" title="Editar" aria-label={`Editar el registro del ${fmtDate(r.fecha)}`} onClick={() => onEditar(r)}>✎</button>
                        <button type="button" className="btn btn-sm btn-ghost" title="Eliminar" aria-label={`Eliminar el registro del ${fmtDate(r.fecha)}`} style={{ color: 'var(--danger)' }} onClick={() => onBorrar(r.id)}>🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
            {filtradas.length} de {rows.length} registro(s). HRS. = horómetro de este registro − el del anterior. Lts/h = gasoil ÷ HRS. Toca un registro para ver su detalle y fotos.
          </p>
        </>
      )}

      {detalle && <DetalleRegistro r={detalle} equipo={equipo} onClose={() => setDetalle(null)} />}
    </div>
  );
}

/** Vista previa de un registro: todos los datos + fotos del mantenimiento y de la salida del almacén. */
function DetalleRegistro({ r, equipo, onClose }: { r: MantenimientoCalc; equipo: MaquinariaEquipo; onClose: () => void }) {
  const [entrega, setEntrega] = useState<EntregaAlmacen | null>(null);
  useEffect(() => {
    if (!r.entrega_id) return;
    let vivo = true;
    getEntrega(r.entrega_id).then((e) => { if (vivo) setEntrega(e); }).catch(() => { if (vivo) setEntrega(null); });
    return () => { vivo = false; };
  }, [r.entrega_id]);
  const fila = (k: string, v: ReactNode) => (v == null || v === '' ? null : (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 150px) 1fr', gap: '.5rem', padding: '.25rem 0', borderBottom: '1px dashed var(--border)' }}>
      <span className="muted">{k}</span><span>{v}</span>
    </div>
  ));
  const n = (x: number | null | undefined, u = '') => (x == null ? null : `${fmtNum(x)}${u}`);
  return (
    <Modal title={`📒 ${equipo.equipo} · ${fmtDate(r.fecha)}`} size="lg" onClose={onClose}>
      {fila('Tipo', tiposDe(r).map(etiquetaTipoMant).join(' · '))}
      {fila('Pieza', r.pieza)}
      {fila('Horómetro', n(r.horometro))}
      {fila('Horas del período', n(r.horas, ' h'))}
      {fila('Kilometraje', n(r.kilometraje, ' km'))}
      {fila('Aceite', n(r.aceite_lts, ' L'))}
      {fila('Refrigerante', n(r.refrigerante_lts, ' L'))}
      {fila('Gasoil', n(r.gasoil_lts, ' L'))}
      {fila('Consumo', n(r.consumoLh, ' L/h'))}
      {fila('Trabajo', r.trabajo)}
      {fila('Consumibles', r.consumibles)}
      {fila('Mecánico / taller', r.mecanico)}
      {fila('Ubicación', r.ubicacion)}
      {fila('Observación', r.observacion)}
      {fila('Registró', [r.actor_name || r.created_by, r.created_at ? dateTime(r.created_at) : ''].filter(Boolean).join(' · '))}

      {!!r.fotos?.length && (
        <div style={{ marginTop: '.75rem' }}>
          <div style={{ fontWeight: 700, marginBottom: '.3rem' }}>📷 Fotos del mantenimiento</div>
          <FotosMiniatura fotos={r.fotos} etiqueta={`${equipo.equipo} · ${fmtDate(r.fecha)}`} />
        </div>
      )}

      {entrega && (
        <div className="card" style={{ marginTop: '.75rem', background: 'var(--bg-1)' }}>
          <div style={{ fontWeight: 700 }}>📦 Entrega del almacén {entrega.codigo}{entrega.ref_codigo ? ` · ${entrega.ref_codigo}` : ''}</div>
          <div className="muted" style={{ fontSize: '.82rem' }}>
            {entrega.entregado_por_nombre || entrega.entregado_por} · {dateTime(entrega.created_at)}{entrega.almacen ? ` · ${entrega.almacen}` : ''}
          </div>
          <ul style={{ margin: '.4rem 0', paddingLeft: '1.1rem' }}>{entrega.items.map((i, k) => <li key={k}>{lineaItem(i)}</li>)}</ul>
          <FotosSalidaEntrega entrega={entrega} />
        </div>
      )}
    </Modal>
  );
}
