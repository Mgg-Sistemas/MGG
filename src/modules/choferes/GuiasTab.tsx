/* ============================================================
   MGG · Choferes · Guías (PDF) (14-10-2026)
   Lista de guías con filtro por fecha y buscador; cada una se ve en el visor
   del sistema, se descarga o se elimina. Cargar = fecha, número, descripción,
   conductor (opcional), nota y el PDF.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date as fmtDate, dateTime, hoyISO } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { previewArchivo } from '@/shared/lib/reportePreview';
import type { PropsTab } from './ChoferesPage';
import { DATOS_GUIA_VACIOS, filtrarGuias, nombreDescargaGuia, tamanoLegible, validarGuia, validarPdfGuia, type DatosGuia, type Guia } from './guias';
import { actualizarGuia, eliminarGuia, listGuias, registrarGuia, urlDescargaGuia, urlVerGuia } from './guias.repository';
import { NombreUsuario } from '@/shared/ui/NombreUsuario';

export function GuiasTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const [guias, setGuias] = useState<Guia[]>([]);
  const [loading, setLoading] = useState(true);
  const [sinInstalar, setSinInstalar] = useState(false);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [q, setQ] = useState('');
  const [nueva, setNueva] = useState(false);
  const [editar, setEditar] = useState<Guia | null>(null);
  const [borrar, setBorrar] = useState<Guia | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try { setGuias(await listGuias()); setSinInstalar(false); }
    catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (/choferes_guias/.test(m) && /does not exist|schema cache/i.test(m)) setSinInstalar(true);
      else toast(m || 'No se pudieron cargar las guías', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['choferes_guias'], () => { void cargar(true); });

  // Nombre de cada conductor (ficha de RRHH o externo), para la columna y el buscador.
  const nombreConductor = useCallback((id: string | null): string => {
    if (!id) return '';
    const c = datos.conductores.find((x) => x.id === id);
    if (!c) return '';
    if (c.externo) return `${c.nombre ?? ''} ${c.apellido ?? ''}`.trim();
    const p = datos.personal.find((x) => x.id === c.personal_id);
    return p ? `${p.nombre} ${p.apellido}`.trim() : '';
  }, [datos.conductores, datos.personal]);

  const visibles = useMemo(() => filtrarGuias(guias, { desde, hasta, q }, nombreConductor), [guias, desde, hasta, q, nombreConductor]);
  const hayFiltro = Boolean(desde || hasta || q.trim());

  async function ver(g: Guia) {
    setAbriendo(g.id);
    try { previewArchivo(await urlVerGuia(g), nombreDescargaGuia(g)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir la guía', 'error'); }
    finally { setAbriendo(null); }
  }
  async function descargar(g: Guia) {
    try {
      const a = document.createElement('a');
      a.href = await urlDescargaGuia(g); a.download = nombreDescargaGuia(g); a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar la guía', 'error'); }
  }
  async function confirmarBorrar() {
    if (!borrar) return;
    try { await eliminarGuia(borrar); toast('Guía eliminada', 'success'); setBorrar(null); void cargar(true); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const opcionesConductor = useMemo(() => datos.conductores
    .filter((c) => c.activo)
    .map((c) => ({ value: c.id, label: nombreConductor(c.id) || '(sin nombre)' }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es')), [datos.conductores, nombreConductor]);

  if (sinInstalar) {
    return (
      <div className="aviso warning">
        <span className="aviso-icono">⚠</span>
        <div><strong>Las guías todavía no están instaladas en la base de datos.</strong> Hay que ejecutar <code>supabase/sql/choferes-guias.sql</code> en el editor SQL de Supabase y recargar.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <strong>📑 Guías</strong>
        <span className="muted">· {visibles.length}{hayFiltro ? ` de ${guias.length}` : ''} guía(s)</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Cargar guía (PDF)</button>}
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: '.5rem', alignItems: 'end', flexWrap: 'wrap', marginBottom: '.75rem', padding: '.6rem .75rem' }}>
        <label>Desde<input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label style={{ flex: 1, minWidth: 220 }}>Buscar
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número, descripción, conductor, archivo…" />
        </label>
        {hayFiltro && <button className="btn btn-ghost btn-sm" onClick={() => { setDesde(''); setHasta(''); setQ(''); }}>✕ Limpiar</button>}
      </div>

      {loading ? <p className="muted">Cargando…</p> : !visibles.length ? (
        <EmptyState icon="📑" message={guias.length
          ? 'Ninguna guía coincide con el filtro: cambia las fechas o el texto de búsqueda.'
          : 'Todavía no hay guías cargadas. Con «+ Cargar guía (PDF)» se guarda la primera, con su fecha y número.'} />
      ) : (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>N°</th><th>Descripción</th><th>Conductor</th><th>Archivo</th><th>Cargada por</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((g) => (
                <tr key={g.id}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(g.fecha)}</td>
                  <td className="mono">{g.numero || '—'}</td>
                  <td>
                    <div>{g.descripcion}</div>
                    {g.nota && <div className="muted" style={{ fontSize: '.78rem' }}>{g.nota}</div>}
                  </td>
                  <td>{nombreConductor(g.conductor_id) || <span className="muted">—</span>}</td>
                  <td>
                    <button className="btn btn-sm btn-ghost" onClick={() => void ver(g)} disabled={abriendo === g.id} title="Ver en vista previa">
                      📄 {g.filename.length > 28 ? `${g.filename.slice(0, 25)}…` : g.filename}
                    </button>
                    <div className="muted" style={{ fontSize: '.75rem' }}>{tamanoLegible(g.size_bytes)}</div>
                  </td>
                  <td className="muted" style={{ fontSize: '.8rem' }}><NombreUsuario nombre={g.actor_name} correo={g.actor} /><br />{dateTime(g.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => void ver(g)} disabled={abriendo === g.id} title="Vista previa">👁</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void descargar(g)} title="Descargar PDF">⬇</button>
                    {canWrite && <>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditar(g)} title="Corregir datos">✎</button>
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(g)} title="Eliminar">🗑</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(nueva || editar) && (
        <GuiaModal guia={editar} conductores={opcionesConductor} actor={actor} actorName={actorName}
          onClose={() => { setNueva(false); setEditar(null); }}
          onSaved={() => { setNueva(false); setEditar(null); void cargar(true); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar guía" danger confirmText="Sí, eliminar"
          message={`¿Eliminar la guía ${borrar.numero ? `N° ${borrar.numero} ` : ''}del ${fmtDate(borrar.fecha)} (${borrar.descripcion})? Se borra también el PDF.`}
          onConfirm={() => void confirmarBorrar()} onCancel={() => setBorrar(null)} />
      )}
    </div>
  );
}

function GuiaModal({ guia, conductores, actor, actorName, onClose, onSaved }: {
  guia: Guia | null; conductores: { value: string; label: string }[]; actor: string; actorName: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<DatosGuia>(guia
    ? { fecha: guia.fecha, numero: guia.numero ?? '', descripcion: guia.descripcion, conductorId: guia.conductor_id ?? '', nota: guia.nota ?? '' }
    : { ...DATOS_GUIA_VACIOS, fecha: hoyISO() });
  const [file, setFile] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errPdf = guia ? null : validarPdfGuia(file);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    const err = validarGuia(form) ?? (guia ? null : validarPdfGuia(file));
    if (err) { toast(err, 'error'); return; }
    setGuardando(true);
    try {
      if (guia) { await actualizarGuia(guia.id, form); toast('Guía corregida', 'success'); }
      else { await registrarGuia(form, file as File, actor, actorName); toast('Guía cargada', 'success'); }
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title={guia ? '✎ Corregir guía' : '📑 Cargar guía (PDF)'} size="md" onClose={() => !guardando && onClose()}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" form="form-guia" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : guia ? 'Guardar' : 'Cargar guía'}</button>
      </>}>
      <form id="form-guia" onSubmit={(ev) => void guardar(ev)} style={{ display: 'grid', gap: '.6rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
          <label>Fecha de la guía
            <input type="date" className="input" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} required />
          </label>
          <label>N° de guía <span className="muted">(opcional)</span>
            <input className="input mono" value={form.numero} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value.toUpperCase() }))} placeholder="0452" />
          </label>
        </div>
        <label>Descripción
          <input className="input" value={form.descripcion} maxLength={160} autoFocus
            onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Ej.: Traslado de escombros Res. Coral → Parque" />
        </label>
        <label>Conductor <span className="muted">(opcional)</span>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <div style={{ flex: 1 }}>
              <SearchSelect options={conductores} value={form.conductorId} onChange={(v) => setForm((f) => ({ ...f, conductorId: v }))}
                placeholder="Buscar conductor…" emptyText="Sin conductores activos" />
            </div>
            {form.conductorId && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setForm((f) => ({ ...f, conductorId: '' }))}>✕</button>}
          </div>
        </label>
        <label>Nota <span className="muted">(opcional)</span>
          <input className="input" value={form.nota} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, nota: e.target.value }))} />
        </label>
        {!guia && (
          <label>PDF de la guía
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <small className="hint muted">{file ? `${file.name} · ${tamanoLegible(file.size)}${errPdf ? ` · ${errPdf}` : ''}` : 'Solo PDF, hasta 15 MB.'}</small>
          </label>
        )}
        {guia && <small className="hint muted">El PDF ({guia.filename}) queda igual: para cambiarlo, elimina la guía y cárgala de nuevo.</small>}
      </form>
    </Modal>
  );
}
