import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { date as fmtDate, num as fmtNum, money } from '@/shared/lib/format';
import { listServiciosDeEquipo, type ServicioDeEquipo } from '@/modules/pedidos/servicios.repository';
import {
  listMantenimientos, addMantenimiento, updateMantenimiento, eliminarMantenimiento, resumenHorometro,
  TIPOS_MANTENIMIENTO, etiquetaTipoMant,
  type MantenimientoCalc,
} from './maquinariaMant.repository';
import { datosCombustibleDeEquipo, type DatosCombustibleEquipo } from './maquinariaEquipos.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

export function BitacoraModal({ equipo, canWrite, actor, actorName, onClose }: {
  equipo: MaquinariaEquipo;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MantenimientoCalc[]>([]);
  const [comb, setComb] = useState<DatosCombustibleEquipo | null>(null);
  const [servicios, setServicios] = useState<ServicioDeEquipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [borrarId, setBorrarId] = useState<string | null>(null);
  // Edición: el mismo formulario precargado con el registro (se vuelve a montar con `formKey`).
  const [editando, setEditando] = useState<MantenimientoCalc | null>(null);
  const [formKey, setFormKey] = useState(0);
  // alta
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState<string>('cambio_aceite');
  const [pieza, setPieza] = useState('');
  const [horometro, setHorometro] = useState('');
  const [kilometraje, setKilometraje] = useState('');
  const [alertaKm, setAlertaKm] = useState('');
  const [aceite, setAceite] = useState('');
  const [refrigerante, setRefrigerante] = useState('');
  const [gasoil, setGasoil] = useState('');
  const [trabajo, setTrabajo] = useState('');
  const [consumibles, setConsumibles] = useState('');
  const [mecanico, setMecanico] = useState('');
  const [ubicacion, setUbicacion] = useState(equipo.ubicacion ?? '');
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [m, c, sv] = await Promise.all([
        listMantenimientos(equipo.id),
        datosCombustibleDeEquipo(equipo.combustible_equipo).catch(() => null),
        listServiciosDeEquipo(equipo.id).catch(() => [] as ServicioDeEquipo[]),
      ]);
      setRows(m); setComb(c); setServicios(sv);
    } finally { setLoading(false); }
  }, [equipo.id, equipo.combustible_equipo]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos', 'combustible_tanque_movimientos', 'ordenes'], () => { void cargar(); });

  const res = useMemo(() => resumenHorometro(rows), [rows]);
  // Mantenimiento preventivo: horas del último período vs frecuencia del equipo.
  const freq = equipo.mantenimiento_cada_hrs;
  const horasUlt = res.horasUltimo ?? 0;
  const alerta = freq != null && freq > 0 && horasUlt >= freq;
  // Horómetro vigente: prioriza el de Combustible (vínculo), si no el de la bitácora.
  const horometroVigente = comb?.horometro ?? res.ultimoHorometro;

  function limpiar() {
    setPieza(''); setHorometro(''); setKilometraje(''); setAlertaKm(''); setAceite(''); setRefrigerante(''); setGasoil(''); setTrabajo(''); setConsumibles(''); setMecanico('');
    setFecha(new Date().toISOString().slice(0, 10)); setTipo('cambio_aceite'); setUbicacion(equipo.ubicacion ?? '');
  }

  function abrirEdicion(r: MantenimientoCalc) {
    const t = (v: number | null) => (v == null ? '' : String(v));
    setFecha(String(r.fecha).slice(0, 10)); setTipo(r.tipo ?? 'otro'); setPieza(r.pieza ?? '');
    setHorometro(t(r.horometro)); setKilometraje(t(r.kilometraje)); setAlertaKm(t(r.alerta_km));
    setAceite(t(r.aceite_lts)); setRefrigerante(t(r.refrigerante_lts)); setGasoil(t(r.gasoil_lts));
    setTrabajo(r.trabajo ?? ''); setConsumibles(r.consumibles ?? ''); setMecanico(r.mecanico ?? ''); setUbicacion(r.ubicacion ?? '');
    setEditando(r); setShowForm(true); setFormKey((k) => k + 1);
  }

  function cerrarForm() {
    setShowForm(false);
    if (editando) { setEditando(null); limpiar(); setFormKey((k) => k + 1); }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const datos = {
        equipo_id: equipo.id, fecha,
        tipo: tipo || null,
        pieza: tipo === 'cambio_pieza' ? (pieza || null) : null,
        horometro: horometro === '' ? null : Number(horometro),
        kilometraje: kilometraje === '' ? null : Number(kilometraje),
        alerta_km: alertaKm === '' ? null : Number(alertaKm),
        aceite_lts: aceite === '' ? null : Number(aceite),
        refrigerante_lts: refrigerante === '' ? null : Number(refrigerante),
        gasoil_lts: gasoil === '' ? null : Number(gasoil),
        trabajo: trabajo || null, consumibles: consumibles || null,
        mecanico: mecanico || null, ubicacion: ubicacion || null,
      };
      if (editando) {
        await updateMantenimiento(editando.id, { ...datos, observacion: editando.observacion });
        toast('Registro actualizado', 'success');
      } else {
        await addMantenimiento(datos, actor, actorName);
        toast('Mantenimiento registrado', 'success');
      }
      setEditando(null);
      limpiar();
      setFormKey((k) => k + 1);
      setShowForm(false);
      await cargar();
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo agregar', 'error'); }
    finally { setSaving(false); }
  }

  async function borrar(id: string) {
    try { await eliminarMantenimiento(id); await cargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const footer = <button className="btn btn-primary" onClick={onClose}>Cerrar</button>;

  return (
    <Modal title={`🔧 Bitácora · ${equipo.equipo}`} size="xl" onClose={onClose} footer={footer}>
      {/* KPIs de horómetro */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>HORÓMETRO VIGENTE{comb?.horometro != null ? ' (⛽)' : ''}</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{horometroVigente != null ? fmtNum(horometroVigente) : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>HRS. ÚLTIMO PERÍODO</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{res.horasUltimo != null ? fmtNum(res.horasUltimo) : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>MANTENIMIENTO CADA</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{freq != null ? `${fmtNum(freq)} h` : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>GASOIL CONSUMIDO (⛽)</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{comb ? `${fmtNum(comb.gasoilLts)} L` : '—'}</div>
        </div>
      </div>

      {alerta && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginBottom: '.75rem', padding: '.55rem .85rem' }}>
          ⚠️ <strong>Mantenimiento preventivo:</strong> el último período acumuló <strong>{fmtNum(horasUlt)} h</strong> y supera la frecuencia de <strong>{fmtNum(freq!)} h</strong>. Conviene programar servicio.
        </div>
      )}

      {/* Vínculo con Solicitudes de Servicio: mantenimientos pedidos/cotizados para este equipo. */}
      {servicios.length > 0 && (
        <div className="card" style={{ margin: '0 0 .75rem', padding: '.6rem .8rem', background: 'var(--bg-1)' }}>
          <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: '.4rem' }}>🔧 Solicitudes de servicio de este equipo <span className="badge" style={{ marginLeft: '.3rem' }}>{servicios.length}</span></div>
          <div style={{ display: 'grid', gap: '.3rem' }}>
            {servicios.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', fontSize: '.8rem', borderTop: '1px dashed var(--border, #334)', paddingTop: '.3rem' }}>
                <span className="mono"><strong>{s.oc_codigo ?? s.codigo}</strong></span>
                <span className="badge">{s.estado}</span>
                <span className="muted">{fmtDate(s.created_at)}</span>
                <span style={{ flex: 1, minWidth: 120 }}>{s.servicios.map((it) => `${it.nombre}${it.cantidad > 1 ? ` ×${it.cantidad}` : ''}`).join(' · ') || '—'}</span>
                {s.total != null && s.total > 0 && <span className="mono">{money(s.total)}</span>}
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: '.7rem', margin: '.4rem 0 0' }}>
            Vienen de <strong>Pedidos → Nuevo servicio</strong> (mantenimiento casado a este equipo). Aquí registras el seguimiento real (litros, filtros, trabajo…) en la bitácora.
          </p>
        </div>
      )}

      {canWrite && (
        <div style={{ marginBottom: '.6rem' }}>
          <button className="btn btn-sm btn-primary" onClick={() => (showForm ? cerrarForm() : setShowForm(true))}>{showForm ? '✕ Cancelar' : '+ Nuevo registro'}</button>
        </div>
      )}

      {showForm && canWrite && (
        <form key={formKey} onSubmit={handleAdd} className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
          {editando && <div className="aviso info sm" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">✎</span><div>Editando el registro del <strong>{fmtDate(editando.fecha)}</strong> ({etiquetaTipoMant(editando.tipo)}). Los cambios quedan en la auditoría.</div></div>}
          <div className="form-grid">
            <div className="form-row">
              <label>Tipo de mantenimiento</label>
              <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPOS_MANTENIMIENTO.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            {tipo === 'cambio_pieza' ? (
              <div className="form-row">
                <label>Pieza cambiada</label>
                <input className="input" name="bit-pieza" placeholder="Ej.: MOTOR, BOMBA HIDRÁULICA, ALTERNADOR…"
                  defaultValue={pieza} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setPieza(e.target.value); }} />
              </div>
            ) : (
              <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            )}
          </div>
          <div className="form-grid">
            {tipo === 'cambio_pieza' && (
              <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            )}
            <div className="form-row"><label>Horómetro (lectura)</label><input className="input mono" name="bit-horometro" type="number" step="any" defaultValue={horometro} onChange={(e) => setHorometro(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Kilometraje (lectura)</label>
              <input className="input mono" name="bit-km" type="number" step="any" defaultValue={kilometraje} onChange={(e) => setKilometraje(e.target.value)} placeholder="Odómetro km" />
            </div>
            <div className="form-row">
              <label>Indique alerta de kilometraje</label>
              <input className="input mono" name="bit-alerta-km" type="number" step="any" defaultValue={alertaKm} onChange={(e) => setAlertaKm(e.target.value)} placeholder="Avisar al llegar a… km" />
              <small className="muted">Al acercarse a este km, el equipo se avisa en Servicio de Mantenimiento.</small>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Aceite (Lts)</label><input className="input mono" name="bit-aceite" type="number" step="any" defaultValue={aceite} onChange={(e) => setAceite(e.target.value)} /></div>
            <div className="form-row"><label>Refrigerante (Lts)</label><input className="input mono" name="bit-refrigerante" type="number" step="any" defaultValue={refrigerante} onChange={(e) => setRefrigerante(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Gasoil (Lts)</label><input className="input mono" name="bit-gasoil" type="number" step="any" defaultValue={gasoil} onChange={(e) => setGasoil(e.target.value)} /></div>
            <div className="form-row"><label>Mecánico / taller</label><input className="input" name="bit-mecanico" defaultValue={mecanico} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setMecanico(e.target.value); }} /></div>
          </div>
          <div className="form-row"><label>Trabajo y/o servicio</label><input className="input" name="bit-trabajo" defaultValue={trabajo} onChange={(e) => setTrabajo(e.target.value)} /></div>
          <div className="form-grid">
            <div className="form-row"><label>Consumibles utilizados</label><input className="input" name="bit-consumibles" defaultValue={consumibles} onChange={(e) => setConsumibles(e.target.value)} /></div>
            <div className="form-row"><label>Ubicación</label><input className="input" name="bit-ubicacion" defaultValue={ubicacion} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setUbicacion(e.target.value); }} /></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : editando ? 'Guardar cambios' : 'Guardar registro'}</button>
          </div>
        </form>
      )}

      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th>Fecha</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Horómetro</th><th style={{ textAlign: 'right' }}>HRS.</th>
            <th style={{ textAlign: 'right' }}>Aceite</th><th style={{ textAlign: 'right' }}>Gasoil</th><th style={{ textAlign: 'right' }}>Lts/h</th>
            <th>Trabajo</th><th>Mecánico</th><th>Ubicación</th>{canWrite && <th></th>}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={canWrite ? 11 : 10} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={canWrite ? 11 : 10} className="muted" style={{ textAlign: 'center' }}>Sin registros.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.fecha)}</td>
                <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>
                  {etiquetaTipoMant(r.tipo)}
                  {r.tipo === 'cambio_pieza' && r.pieza && <div className="muted" style={{ fontSize: '.72rem' }}>{r.pieza}</div>}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horas != null ? fmtNum(r.horas) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.aceite_lts != null ? fmtNum(r.aceite_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil_lts != null ? fmtNum(r.gasoil_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.consumoLh != null ? fmtNum(r.consumoLh) : '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.trabajo || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.mecanico || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.ubicacion || '—'}</td>
                {canWrite && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" title="Editar" aria-label={`Editar el registro del ${fmtDate(r.fecha)}`} onClick={() => abrirEdicion(r)}>✎</button>
                    <button className="btn btn-sm btn-ghost" title="Eliminar" aria-label={`Eliminar el registro del ${fmtDate(r.fecha)}`} style={{ color: 'var(--danger)' }} onClick={() => setBorrarId(r.id)}>🗑</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        HRS. = horómetro de este registro − el del registro anterior. Lts/h = gasoil ÷ HRS. {equipo.combustible_equipo ? `Horómetro y gasoil ⛽ vinculados a Combustible (${equipo.combustible_equipo}).` : 'Equipo sin vincular a Combustible.'}
      </p>

      {borrarId && (
        <ConfirmDialog title="Eliminar registro" message="Se elimina este registro de la bitácora. Si tenía horómetro o km, el contador vigente se recalcula con las demás lecturas. No se puede deshacer." confirmText="Eliminar" danger
          preview={(() => { const r = rows.find((x) => x.id === borrarId); return r ? <VistaPrevia><Dato label="Equipo">{equipo.equipo}</Dato><Dato label="Fecha">{fmtDate(r.fecha)}</Dato><Dato label="Tipo">{etiquetaTipoMant(r.tipo)}</Dato><Dato label="Horómetro">{r.horometro != null ? fmtNum(r.horometro) : undefined}</Dato><Dato label="Trabajo">{r.trabajo ?? undefined}</Dato></VistaPrevia> : null; })()}
          onCancel={() => setBorrarId(null)} onConfirm={() => { const id = borrarId; setBorrarId(null); void borrar(id); }} />
      )}
    </Modal>
  );
}
