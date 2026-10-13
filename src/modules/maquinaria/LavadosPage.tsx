import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate, dateTime } from '@/shared/lib/format';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { TIPOS_LAVADO, diasDesde, textoHace } from './flota';
import { listLavadosTodos, eliminarLavado, type LavadoEquipo } from './flota.repository';
import { filtrarLavados, equiposSinLavar, type FiltroLavados } from './flotaListados';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { AccionConEquipo } from './AccionConEquipo';
import { FlotaNav } from './FlotaNav';
import { LavadoModal } from './LavadoModal';

const SIN_LAVAR_VISIBLES = 8;

/**
 * Submódulo «Lavados»: todos los lavados con filtros, los equipos que llevan más días
 * sin lavar y «Registrar lavado» eligiendo el equipo. PDF/Excel del listado.
 */
export function LavadosPage() {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [lavados, setLavados] = useState<LavadoEquipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FiltroLavados>({});
  const [registrar, setRegistrar] = useState<{ equipoId?: string } | null>(null);
  const [borrar, setBorrar] = useState<LavadoEquipo | null>(null);
  const [editar, setEditar] = useState<LavadoEquipo | null>(null);
  const [verTodosSinLavar, setVerTodosSinLavar] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [eqs, lavs] = await Promise.all([listEquipos(), listLavadosTodos()]);
      setEquipos(eqs);
      setLavados(lavs);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_lavados', 'maquinaria_equipos'], () => { void cargar(); });

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const lista = useMemo(() => filtrarLavados(lavados, porId, f), [lavados, porId, f]);
  const sinLavar = useMemo(() => equiposSinLavar(equipos, lavados), [equipos, lavados]);
  const tipos = useMemo(() => [...new Set([...TIPOS_LAVADO.map((t) => t.id), ...lavados.map((l) => l.tipo)])].sort((a, b) => a.localeCompare(b, 'es')), [lavados]);
  const opcEquipos = useMemo(() => [{ value: '', label: 'Todos los equipos' }, ...[...equipos].sort((a, b) => a.equipo.localeCompare(b.equipo, 'es')).map((e) => ({ value: e.id, label: e.equipo }))], [equipos]);
  const set = (p: Partial<FiltroLavados>) => setF((x) => ({ ...x, ...p }));

  const listado = (): ListadoFlota & { numeros: number[] } => ({
    titulo: 'LAVADOS DE LA FLOTA',
    subtitulo: [f.equipoId ? `Equipo: ${porId.get(f.equipoId)?.equipo}` : 'Todos los equipos', f.tipo ? `Tipo: ${f.tipo}` : '',
      f.responsable ? `Responsable: ${f.responsable}` : '', f.desde ? `Desde ${fmtDate(f.desde)}` : '', f.hasta ? `Hasta ${fmtDate(f.hasta)}` : '',
      f.q ? `Búsqueda: «${f.q}»` : ''].filter(Boolean).join(' · '),
    archivo: `lavados-${new Date().toISOString().slice(0, 10)}`,
    encabezados: ['Fecha', 'Equipo', 'Lavado', 'Lo realizó', 'Horómetro (h)', 'Km', 'Nota', 'Registró'],
    anchos: [2.6, 3.4, 2, 3, 1.8, 1.8, 4, 2.8],
    numeros: [4, 5],
    filas: lista.map((l) => [dateTime(l.fecha), porId.get(l.equipo_id)?.equipo ?? '—', l.tipo, l.responsable ?? '', l.horometro, l.kilometraje, l.nota ?? '', l.actor_name || l.actor || '']),
  });

  async function exportar(tipo: 'pdf' | 'excel') {
    try { if (tipo === 'pdf') await listadoFlotaPdf(listado()); else await listadoFlotaExcel(listado()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  const visiblesSinLavar = verTodosSinLavar ? sinLavar : sinLavar.slice(0, SIN_LAVAR_VISIBLES);

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🚿 Lavados</h1>
          <p className="flo-sub">{lavados.length} lavado(s) registrado(s) · {sinLavar.filter((x) => x.dias == null).length} equipo(s) sin ningún lavado</p>
        </div>
        <div className="actions">
          {canWrite && <button className="btn btn-primary" onClick={() => setRegistrar({})}>🚿 Registrar lavado</button>}
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void exportar('pdf')}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void exportar('excel')}>↓ Excel</button>
        </div>
      </div>

      <div className="flo-sec">
        <div className="flo-sec-head"><h3>⏳ Más días sin lavar</h3></div>
        {loading ? <EmptyState message="Cargando…" /> : sinLavar.length ? (
          <div className="flo-hist">
            {visiblesSinLavar.map(({ equipo: e, ultimo, dias }) => (
              <div key={e.id}>
                <span>{dias == null ? '⚪' : dias > 30 ? '🔴' : dias > 15 ? '🟡' : '🟢'}</span>
                <div style={{ minWidth: 0 }}>
                  <strong><Link to={`/app/maquinaria/equipo/${e.id}?tab=lavados`}>{e.equipo}</Link></strong>
                  <small>{ultimo ? `Último lavado ${fmtDate(ultimo)} · ${textoHace(dias)}` : 'Nunca se ha registrado un lavado'}</small>
                </div>
                {canWrite ? <button className="btn btn-sm" onClick={() => setRegistrar({ equipoId: e.id })}>🚿 Lavar</button> : <span />}
              </div>
            ))}
          </div>
        ) : <EmptyState message="No hay equipos." icon="🚜" />}
        {sinLavar.length > SIN_LAVAR_VISIBLES && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: '.4rem' }} onClick={() => setVerTodosSinLavar(!verTodosSinLavar)}>
            {verTodosSinLavar ? 'Ver menos' : `Ver los ${sinLavar.length}`}
          </button>
        )}
      </div>

      <div className="flo-sec" style={{ marginTop: '.8rem' }}>
        <div className="flo-sec-head"><h3>📚 Historial de lavados</h3><span className="muted" style={{ fontSize: '.76rem' }}>{lista.length} con estos filtros</span></div>
        <div className="flo-filtros">
          <div className="fila">
            <input className="input flo-buscar" type="search" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })} placeholder="🔍 Buscar equipo, tipo, nota…" aria-label="Buscar" />
            <div className="flo-filtro-equipo"><SearchSelect options={opcEquipos} value={f.equipoId ?? ''} onChange={(v) => set({ equipoId: v || undefined })} placeholder="Equipo…" /></div>
          </div>
          <div className="fila">
            <select className="select" value={f.tipo ?? ''} onChange={(e) => set({ tipo: e.target.value || undefined })} aria-label="Tipo de lavado">
              <option value="">Todos los tipos</option>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="input" value={f.responsable ?? ''} onChange={(e) => set({ responsable: e.target.value || undefined })} placeholder="Responsable" aria-label="Responsable" />
            <label className="flo-fecha">Desde<input className="input" type="date" value={f.desde ?? ''} onChange={(e) => set({ desde: e.target.value || undefined })} /></label>
            <label className="flo-fecha">Hasta<input className="input" type="date" value={f.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || undefined })} /></label>
          </div>
        </div>
        {lista.length ? (
          <div className="flo-hist">
            {lista.slice(0, 300).map((l) => (
              <div key={l.id}>
                <span>🚿</span>
                <div style={{ minWidth: 0 }}>
                  <strong><Link to={`/app/maquinaria/equipo/${l.equipo_id}?tab=lavados`}>{porId.get(l.equipo_id)?.equipo ?? 'Equipo'}</Link> · {l.tipo}</strong>
                  <small>{dateTime(l.fecha)} · {textoHace(diasDesde(l.fecha))}{l.responsable ? ` · ${l.responsable}` : ''}{l.horometro != null ? ` · ${fmtNum(l.horometro)} h` : ''}{l.kilometraje != null ? ` · ${fmtNum(l.kilometraje)} km` : ''}</small>
                  {l.nota && <small>{l.nota}</small>}
                </div>
                {canWrite ? (
                  <span style={{ display: 'flex', gap: '.25rem' }}>
                    <button className="btn btn-sm btn-ghost" aria-label={`Editar lavado del ${dateTime(l.fecha)}`} onClick={() => setEditar(l)}>✎</button>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} aria-label={`Borrar lavado del ${dateTime(l.fecha)}`} onClick={() => setBorrar(l)}>🗑</button>
                  </span>
                ) : <span />}
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>{lavados.length ? 'Ningún lavado con estos filtros.' : 'Todavía no hay lavados registrados.'}</p>}
        {lista.length > 300 && <p className="muted" style={{ fontSize: '.76rem', margin: '.4rem 0 0' }}>Se muestran los 300 más recientes; el PDF y el Excel llevan los {lista.length}.</p>}
      </div>

      {registrar && <AccionConEquipo accion="lavado" equipos={equipos} equipoInicial={registrar.equipoId} onClose={() => setRegistrar(null)} onDone={() => void cargar()} />}
      {editar && porId.get(editar.equipo_id) && (
        <LavadoModal equipo={porId.get(editar.equipo_id) as MaquinariaEquipo} horometro={null} km={null} ultimo={null} lavado={editar}
          actor={{ email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null }}
          onClose={() => setEditar(null)} onSaved={() => void cargar()} />
      )}
      {borrar && (
        <ConfirmDialog title="Borrar lavado" danger confirmText="Borrar"
          message="Se borra este registro de lavado. No se puede deshacer."
          preview={<VistaPrevia><Dato label="Equipo">{porId.get(borrar.equipo_id)?.equipo}</Dato><Dato label="Lavado">{borrar.tipo}</Dato><Dato label="Fecha">{dateTime(borrar.fecha)}</Dato><Dato label="Lo realizó">{borrar.responsable ?? undefined}</Dato><Dato label="Registró">{borrar.actor_name || borrar.actor || undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrar(null)}
          onConfirm={() => {
            const l = borrar; setBorrar(null);
            void eliminarLavado(l.id).then(() => { toast('Lavado borrado', 'success'); void cargar(); })
              .catch((e) => toast(e instanceof Error ? e.message : 'No se pudo borrar el lavado', 'error'));
          }} />
      )}
    </div>
  );
}
