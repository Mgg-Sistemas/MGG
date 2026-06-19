import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { date as fmtDate, num as fmtNum } from '@/shared/lib/format';
import {
  listMantenimientos, addMantenimiento, eliminarMantenimiento, resumenHorometro,
  type MantenimientoCalc,
} from './maquinariaMant.repository';
import { datosCombustibleDeEquipo, type DatosCombustibleEquipo } from './maquinariaEquipos.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** Tipos de mantenimiento (trazabilidad estructurada). */
const TIPOS_MANT = [
  'Cambio de aceite',
  'Cambio de pieza',
  'Mantenimiento preventivo',
  'Mantenimiento correctivo',
  'Reparación',
  'Inspección',
  'Otro',
];

export function BitacoraModal({ equipo, canWrite, actor, actorName, onClose }: {
  equipo: MaquinariaEquipo;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MantenimientoCalc[]>([]);
  const [comb, setComb] = useState<DatosCombustibleEquipo | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [borrarId, setBorrarId] = useState<string | null>(null);
  // alta
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState('');
  const [pieza, setPieza] = useState('');
  const [horometro, setHorometro] = useState('');
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
      const [m, c] = await Promise.all([
        listMantenimientos(equipo.id),
        datosCombustibleDeEquipo(equipo.combustible_equipo).catch(() => null),
      ]);
      setRows(m); setComb(c);
    } finally { setLoading(false); }
  }, [equipo.id, equipo.combustible_equipo]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos', 'combustible_tanque_movimientos'], () => { void cargar(); });

  const res = useMemo(() => resumenHorometro(rows), [rows]);
  // Mantenimiento preventivo: horas del último período vs frecuencia del equipo.
  const freq = equipo.mantenimiento_cada_hrs;
  const horasUlt = res.horasUltimo ?? 0;
  const alerta = freq != null && freq > 0 && horasUlt >= freq;
  // Horómetro vigente: prioriza el de Combustible (vínculo), si no el de la bitácora.
  const horometroVigente = comb?.horometro ?? res.ultimoHorometro;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (tipo === 'Cambio de pieza' && !pieza.trim()) { toast('Indicá qué pieza se cambió (ej: MOTOR).', 'error'); return; }
    setSaving(true);
    try {
      await addMantenimiento({
        equipo_id: equipo.id, fecha,
        tipo: tipo || null,
        pieza: tipo === 'Cambio de pieza' ? (pieza || null) : (pieza || null),
        horometro: horometro === '' ? null : Number(horometro),
        aceite_lts: aceite === '' ? null : Number(aceite),
        refrigerante_lts: refrigerante === '' ? null : Number(refrigerante),
        gasoil_lts: gasoil === '' ? null : Number(gasoil),
        trabajo: trabajo || null, consumibles: consumibles || null,
        mecanico: mecanico || null, ubicacion: ubicacion || null,
      }, actor, actorName);
      toast('Registro agregado', 'success');
      setTipo(''); setPieza(''); setHorometro(''); setAceite(''); setRefrigerante(''); setGasoil(''); setTrabajo(''); setConsumibles(''); setMecanico('');
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

      {canWrite && (
        <div style={{ marginBottom: '.6rem' }}>
          <button className="btn btn-sm btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? '✕ Cancelar' : '+ Nuevo registro'}</button>
        </div>
      )}

      {showForm && canWrite && (
        <form onSubmit={handleAdd} className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
          <div className="form-grid">
            <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            <div className="form-row"><label>Horómetro (lectura)</label><input className="input mono" name="bit-horometro" type="number" step="any" defaultValue={horometro} onChange={(e) => setHorometro(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Tipo de mantenimiento</label>
              <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">— elegir —</option>
                {TIPOS_MANT.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>{tipo === 'Cambio de pieza' ? 'Pieza cambiada *' : 'Pieza / repuesto'}</label>
              <input className="input" name="bit-pieza" placeholder={tipo === 'Cambio de pieza' ? 'Ej: MOTOR, BOMBA, ALTERNADOR…' : 'Opcional'}
                value={pieza} onChange={(e) => setPieza(e.target.value.toUpperCase())} />
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
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar registro'}</button>
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
                <td style={{ fontSize: '.76rem' }}>
                  {r.tipo ? <span className="badge">{r.tipo}</span> : '—'}
                  {r.pieza ? <div className="muted mono" style={{ fontSize: '.7rem' }}>🔩 {r.pieza}</div> : null}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horas != null ? fmtNum(r.horas) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.aceite_lts != null ? fmtNum(r.aceite_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil_lts != null ? fmtNum(r.gasoil_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.consumoLh != null ? fmtNum(r.consumoLh) : '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.trabajo || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.mecanico || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.ubicacion || '—'}</td>
                {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrarId(r.id)}>🗑</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        HRS. = horómetro de este registro − el del registro anterior. Lts/h = gasoil ÷ HRS. {equipo.combustible_equipo ? `Horómetro y gasoil ⛽ vinculados a Combustible (${equipo.combustible_equipo}).` : 'Equipo sin vincular a Combustible.'}
      </p>

      {borrarId && (
        <ConfirmDialog title="Eliminar registro" message="¿Eliminar este registro de la bitácora?" confirmText="Eliminar" danger
          onCancel={() => setBorrarId(null)} onConfirm={() => { const id = borrarId; setBorrarId(null); void borrar(id); }} />
      )}
    </Modal>
  );
}
