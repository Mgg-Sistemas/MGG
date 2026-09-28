import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import type { Almacen } from '@/shared/lib/types';
import { listSedes, type AlmacenInput } from './almacenes.repository';

interface AlmacenFormProps {
  almacen?: Almacen | null; // null/undefined => crear
  /** Todos los almacenes (para elegir el padre del subalmacén). */
  almacenes?: Almacen[];
  /** Padre preseleccionado al crear un subalmacén desde un almacén. */
  parentPreset?: string | null;
  /** Sede preseleccionada al crear un almacén dentro de una sede. */
  sedePreset?: string | null;
  onClose: () => void;
  onSubmit: (data: AlmacenInput) => Promise<void>;
}

/** ids del almacén y de toda su descendencia (no pueden ser su propio padre). */
function idsDescendientes(rootId: string, almacenes: Almacen[]): Set<string> {
  const out = new Set<string>([rootId]);
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const a of almacenes) {
      if (a.parent_id && out.has(a.parent_id) && !out.has(a.id)) { out.add(a.id); crecio = true; }
    }
  }
  return out;
}

export function AlmacenForm({ almacen, almacenes = [], parentPreset, sedePreset, onClose, onSubmit }: AlmacenFormProps) {
  const isEdit = !!almacen;
  const [nombre, setNombre] = useState(almacen?.nombre ?? '');
  const [ubicacion, setUbicacion] = useState(almacen?.ubicacion ?? '');
  const [parentId, setParentId] = useState<string>(almacen?.parent_id ?? parentPreset ?? '');
  const [sede, setSede] = useState(almacen?.sede ?? sedePreset ?? '');
  const [nuevaSede, setNuevaSede] = useState(false);
  const [sedes, setSedes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listSedes().then(setSedes).catch(() => setSedes([])); }, []);

  // Padres posibles: cualquier almacén salvo el propio y su descendencia (evita ciclos).
  const opcionesPadre = useMemo(() => {
    const excluidos = almacen ? idsDescendientes(almacen.id, almacenes) : new Set<string>();
    return almacenes
      .filter((a) => !excluidos.has(a.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [almacenes, almacen]);

  // La sede del subalmacén la hereda del padre (no se edita acá).
  const padreSel = almacenes.find((a) => a.id === parentId) ?? null;
  const sedeHeredada = padreSel?.sede ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) {
      setError('El nombre del almacén es obligatorio.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ nombre: nombre.trim(), ubicacion: ubicacion.trim() || null, sede: sede.trim() || null, parent_id: parentId || null });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el almacén.');
    } finally {
      setSaving(false);
    }
  }

  const esSub = !!parentId;
  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
        Cancelar
      </button>
      <button type="submit" form="almacen-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : esSub ? 'Crear subalmacén' : 'Crear almacén'}
      </button>
    </>
  );

  return (
    <Modal title={isEdit ? 'Editar almacén' : esSub ? 'Nuevo subalmacén' : 'Nuevo almacén'} onClose={onClose} footer={footer}>
      <form id="almacen-form" onSubmit={handleSubmit}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}
        <div className="form-row">
          <label>Almacén padre</label>
          <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— Ninguno (almacén principal) —</option>
            {opcionesPadre.map((a) => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>
          <small className="hint muted">Si elegís un padre, este será un <strong>subalmacén</strong> (un almacén dentro de otro).</small>
        </div>
        {parentId ? (
          <div className="form-row">
            <label>Sede</label>
            <div className="muted" style={{ fontSize: '.85rem' }}>
              Hereda la sede del almacén padre{sedeHeredada ? <>: <strong>{sedeHeredada}</strong></> : ''}.
            </div>
          </div>
        ) : (
          <div className="form-row">
            <label>Sede</label>
            {nuevaSede ? (
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <input className="input" value={sede} onChange={(e) => setSede(e.target.value.toUpperCase())}
                  placeholder="Ej: MATANZAS, LOS PINOS…" autoFocus style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNuevaSede(false); setSede(''); }}>Elegir existente</button>
              </div>
            ) : (
              <select className="select" value={sede}
                onChange={(e) => { if (e.target.value === '__new__') { setNuevaSede(true); setSede(''); } else setSede(e.target.value); }}>
                <option value="">— Sin sede —</option>
                {sedes.map((s) => <option key={s} value={s}>{s}</option>)}
                <option value="__new__">+ Nueva sede…</option>
              </select>
            )}
            <small className="hint muted">Agrupa el almacén bajo una sede en la vista (Matanzas, Los Pinos…).</small>
          </div>
        )}
        <div className="form-row">
          <label>Nombre del almacén</label>
          <input
            className="input"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={esSub ? 'Ej: Estante A, Sección 1…' : 'Ej: Almacén 1, Galpón A…'}
            required
            autoFocus
          />
        </div>
        <div className="form-row">
          <label>Ubicación</label>
          <input
            className="input"
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            placeholder="Ej: Galpón A · Planta 2 · Sede principal…"
          />
        </div>
      </form>
    </Modal>
  );
}
