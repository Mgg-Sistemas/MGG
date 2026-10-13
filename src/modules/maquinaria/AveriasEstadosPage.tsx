import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { date as fmtDate, dateTime } from '@/shared/lib/format';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { ESTADOS_EQUIPO, diasDesde, textoHace, type EstadoEquipo } from './flota';
import { listEventosEstadoTodos, type EventoEstado } from './flota.repository';
import { equiposEnAtencion, filtrarEventos, type FiltroEventos } from './flotaListados';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { AccionConEquipo } from './AccionConEquipo';
import { FlotaNav } from './FlotaNav';
import { EstadoDetalleModal, ChipInforme } from './EstadoDetalleModal';
import { esEventoInforme, resumenEvento, ultimoEventoPorEquipo } from './flotaDetalle';

const etiqueta = (e: string | null | undefined) => (e && ESTADOS_EQUIPO[e as EstadoEquipo] ? ESTADOS_EQUIPO[e as EstadoEquipo].label : e ?? '—');

/**
 * Submódulo «Averías y estados»: los equipos que hoy no están operativos (averiados,
 * en taller, esperando repuestos o instrucciones) y el historial global de cambios de
 * estado con su motivo. «Reportar avería» eligiendo el equipo.
 */
export function AveriasEstadosPage() {
  const { can } = usePermissions();
  const canWrite = can('maquinaria', 'escritura');
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [eventos, setEventos] = useState<EventoEstado[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FiltroEventos>({});
  const [reportar, setReportar] = useState(false);
  // Detalle abierto: por id, para que el tiempo real lo mantenga al día.
  const [detalle, setDetalle] = useState<{ equipoId: string; eventoId: string | null } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [eqs, evs] = await Promise.all([listEquipos(), listEventosEstadoTodos()]);
      setEquipos(eqs);
      setEventos(evs);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_equipos', 'maquinaria_estado_eventos'], () => { void cargar(); });

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const atencion = useMemo(() => equiposEnAtencion(equipos), [equipos]);
  const historial = useMemo(() => filtrarEventos(eventos, porId, f), [eventos, porId, f]);
  const ultimoDe = useMemo(() => ultimoEventoPorEquipo(eventos), [eventos]);
  const detEquipo = detalle ? porId.get(detalle.equipoId) ?? null : null;
  const detEvento = detalle?.eventoId ? eventos.find((x) => x.id === detalle.eventoId) ?? null : null;
  const opcEquipos = useMemo(() => [{ value: '', label: 'Todos los equipos' }, ...[...equipos].sort((a, b) => a.equipo.localeCompare(b.equipo, 'es')).map((e) => ({ value: e.id, label: e.equipo }))], [equipos]);
  const set = (p: Partial<FiltroEventos>) => setF((x) => ({ ...x, ...p }));

  const listadoAtencion = (): ListadoFlota => ({
    titulo: 'EQUIPOS QUE NECESITAN ATENCIÓN', subtitulo: 'Averiados, parados, en taller, esperando repuestos o instrucciones',
    archivo: `equipos-en-atencion-${new Date().toISOString().slice(0, 10)}`,
    encabezados: ['Equipo', 'Tipo', 'Estado', 'Motivo', 'Desde', 'Días', 'Ubicación'],
    anchos: [3.5, 2.6, 2.4, 6, 2, 1.2, 3],
    filas: atencion.map((e) => [e.equipo, e.tipo ?? '', etiqueta(e.estado), e.estado_nota ?? '', e.estado_desde ? fmtDate(e.estado_desde) : '', diasDesde(e.estado_desde) ?? '', e.ubicacion ?? '']),
  });
  const listadoHistorial = (): ListadoFlota => ({
    titulo: 'HISTORIAL DE ESTADOS',
    subtitulo: [f.estado ? `Estado: ${etiqueta(f.estado)}` : 'Todos los estados', f.equipoId ? `Equipo: ${porId.get(f.equipoId)?.equipo}` : '',
      f.desde ? `Desde ${fmtDate(f.desde)}` : '', f.hasta ? `Hasta ${fmtDate(f.hasta)}` : '', f.q ? `Búsqueda: «${f.q}»` : ''].filter(Boolean).join(' · '),
    archivo: `historial-de-estados-${new Date().toISOString().slice(0, 10)}`,
    encabezados: ['Fecha', 'Equipo', 'Antes', 'Después', 'Motivo', 'Falta', 'Nota', 'Registró'],
    anchos: [2.6, 3.2, 2.2, 2.2, 5, 1.6, 3, 2.8],
    filas: historial.map((ev) => [dateTime(ev.created_at), porId.get(ev.equipo_id)?.equipo ?? '—', etiqueta(ev.estado_anterior), etiqueta(ev.estado),
      ev.motivo ?? '', ev.material ?? '', ev.nota ?? '', ev.actor_name || ev.actor || '']),
  });

  async function exportar(l: ListadoFlota, tipo: 'pdf' | 'excel') {
    try { if (tipo === 'pdf') await listadoFlotaPdf(l); else await listadoFlotaExcel(l); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🔴 Averías y estados</h1>
          <p className="flo-sub">{atencion.length} equipo(s) que hoy no están operativos</p>
        </div>
        <div className="actions">
          {canWrite && <button className="btn btn-primary" onClick={() => setReportar(true)}>🔴 Reportar avería</button>}
        </div>
      </div>

      <div className="flo-sec">
        <div className="flo-sec-head">
          <h3>⚠️ Necesitan atención</h3>
          <div className="flo-sec-acc">
            <button className="btn btn-sm btn-ghost" disabled={!atencion.length} onClick={() => void exportar(listadoAtencion(), 'pdf')}>↓ PDF</button>
            <button className="btn btn-sm btn-ghost" disabled={!atencion.length} onClick={() => void exportar(listadoAtencion(), 'excel')}>↓ Excel</button>
          </div>
        </div>
        {loading ? <EmptyState message="Cargando…" /> : atencion.length ? (
          <div className="flo-lista">
            {atencion.map((e) => {
              const st = ESTADOS_EQUIPO[e.estado];
              const dias = diasDesde(e.estado_desde);
              const ult = ultimoDe.get(e.id) ?? null;
              const motivo = e.estado_nota || ult?.motivo || null;
              return (
                <div key={e.id} className="flo-row flo-clic">
                  <button type="button" className="flo-estirar" onClick={() => setDetalle({ equipoId: e.id, eventoId: ult?.id ?? null })}
                    aria-label={`Ver el detalle de ${e.equipo}: ${st.label}${motivo ? `, ${motivo}` : ''}`} />
                  <div className="flo-thumb"><span aria-hidden="true">{st.icon}</span></div>
                  <div className="flo-main">
                    <div className="flo-top"><span className="flo-code">{e.equipo}</span>{e.tipo && <span className="flo-tipo">{e.tipo}</span>}</div>
                    {motivo && <div className={`flo-nota ${e.estado === 'averiada' ? '' : e.estado === 'espera' ? 'wait' : 'warn'}`} title={motivo}>{motivo}</div>}
                    <div className="flo-meta">
                      <span className={`flo-chip tone-${st.tono}`}>{st.icon} {st.label}</span>
                      {e.estado_desde && <span>🕘 {textoHace(dias)}</span>}
                      {e.ubicacion && <span>📍 {e.ubicacion}</span>}
                      {esEventoInforme(ult) && <ChipInforme equipoId={e.id} className="flo-sobre" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState message="Toda la flota está operativa." icon="✅" />}
      </div>

      <div className="flo-sec" style={{ marginTop: '.8rem' }}>
        <div className="flo-sec-head">
          <h3>🕘 Historial de cambios de estado</h3>
          <div className="flo-sec-acc">
            <button className="btn btn-sm btn-ghost" disabled={!historial.length} onClick={() => void exportar(listadoHistorial(), 'pdf')}>↓ PDF</button>
            <button className="btn btn-sm btn-ghost" disabled={!historial.length} onClick={() => void exportar(listadoHistorial(), 'excel')}>↓ Excel</button>
          </div>
        </div>
        <div className="flo-filtros">
          <div className="fila">
            <input className="input flo-buscar" type="search" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="🔍 Buscar equipo, motivo, quién…" aria-label="Buscar" />
            <div className="flo-filtro-equipo"><SearchSelect options={opcEquipos} value={f.equipoId ?? ''} onChange={(v) => set({ equipoId: v || undefined })} placeholder="Equipo…" /></div>
          </div>
          <div className="fila">
            <select className="select" value={f.estado ?? ''} onChange={(e) => set({ estado: e.target.value || undefined })} aria-label="Estado">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS_EQUIPO).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            <label className="flo-fecha">Desde<input className="input" type="date" value={f.desde ?? ''} onChange={(e) => set({ desde: e.target.value || undefined })} /></label>
            <label className="flo-fecha">Hasta<input className="input" type="date" value={f.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || undefined })} /></label>
          </div>
        </div>
        {historial.length ? (
          <ol className="flo-timeline">
            {historial.slice(0, 300).map((ev) => {
              const eq = porId.get(ev.equipo_id);
              const resumen = resumenEvento(ev);
              return (
                <li key={ev.id} className="flo-clic">
                  <button type="button" className="flo-estirar" onClick={() => setDetalle({ equipoId: ev.equipo_id, eventoId: ev.id })}
                    aria-label={`Ver el detalle: ${eq?.equipo ?? 'equipo'}, ${etiqueta(ev.estado_anterior)} a ${etiqueta(ev.estado)}`} />
                  <span>{ESTADOS_EQUIPO[ev.estado]?.icon ?? '•'}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{eq?.equipo ?? 'Equipo'} · {etiqueta(ev.estado_anterior)} → {etiqueta(ev.estado)}</strong>
                    <span className="flo-corta2" title={resumen}>{dateTime(ev.created_at)}{resumen ? ` · ${resumen}` : ''}</span>
                    {esEventoInforme(ev) && <div className="flo-ev-pie"><ChipInforme equipoId={ev.equipo_id} className="flo-sobre" /></div>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>{eventos.length ? 'Ningún cambio con estos filtros.' : 'Todavía no hay cambios de estado registrados (empezaron el 09/10/2026).'}</p>}
        {historial.length > 300 && <p className="muted" style={{ fontSize: '.76rem', margin: '.4rem 0 0' }}>Se muestran los 300 más recientes; el PDF y el Excel llevan los {historial.length}.</p>}
      </div>

      {reportar && <AccionConEquipo accion="averia" equipos={equipos} onClose={() => setReportar(false)} onDone={() => void cargar()} />}
      {detEquipo && (
        <EstadoDetalleModal equipo={detEquipo} evento={detEvento} onClose={() => setDetalle(null)} onCambio={() => void cargar()} />
      )}
    </div>
  );
}
