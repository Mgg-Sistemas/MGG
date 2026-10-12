/* ============================================================
   MGG · Choferes / Conductores · Expediente y flota

   Un conductor es una ficha de RRHH a la que se le abre expediente: grado y
   número de licencia, vencimientos de licencia, certificado médico y seguro,
   y la tarifa base por viaje. Cada vencimiento se pinta: vigente, por vencer
   (≤ 30 días) o vencido.

   La flota es el catálogo de vehículos compartido con Asignaciones, con
   estado operativo (operativo / taller / inactivo), seguro y capacidad.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { FechaVe } from '@/shared/ui/FechaVe';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate } from '@/shared/lib/format';
import type { Personal } from '@/shared/lib/types';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import { crearVehiculo, editarVehiculo, type VehiculoInput } from '@/modules/asignaciones/vehiculos.repository';
import { filtrarVehiculos, normalizarPlaca } from '@/modules/asignaciones/vehiculos';
import {
  ESTADO_CHOFER, ESTADO_FLOTA, TIPOS_FLOTA, estadoChofer, estadoVence, iconoFlota, labelTipoFlota,
  peorEstadoDocumentos, textoEstadoVence, type EstadoFlota, type EstadoVence,
} from './choferes';
import {
  crearConductor, editarConductor, esCargoDeChofer, importarConductoresDesdeRrhh, setConductorActivo,
  type Conductor, type ConductorInput, type VehiculoFlota,
} from './choferes.repository';
import { nombreConductor, type PropsTab } from './ChoferesPage';

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function BadgeVence({ vence, hoy }: { vence: string | null | undefined; hoy: string }) {
  const e: EstadoVence = estadoVence(vence, hoy);
  const clase = e === 'vencido' ? 'danger' : e === 'por_vencer' ? 'warning' : e === 'vigente' ? 'success' : '';
  return (
    <span title={textoEstadoVence(e, vence, hoy)} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: '.8rem' }}>{vence ? fmtDate(vence) : '—'}</span>
      <span className={`badge ${clase}`} style={{ fontSize: '.68rem' }}>{textoEstadoVence(e, vence, hoy)}</span>
    </span>
  );
}

export function ExpedienteTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, personal, flota, viajes, descansos, hoy, loading, recargar } = datos;
  const [texto, setTexto] = useState('');
  const [soloAlertas, setSoloAlertas] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);
  const [form, setForm] = useState<Conductor | 'nuevo' | null>(null);
  const [verFlota, setVerFlota] = useState(false);
  const [importando, setImportando] = useState(false);
  const [cambiarEstado, setCambiarEstado] = useState<Conductor | null>(null);

  const enRutaIds = useMemo(() => new Set(viajes.filter((v) => v.estado === 'en_ruta').map((v) => v.chofer_id)), [viajes]);
  const descansoHoy = useMemo(() => new Set(descansos.filter((d) => d.desde <= hoy && hoy <= d.hasta).map((d) => d.personal_id)), [descansos, hoy]);

  const filas = useMemo(() => {
    const t = normal(texto.trim());
    return conductores
      .filter((c) => verInactivos || c.activo)
      .filter((c) => !soloAlertas || ['vencido', 'por_vencer'].includes(peorEstadoDocumentos(c, hoy)))
      .filter((c) => !t || normal(`${nombreConductor(c)} ${c.personal?.cedula ?? ''} ${c.personal?.numero_ficha ?? ''} ${c.licencia_numero ?? ''} ${c.licencia_grado ?? ''}`).includes(t))
      .sort((a, b) => nombreConductor(a).localeCompare(nombreConductor(b), 'es'));
  }, [conductores, texto, soloAlertas, verInactivos, hoy]);

  const candidatosRrhh = useMemo(() => {
    const ya = new Set(conductores.map((c) => c.personal_id));
    return personal.filter((p) => p.activo && esCargoDeChofer(p) && !ya.has(p.id));
  }, [personal, conductores]);

  async function importar() {
    setImportando(true);
    try {
      const n = await importarConductoresDesdeRrhh(personal, conductores, actor, actorName);
      toast(n ? `${n} conductor(es) traídos de RRHH. Completa licencia, certificado médico y seguro.` : 'No hay conductores nuevos en RRHH.', n ? 'success' : 'info');
      await recargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo importar', 'error'); }
    finally { setImportando(false); }
  }

  async function confirmarEstado() {
    const c = cambiarEstado; setCambiarEstado(null);
    if (!c) return;
    try { await setConductorActivo(c.id, !c.activo); toast(c.activo ? 'Conductor desactivado' : 'Conductor reactivado', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }

  return (
    <div>
      <div className="desc-barra">
        <input className="input desc-buscar" placeholder="🔍 Buscar por nombre, cédula, ficha, licencia…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloAlertas} onChange={(e) => setSoloAlertas(e.target.checked)} /> Solo con alertas
        </label>
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver inactivos
        </label>
        <div className="desc-acciones">
          <span className="chip">🪪 {conductores.filter((c) => c.activo).length} activos</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setVerFlota(true)}>🚚 Flota ({flota.filter((v) => v.activo).length})</button>
          {canWrite && candidatosRrhh.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => void importar()} disabled={importando}
              title={`Abre expediente a: ${candidatosRrhh.map((p) => p.nombre).join(', ')}`}>
              {importando ? 'Trayendo…' : `👥 Traer ${candidatosRrhh.length} de RRHH`}
            </button>
          )}
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setForm('nuevo')}>+ Conductor</button>}
        </div>
      </div>

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !conductores.length ? (
          <EmptyState icon="🪪" message={candidatosRrhh.length
            ? `Todavía no hay expedientes. RRHH tiene ${candidatosRrhh.length} ficha(s) con cargo de conductor: usa «Traer de RRHH» o «+ Conductor».`
            : 'Todavía no hay expedientes. Usa «+ Conductor» para abrirle expediente a una ficha de RRHH.'} />
        ) : !filas.length ? <EmptyState icon="🔍" message="Nadie coincide con el filtro." />
        : (
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th>Conductor</th><th>Cédula · ficha</th><th>Licencia</th><th>Certificado médico</th><th>Seguro</th>
                  <th style={{ textAlign: 'right' }}>Tarifa / viaje</th><th>Hoy</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => {
                  const e = ESTADO_CHOFER[estadoChofer({ activo: c.activo, enRuta: enRutaIds.has(c.id), deDescanso: descansoHoy.has(c.personal_id) })];
                  return (
                    <tr key={c.id} style={{ opacity: c.activo ? 1 : .6 }}>
                      <td>
                        <strong>{nombreConductor(c)}</strong>
                        <div className="muted" style={{ fontSize: '.75rem' }}>{[c.personal?.cargo, c.personal?.telefono].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="mono" style={{ fontSize: '.8rem' }}>{c.personal?.cedula ?? '—'}<div className="muted">{numeroFicha(c.personal?.numero_ficha)}</div></td>
                      <td>
                        <div style={{ fontSize: '.8rem' }}>{[c.licencia_grado, c.licencia_numero].filter(Boolean).join(' · ') || <span className="muted">Sin datos</span>}</div>
                        <BadgeVence vence={c.licencia_vence} hoy={hoy} />
                      </td>
                      <td><BadgeVence vence={c.certificado_medico_vence} hoy={hoy} /></td>
                      <td><BadgeVence vence={c.seguro_vence} hoy={hoy} /></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(c.tarifa_viaje_usd)}</td>
                      <td><span className={`badge ${e.clase}`}>{e.icon} {e.label}</span></td>
                      <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setForm(c)} title={canWrite ? 'Editar expediente' : 'Ver expediente'}>{canWrite ? '✎' : '👁'}</button>
                        {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setCambiarEstado(c)} title={c.activo ? 'Desactivar' : 'Reactivar'}>{c.activo ? '⛔' : '♻'}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <div className="desc-leyenda muted">
        <span><span className="badge success" style={{ fontSize: '.65rem' }}>Vigente</span></span>
        <span><span className="badge warning" style={{ fontSize: '.65rem' }}>Por vencer</span> ≤ 30 días</span>
        <span><span className="badge danger" style={{ fontSize: '.65rem' }}>Vencido</span></span>
        <span>El conductor no puede salir con un documento vencido: la orden de ruta lo avisa.</span>
      </div>

      {form && (
        <ConductorModal inicial={form === 'nuevo' ? null : form} personal={personal} conductores={conductores} canWrite={canWrite}
          actor={actor} actorName={actorName} hoy={hoy} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await recargar(); }} />
      )}
      {verFlota && <FlotaModal flota={flota} canWrite={canWrite} actor={actor} hoy={hoy} onClose={() => setVerFlota(false)} onChanged={recargar} />}
      {cambiarEstado && (
        <ConfirmDialog title={cambiarEstado.activo ? 'Desactivar conductor' : 'Reactivar conductor'} danger={cambiarEstado.activo} confirmText={cambiarEstado.activo ? 'Sí, desactivar' : 'Sí, reactivar'}
          message={cambiarEstado.activo
            ? `${nombreConductor(cambiarEstado)} deja de aparecer para nuevas rutas y pagos. Su histórico se conserva.`
            : `${nombreConductor(cambiarEstado)} vuelve a estar disponible para rutas.`}
          onConfirm={() => { void confirmarEstado(); }} onCancel={() => setCambiarEstado(null)} />
      )}
    </div>
  );
}

/* ───────── Nuevo / editar expediente ───────── */
function ConductorModal({ inicial, personal, conductores, canWrite, actor, actorName, hoy, onClose, onSaved }: {
  inicial: Conductor | null; personal: Personal[]; conductores: Conductor[]; canWrite: boolean;
  actor: string; actorName: string | null; hoy: string; onClose: () => void; onSaved: () => void;
}) {
  const [personalId, setPersonalId] = useState(inicial?.personal_id ?? '');
  const [v, setV] = useState<Omit<ConductorInput, 'personal_id'>>({
    licencia_grado: inicial?.licencia_grado ?? '', licencia_numero: inicial?.licencia_numero ?? '',
    licencia_vence: inicial?.licencia_vence ?? '', certificado_medico_vence: inicial?.certificado_medico_vence ?? '',
    seguro_vence: inicial?.seguro_vence ?? '', tarifa_viaje_usd: inicial?.tarifa_viaje_usd ?? 0, observaciones: inicial?.observaciones ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yaTienen = useMemo(() => new Set(conductores.map((c) => c.personal_id)), [conductores]);
  const opciones = useMemo(() => personal.filter((p) => p.activo && !yaTienen.has(p.id))
    .sort((a, b) => Number(esCargoDeChofer(b)) - Number(esCargoDeChofer(a)) || a.nombre.localeCompare(b.nombre, 'es'))
    .map((p) => ({ value: p.id, label: `${p.nombre} ${p.apellido ?? ''}`.trim(), hint: [p.cedula, p.cargo].filter(Boolean).join(' · ') })), [personal, yaTienen]);

  const persona = inicial?.personal ?? personal.find((p) => p.id === personalId) ?? null;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!inicial && !personalId) { setError('Elige la ficha del trabajador.'); return; }
    setSaving(true);
    try {
      if (inicial) await editarConductor(inicial.id, v);
      else await crearConductor({ personal_id: personalId, ...v }, actor, actorName);
      toast(inicial ? 'Expediente guardado' : 'Expediente abierto', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  const campoFecha = (k: 'licencia_vence' | 'certificado_medico_vence' | 'seguro_vence', label: string) => (
    <div className="form-row">
      <label htmlFor={`cond-${k}`}>{label} · vence</label>
      <FechaVe id={`cond-${k}`} value={v[k] ?? ''} onChange={(iso) => set(k, iso)} disabled={!canWrite}
        ayuda={v[k] ? <BadgeVence vence={v[k]} hoy={hoy} /> : null} />
    </div>
  );

  return (
    <Modal title={inicial ? `🪪 Expediente · ${nombreConductor(inicial)}` : '🪪 Nuevo conductor'} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{canWrite ? 'Cancelar' : 'Cerrar'}</button>
        {canWrite && <button type="submit" form="cond-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>}
      </>
    }>
      <form id="cond-form" onSubmit={guardar}>
        {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <div className="form-grid">
          <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cond-persona">Trabajador (ficha de RRHH)</label>
            {inicial
              ? <strong>{nombreConductor(inicial)}{persona?.cedula ? ` · ${persona.cedula}` : ''}{persona?.cargo ? ` · ${persona.cargo}` : ''}</strong>
              : <SearchSelect id="cond-persona" value={personalId} onChange={setPersonalId} options={opciones} placeholder="🔍 Buscar por nombre, cédula o cargo…" />}
            {!inicial && <span className="muted" style={{ fontSize: '.78rem' }}>Primero salen las fichas con cargo de conductor. Si la persona no está, créala antes en RRHH → Personal.</span>}
          </div>
          <div className="form-row"><label htmlFor="cond-grado">Grado de licencia</label>
            <select id="cond-grado" className="select" value={v.licencia_grado ?? ''} disabled={!canWrite} onChange={(e) => set('licencia_grado', e.target.value)}>
              <option value="">—</option>
              {['2DA', '3RA', '4TA', '5TA', 'TITULO V'].map((g) => <option key={g} value={g}>{g}</option>)}
            </select></div>
          <div className="form-row"><label htmlFor="cond-num">N° de licencia</label>
            <input id="cond-num" className="input" value={v.licencia_numero ?? ''} disabled={!canWrite} onChange={(e) => set('licencia_numero', e.target.value)} placeholder="Número que aparece en la licencia" /></div>
          {campoFecha('licencia_vence', 'Licencia')}
          {campoFecha('certificado_medico_vence', 'Certificado médico')}
          {campoFecha('seguro_vence', 'Seguro')}
          <div className="form-row"><label>Tarifa base por viaje ($)</label>
            <DecimalInput className="input" value={v.tarifa_viaje_usd ?? 0} disabled={!canWrite} onChange={(n) => set('tarifa_viaje_usd', n ?? 0)} placeholder="0,00" aria-label="Tarifa base por viaje en dólares" />
            <span className="muted" style={{ fontSize: '.75rem' }}>Se propone al crear cada orden de ruta; ahí se puede cambiar.</span></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="cond-obs">Observaciones</label>
            <input id="cond-obs" className="input" value={v.observaciones ?? ''} disabled={!canWrite} onChange={(e) => set('observaciones', e.target.value)} placeholder="Restricciones, tipo de vehículo que maneja, etc." /></div>
        </div>
        {inicial && <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>Expediente abierto {fmtDate(inicial.created_at)}{inicial.actor_name ? ` por ${inicial.actor_name}` : ''}. Los datos de la persona (teléfono, cédula, foto) se editan en RRHH.</p>}
      </form>
    </Modal>
  );
}

/* ───────── Flota ───────── */
export function FlotaModal({ flota, canWrite, actor, hoy, onClose, onChanged, onElegir }: {
  flota: VehiculoFlota[]; canWrite: boolean; actor: string; hoy: string;
  onClose: () => void; onChanged: () => void | Promise<void>;
  onElegir?: (v: VehiculoFlota) => void;
}) {
  const [q, setQ] = useState('');
  const [form, setForm] = useState<VehiculoFlota | 'nuevo' | null>(null);
  const visibles = useMemo(() => filtrarVehiculos(flota, q), [flota, q]);

  return (
    <Modal title="🚚 Flota de vehículos" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Placa, marca, modelo, tipo…" style={{ flex: '1 1 240px' }} />
        <span className="muted" style={{ fontSize: '.8rem' }}>{visibles.length} de {flota.length} · compartida con Asignaciones</span>
        {canWrite && <button className="btn btn-primary" onClick={() => setForm('nuevo')}>＋ Agregar vehículo</button>}
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Vehículo</th><th>Placa</th><th>Tipo</th><th>Capacidad</th><th>Seguro</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={7}><EmptyState icon="🚚" message={flota.length ? 'Ningún vehículo coincide' : 'Todavía no hay vehículos en la flota'} /></td></tr>}
            {visibles.map((v) => {
              const ef = ESTADO_FLOTA[(v.estado_flota ?? 'operativo') as EstadoFlota];
              return (
                <tr key={v.id} style={{ opacity: v.activo ? 1 : .55 }}>
                  <td>{iconoFlota(v.tipo)} <strong>{[v.marca, v.modelo].filter(Boolean).join(' ') || labelTipoFlota(v.tipo)}</strong>{v.anio ? ` ${v.anio}` : ''}{v.color ? <span className="muted"> · {v.color}</span> : null}</td>
                  <td className="mono">{v.placa}</td>
                  <td>{labelTipoFlota(v.tipo)}</td>
                  <td>{v.capacidad ?? '—'}</td>
                  <td><BadgeVence vence={v.seguro_vence} hoy={hoy} /></td>
                  <td><span className={`badge ${ef.clase}`}>{ef.icon} {ef.label}</span>{!v.activo && <span className="badge" style={{ marginLeft: 4 }}>Dado de baja</span>}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                    {onElegir && v.activo && <button className="btn btn-sm btn-primary" onClick={() => onElegir(v)}>Usar</button>}
                    {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setForm(v)} title="Editar">✎</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {form && <VehiculoFormModal inicial={form === 'nuevo' ? null : form} actor={actor} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await onChanged(); }} />}
    </Modal>
  );
}

function VehiculoFormModal({ inicial, actor, onClose, onSaved }: { inicial: VehiculoFlota | null; actor: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<VehiculoInput>({
    placa: inicial?.placa ?? '', tipo: inicial?.tipo ?? 'camion', marca: inicial?.marca ?? '', modelo: inicial?.modelo ?? '',
    anio: inicial?.anio ?? null, color: inicial?.color ?? '', serial_carroceria: inicial?.serial_carroceria ?? '', serial_motor: inicial?.serial_motor ?? '',
    notas: inicial?.notas ?? '', activo: inicial?.activo ?? true,
    estado_flota: (inicial?.estado_flota ?? 'operativo') as EstadoFlota, seguro_vence: inicial?.seguro_vence ?? '', capacidad: inicial?.capacidad ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof VehiculoInput>(k: K, val: VehiculoInput[K]) => setV((x) => ({ ...x, [k]: val }));

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    try {
      if (inicial) await editarVehiculo(inicial.id, v); else await crearVehiculo(v, actor);
      toast(inicial ? 'Vehículo guardado' : `Vehículo ${normalizarPlaca(v.placa)} agregado`, 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={inicial ? `🚚 ${inicial.placa}` : '🚚 Nuevo vehículo'} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="veh-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      <form id="veh-form" onSubmit={guardar}>
        {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <div className="form-grid">
          <div className="form-row"><label htmlFor="veh-placa">Placa</label>
            <input id="veh-placa" className="input mono" value={v.placa} onChange={(e) => set('placa', e.target.value.toUpperCase())} required placeholder="A12BC3D" /></div>
          <div className="form-row"><label htmlFor="veh-tipo">Tipo</label>
            <select id="veh-tipo" className="select" value={v.tipo ?? 'camion'} onChange={(e) => set('tipo', e.target.value)}>
              {TIPOS_FLOTA.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
            </select></div>
          <div className="form-row"><label htmlFor="veh-marca">Marca</label><input id="veh-marca" className="input" value={v.marca ?? ''} onChange={(e) => set('marca', e.target.value)} placeholder="IVECO" /></div>
          <div className="form-row"><label htmlFor="veh-modelo">Modelo</label><input id="veh-modelo" className="input" value={v.modelo ?? ''} onChange={(e) => set('modelo', e.target.value)} placeholder="TRAKKER 420" /></div>
          <div className="form-row"><label htmlFor="veh-anio">Año</label>
            <input id="veh-anio" className="input" type="number" min={1950} max={2100} value={v.anio ?? ''} onChange={(e) => set('anio', e.target.value ? Number(e.target.value) : null)} /></div>
          <div className="form-row"><label htmlFor="veh-color">Color</label><input id="veh-color" className="input" value={v.color ?? ''} onChange={(e) => set('color', e.target.value)} /></div>
          <div className="form-row"><label htmlFor="veh-cap">Capacidad</label><input id="veh-cap" className="input" value={v.capacidad ?? ''} onChange={(e) => set('capacidad', e.target.value)} placeholder="30 t · 12 m³ · 15 pasajeros" /></div>
          <div className="form-row"><label htmlFor="veh-estado">Estado</label>
            <select id="veh-estado" className="select" value={v.estado_flota ?? 'operativo'} onChange={(e) => set('estado_flota', e.target.value as EstadoFlota)}>
              {Object.entries(ESTADO_FLOTA).map(([k, x]) => <option key={k} value={k}>{x.icon} {x.label}</option>)}
            </select></div>
          <div className="form-row"><label htmlFor="veh-seguro">Seguro / RCV · vence</label>
            <FechaVe id="veh-seguro" value={v.seguro_vence ?? ''} onChange={(iso) => set('seguro_vence', iso)} /></div>
          <div className="form-row"><label htmlFor="veh-sc">Serial de carrocería</label><input id="veh-sc" className="input mono" value={v.serial_carroceria ?? ''} onChange={(e) => set('serial_carroceria', e.target.value)} /></div>
          <div className="form-row"><label htmlFor="veh-sm">Serial de motor</label><input id="veh-sm" className="input mono" value={v.serial_motor ?? ''} onChange={(e) => set('serial_motor', e.target.value)} /></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="veh-notas">Notas</label><input id="veh-notas" className="input" value={v.notas ?? ''} onChange={(e) => set('notas', e.target.value)} /></div>
          {inicial && (
            <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', gridColumn: '1 / -1' }}>
              <input type="checkbox" checked={v.activo ?? true} onChange={(e) => set('activo', e.target.checked)} /> En el catálogo (desmarca para darlo de baja sin borrarlo)
            </label>
          )}
        </div>
      </form>
    </Modal>
  );
}
