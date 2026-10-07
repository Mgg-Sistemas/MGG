/* ============================================================
   MGG · Asignaciones · Catálogo de vehículos (ventana)
   Lista buscable; agregar, editar y borrar con los estilos del sistema.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { crearVehiculo, editarVehiculo, eliminarVehiculo, type Vehiculo, type VehiculoInput } from './vehiculos.repository';
import { TIPOS_VEHICULO, filtrarVehiculos, iconoVehiculo, labelTipoVehiculo, textoVehiculo } from './vehiculos';

export function VehiculosCatalogoModal({ vehiculos, canWrite, actor, onClose, onChanged, onElegir }: {
  vehiculos: Vehiculo[]; canWrite: boolean; actor: string;
  onClose: () => void; onChanged: () => void | Promise<void>;
  /** Si viene, cada fila tiene «Usar» (para elegirlo desde el formulario de asignación). */
  onElegir?: (v: Vehiculo) => void;
}) {
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Vehiculo | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Vehiculo | null>(null);
  const visibles = useMemo(() => filtrarVehiculos(vehiculos, q), [vehiculos, q]);

  async function confirmarBorrar() {
    if (!borrar) return;
    try { await eliminarVehiculo(borrar.id); toast('Vehículo eliminado', 'success'); setBorrar(null); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="🚗 Catálogo de vehículos" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Placa, marca, modelo, color, serial…" style={{ flex: '1 1 240px' }} />
        <span className="muted" style={{ fontSize: '.8rem' }}>{visibles.length} de {vehiculos.length}</span>
        {canWrite && <button className="btn btn-primary" onClick={() => setForm('nuevo')}>＋ Agregar vehículo</button>}
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Vehículo</th><th>Placa</th><th>Color</th><th>Seriales</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5}><EmptyState icon="🚗" message={vehiculos.length ? 'Ningún vehículo coincide' : 'Todavía no hay vehículos en el catálogo'} /></td></tr>}
            {visibles.map((v) => (
              <tr key={v.id} style={{ opacity: v.activo ? 1 : 0.55 }}>
                <td>
                  {iconoVehiculo(v.tipo)} <strong>{[v.marca, v.modelo, v.anio].filter(Boolean).join(' ')}</strong>
                  <div className="muted" style={{ fontSize: '.74rem' }}>{labelTipoVehiculo(v.tipo)}{!v.activo ? ' · inactivo' : ''}{v.notas ? ` · ${v.notas}` : ''}</div>
                </td>
                <td className="mono"><strong>{v.placa}</strong></td>
                <td>{v.color ?? <span className="muted">—</span>}</td>
                <td className="muted mono" style={{ fontSize: '.74rem' }}>
                  {v.serial_carroceria && <div>Carr. {v.serial_carroceria}</div>}
                  {v.serial_motor && <div>Motor {v.serial_motor}</div>}
                  {!v.serial_carroceria && !v.serial_motor && '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {onElegir && v.activo && <button className="btn btn-sm btn-primary" onClick={() => onElegir(v)}>Usar</button>}
                  {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setForm(v)}>✎</button>}
                  {canWrite && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrar(v)}>🗑️</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <VehiculoForm vehiculo={form === 'nuevo' ? null : form} actor={actor}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar vehículo" message={`¿Eliminar ${textoVehiculo(borrar)} del catálogo? Las asignaciones ya cerradas conservan sus datos.`}
          confirmText="Eliminar" danger onConfirm={() => void confirmarBorrar()} onCancel={() => setBorrar(null)} />
      )}
    </Modal>
  );
}

function VehiculoForm({ vehiculo, actor, onClose, onSaved }: { vehiculo: Vehiculo | null; actor: string; onClose: () => void; onSaved: () => void }) {
  const [placa, setPlaca] = useState(vehiculo?.placa ?? '');
  const [tipo, setTipo] = useState(vehiculo?.tipo ?? 'carro');
  const [marca, setMarca] = useState(vehiculo?.marca ?? '');
  const [modelo, setModelo] = useState(vehiculo?.modelo ?? '');
  const [anio, setAnio] = useState(vehiculo?.anio != null ? String(vehiculo.anio) : '');
  const [color, setColor] = useState(vehiculo?.color ?? '');
  const [serialCarroceria, setSerialCarroceria] = useState(vehiculo?.serial_carroceria ?? '');
  const [serialMotor, setSerialMotor] = useState(vehiculo?.serial_motor ?? '');
  const [notas, setNotas] = useState(vehiculo?.notas ?? '');
  const [activo, setActivo] = useState(vehiculo?.activo ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    const input: VehiculoInput = {
      placa, tipo, marca, modelo, anio: anio.trim() === '' ? null : Number(anio), color,
      serial_carroceria: serialCarroceria, serial_motor: serialMotor, notas, activo,
    };
    try {
      if (vehiculo) await editarVehiculo(vehiculo.id, input); else await crearVehiculo(input, actor);
      toast(vehiculo ? 'Vehículo actualizado' : 'Vehículo agregado', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={vehiculo ? `Editar · ${vehiculo.placa}` : 'Agregar vehículo'} size="md" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="vehiculo-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <form id="vehiculo-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="form-row"><label>Placa *</label><input className="input mono" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="AB123CD" autoFocus /></div>
          <div className="form-row"><label>Tipo</label>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_VEHICULO.map((t) => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
            </select></div>
          <div className="form-row"><label>Marca *</label><input className="input" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Toyota, Bera, Ford…" /></div>
          <div className="form-row"><label>Modelo</label><input className="input" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Hilux, SBR, F-350…" /></div>
          <div className="form-row"><label>Año</label><input className="input mono" type="number" min={1950} max={2100} value={anio} onChange={(e) => setAnio(e.target.value)} /></div>
          <div className="form-row"><label>Color</label><input className="input" value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div className="form-row"><label>Serial de carrocería</label><input className="input mono" value={serialCarroceria} onChange={(e) => setSerialCarroceria(e.target.value.toUpperCase())} /></div>
          <div className="form-row"><label>Serial de motor</label><input className="input mono" value={serialMotor} onChange={(e) => setSerialMotor(e.target.value.toUpperCase())} /></div>
        </div>
        <div className="form-row"><label>Notas (opcional)</label><input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Propiedad, póliza, observaciones…" /></div>
        {vehiculo && (
          <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.86rem' }}>
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (se puede asignar)
          </label>
        )}
      </form>
    </Modal>
  );
}
