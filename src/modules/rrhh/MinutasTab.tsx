import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Minuta } from '@/shared/lib/types';
import { listMinutas, type MinutaConAdjuntos } from './minutas.repository';
import { generarMinutaPdf } from './minutaPdf';
import { tieneAcuerdosVencidos } from './minutaModelo';
import { FILTROS_VACIOS, contarMinutas, filtrarMinutas, recortar, type FiltrosMinutas } from './minutaFiltros';
import { MinutaEditorModal } from './MinutaEditorModal';
import { MinutaDetalleModal } from './MinutaDetalleModal';
import { CargarMinutaModal } from './CargarMinutaModal';
import { verArchivoMinuta } from './minutaCargada.repository';
import { FechaVe } from '@/shared/ui/FechaVe';

/** Minutas de reunión: histórico con filtros. Son de toda la organización, no de una nómina. */
export function MinutasTab({ canWrite, actor }: { canWrite: boolean; actor: string }) {
  const [lista, setLista] = useState<MinutaConAdjuntos[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosMinutas>(FILTROS_VACIOS);
  // undefined = editor cerrado, null = minuta nueva, Minuta = editando esa.
  const [editando, setEditando] = useState<Minuta | null | undefined>(undefined);
  const [viendoId, setViendoId] = useState<string | null>(null);
  // 05-11-2026: cargar minutas ya hechas (PDF o foto).
  const [cargando, setCargando] = useState(false);
  /** Vista previa: la minuta cargada abre su archivo; la del sistema, su PDF. */
  function verPdf(m: MinutaConAdjuntos) {
    const p = m.origen === 'cargada' ? verArchivoMinuta(m) : generarMinutaPdf(m);
    p.catch((e) => toast(e instanceof Error ? e.message : 'No se pudo abrir el PDF', 'error'));
  }

  const recargar = useCallback(async () => {
    try { setLista(await listMinutas()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar las minutas', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['minutas', 'minuta_adjuntos'], () => { void recargar(); });

  // Si otra persona borra la minuta que tengo abierta (detalle o editor), se avisa y se cierra.
  const idsPrevios = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ahora = new Set(lista.map((m) => m.id));
    const borrada = [...idsPrevios.current].some((id) => !ahora.has(id) && (id === viendoId || id === editando?.id));
    idsPrevios.current = ahora;
    if (borrada) {
      toast('Otra persona borró esta minuta', 'error');
      setViendoId(null);
      setEditando(undefined);
    }
  }, [lista]); // eslint-disable-line react-hooks/exhaustive-deps

  const conteos = useMemo(() => contarMinutas(lista), [lista]);
  const visibles = useMemo(() => filtrarMinutas(lista, filtros), [lista, filtros]);
  // Se busca por id para que, si otra persona edita la minuta abierta, el detalle muestre lo nuevo.
  const viendo = viendoId ? lista.find((m) => m.id === viendoId) ?? null : null;
  const hayFiltros = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VACIOS);
  const set = <K extends keyof FiltrosMinutas>(k: K, v: FiltrosMinutas[K]) => setFiltros((f) => ({ ...f, [k]: v }));

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 .75rem', fontSize: '.85rem' }}>
        Las minutas son de toda la organización: no dependen de la empresa / nómina elegida.
      </p>

      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {canWrite && <button type="button" className="btn btn-primary" onClick={() => setEditando(null)}>+ Nueva minuta</button>}
        {canWrite && <button type="button" className="btn" onClick={() => setCargando(true)} title="Subir una minuta que ya existe en papel o PDF">📤 Cargar minuta ya hecha</button>}
        <button type="button" className="btn"
          onClick={() => { generarMinutaPdf(null).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el formato', 'error')); }}>
          🖨 Imprimir formato en blanco
        </button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi"><div className="icon">📝</div><div className="label">Minutas del año</div><div className="value">{conteos.delAnio}</div></div>
        <div className="kpi"><div className="icon">✏️</div><div className="label">En borrador</div><div className="value">{conteos.borradores}</div></div>
        <div className="kpi"><div className="icon">⏳</div><div className="label">Con acuerdos pendientes</div><div className="value">{conteos.pendientes}</div></div>
      </div>

      <div className="card" style={{ padding: '.85rem', marginBottom: '1rem' }}>
        <div className="form-grid">
          <div className="form-row"><label>Desde</label><FechaVe value={filtros.desde} onChange={(v) => set('desde', v)} /></div>
          <div className="form-row"><label>Hasta</label><FechaVe value={filtros.hasta} onChange={(v) => set('hasta', v)} /></div>
          <div className="form-row"><label>N.º de minuta</label><input className="input mono" value={filtros.numero} onChange={(e) => set('numero', e.target.value)} placeholder="MIN-2026-…" /></div>
          <div className="form-row"><label>Tema u objetivo</label><input className="input" value={filtros.tema} onChange={(e) => set('tema', e.target.value)} placeholder="De qué trató…" /></div>
          <div className="form-row"><label>Lugar</label><input className="input" value={filtros.lugar} onChange={(e) => set('lugar', e.target.value)} placeholder="Dónde fue…" /></div>
          <div className="form-row">
            <label>Origen</label>
            <select className="select" value={filtros.origen} onChange={(e) => set('origen', e.target.value as FiltrosMinutas['origen'])}>
              <option value="">Todas</option>
              <option value="sistema">Hechas en el sistema</option>
              <option value="cargada">Cargadas (ya hechas)</option>
            </select>
          </div>
          <div className="form-row">
            <label>Estado</label>
            <select className="select" value={filtros.estado} onChange={(e) => set('estado', e.target.value as FiltrosMinutas['estado'])}>
              <option value="">Todas</option>
              <option value="borrador">Borrador</option>
              <option value="finalizada">Finalizada</option>
            </select>
          </div>
          <div className="form-row"><label>Participante o responsable</label><input className="input" value={filtros.persona} onChange={(e) => set('persona', e.target.value)} placeholder="Nombre…" /></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Buscar por palabra</label><input className="input" value={filtros.palabra} onChange={(e) => set('palabra', e.target.value)} placeholder="🔍 Objetivo, acuerdos, avances…" /></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '.5rem', flexWrap: 'wrap' }}>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={filtros.soloPendientes} onChange={(e) => set('soloPendientes', e.target.checked)} /> Solo con acuerdos pendientes
          </label>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={filtros.conArchivo} onChange={(e) => set('conArchivo', e.target.checked)} /> Solo con archivo adjunto
          </label>
          <span className="muted" style={{ fontSize: '.82rem' }}>{visibles.length} de {lista.length}</span>
          {hayFiltros && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFiltros(FILTROS_VACIOS)}>Limpiar filtros</button>}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>N.º</th><th>Fecha</th><th>Objetivo</th><th>Lugar</th><th style={{ textAlign: 'center' }}>Participantes</th><th style={{ textAlign: 'center' }}>Estado</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !visibles.length && <tr><td colSpan={7}><EmptyState message={hayFiltros ? 'Ninguna minuta coincide con los filtros' : 'Todavía no hay minutas'} icon="📝" /></td></tr>}
            {!loading && visibles.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.numero}</td>
                <td>{date(m.fecha)}</td>
                <td>{recortar(m.objetivo) || <span className="muted">—</span>}{m.tiene_adjuntos && <span title="Tiene adjuntos" style={{ marginLeft: '.4rem' }}>📎</span>}{tieneAcuerdosVencidos(m) && <span title="Tiene acuerdos con fecha de compromiso vencida" aria-label="Acuerdos vencidos" style={{ marginLeft: '.4rem', color: 'var(--warning)' }}>⚠</span>}</td>
                <td>{m.lugar || <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'center' }}>{(m.participantes ?? []).length}</td>
                <td style={{ textAlign: 'center' }}><span className="badge" style={{ color: m.estado === 'borrador' ? 'var(--warning)' : 'var(--success)' }}>{m.estado === 'borrador' ? 'Borrador' : 'Finalizada'}</span>{m.origen === 'cargada' && <span className="badge" style={{ marginLeft: '.3rem' }} title="Minuta ya hecha, cargada con su archivo">📤 Cargada</span>}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-sm btn-ghost" title="Ver el PDF en vista previa" onClick={() => verPdf(m)}>📄 PDF</button>
                  <button type="button" className="btn btn-sm" onClick={() => setViendoId(m.id)}>Ver</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viendo && editando === undefined && (
        <MinutaDetalleModal minuta={viendo} canWrite={canWrite} actor={actor}
          onClose={() => setViendoId(null)}
          onEditar={() => setEditando(viendo)}
          onBorrada={() => { setViendoId(null); void recargar(); }} />
      )}
      {cargando && (
        <CargarMinutaModal actor={actor} onClose={() => setCargando(false)}
          onCargada={() => { setCargando(false); void recargar(); }} />
      )}
      {editando !== undefined && (
        <MinutaEditorModal minuta={editando} actor={actor}
          onClose={() => setEditando(undefined)}
          onGuardada={(m) => { setEditando(undefined); setViendoId(m.id); void recargar(); }} />
      )}
    </div>
  );
}
