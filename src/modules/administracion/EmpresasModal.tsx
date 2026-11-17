/* ============================================================
   Golden Touch · Administración · gestionar EMPRESAS (lista propia del módulo)
   Alta / edición / baja de las empresas de Administración (admin_empresas),
   separada de RRHH. «Eliminar» = DESACTIVAR si la empresa tiene gastos
   asociados (no se pierde el histórico); si no tiene, se puede borrar.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import type { Moneda } from './administracionCalculo';
import type { AdminRepo, Empresa, EmpresaInput } from './admin.repository';

interface Draft { id: string | null; clave: string; nombre: string; rif: string; moneda: '' | Moneda; activa: boolean; }
const VACIO: Draft = { id: null, clave: '', nombre: '', rif: '', moneda: '', activa: true };

export function EmpresasModal({ repo, onClose, onChanged }: {
  repo: AdminRepo;
  onClose: () => void;
  /** Se llama tras cada cambio, para que la cabecera recargue su selector. */
  onChanged: () => void;
}) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [d, setD] = useState<Draft>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [aEliminar, setAEliminar] = useState<Empresa | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setEmpresas(await repo.listEmpresas()); }
    catch (e) { toast(`No se pudieron leer las empresas: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setCargando(false); }
  }, [repo]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    const clave = d.clave.trim().toUpperCase();
    const nombre = d.nombre.trim();
    if (!/^[A-Z0-9]{2,8}$/.test(clave)) { toast('La clave es de 2 a 8 letras o números (p. ej. GT).', 'warning', { silent: true }); return; }
    if (!nombre) { toast('El nombre / razón social es obligatorio.', 'warning', { silent: true }); return; }
    if (empresas.some((e) => e.clave === clave && e.id !== d.id)) { toast(`Ya existe una empresa con la clave «${clave}».`, 'warning', { silent: true }); return; }
    const entrada: EmpresaInput = {
      clave, nombre, rif: d.rif.trim() || null, moneda: d.moneda || null, logoPath: null,
      activa: d.activa, orden: d.id ? (empresas.find((e) => e.id === d.id)?.orden ?? 0) : (empresas.length + 1),
    };
    setGuardando(true);
    try {
      if (d.id) await repo.editarEmpresa(d.id, entrada);
      else await repo.crearEmpresa(entrada);
      toast(d.id ? 'Empresa actualizada.' : 'Empresa creada.', 'success');
      setD(VACIO);
      await cargar();
      onChanged();
    } catch (e) {
      toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function confirmarEliminar(e: Empresa) {
    setAEliminar(null);
    try {
      const n = await repo.contarGastosDeEmpresa(e.clave);
      if (n > 0) {
        await repo.desactivarEmpresa(e.id);
        toast(`«${e.nombre}» tiene ${n} gasto(s): se desactivó en lugar de borrarla (se guarda el histórico).`, 'info');
      } else {
        await repo.borrarEmpresa(e.id);
        toast('Empresa eliminada.', 'success');
      }
      if (d.id === e.id) setD(VACIO);
      await cargar();
      onChanged();
    } catch (err) {
      toast(`No se pudo eliminar: ${err instanceof Error ? err.message : 'error'}`, 'error');
    }
  }

  async function alternarActiva(e: Empresa) {
    try {
      await repo.editarEmpresa(e.id, { activa: !e.activa });
      await cargar();
      onChanged();
    } catch (err) {
      toast(`No se pudo cambiar el estado: ${err instanceof Error ? err.message : 'error'}`, 'error');
    }
  }

  return (
    <Modal title="⚙ Gestionar empresas" onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>{d.id ? 'Editar empresa' : 'Nueva empresa'}</div>
        <div className="form-grid-2">
          <div className="form-row">
            <label htmlFor="emp-clave">Clave <span className="muted">(corta y única, p. ej. GT)</span></label>
            <input id="emp-clave" className="input" value={d.clave} maxLength={8} onChange={(e) => set('clave', e.target.value.toUpperCase())} placeholder="GT" disabled={!!d.id} />
          </div>
          <div className="form-row">
            <label htmlFor="emp-nombre">Nombre / razón social</label>
            <input id="emp-nombre" className="input" value={d.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Golden Touch 1127, C.A." />
          </div>
          <div className="form-row">
            <label htmlFor="emp-rif">RIF <span className="muted">(opcional)</span></label>
            <input id="emp-rif" className="input" value={d.rif} onChange={(e) => set('rif', e.target.value)} placeholder="J-00000000-0" />
          </div>
          <div className="form-row">
            <label htmlFor="emp-moneda">Moneda <span className="muted">(opcional)</span></label>
            <select id="emp-moneda" className="input" value={d.moneda} onChange={(e) => set('moneda', e.target.value as '' | Moneda)}>
              <option value="">—</option>
              <option value="Bs">Bs</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div className="form-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <input type="checkbox" checked={d.activa} onChange={(e) => set('activa', e.target.checked)} /> Activa
            </label>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
          {d.id && <button type="button" className="btn btn-ghost" onClick={() => setD(VACIO)} disabled={guardando}>Cancelar edición</button>}
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : d.id ? 'Guardar cambios' : 'Agregar empresa'}
          </button>
        </div>
      </div>

      {cargando ? (
        <p className="muted">Leyendo empresas…</p>
      ) : empresas.length === 0 ? (
        <p className="muted">Aún no hay empresas. Agrega la primera arriba.</p>
      ) : (
        <div className="adm-tabla">
          <table>
            <thead>
              <tr><th>Clave</th><th>Nombre</th><th>RIF</th><th>Moneda</th><th>Estado</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} style={e.activa ? undefined : { opacity: 0.6 }}>
                  <td className="mono">{e.clave}</td>
                  <td>{e.nombre}</td>
                  <td className="mono">{e.rif ?? '—'}</td>
                  <td>{e.moneda ?? '—'}</td>
                  <td>{e.activa ? 'Activa' : 'Inactiva'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setD({ id: e.id, clave: e.clave, nombre: e.nombre, rif: e.rif ?? '', moneda: e.moneda ?? '', activa: e.activa })}>Editar</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void alternarActiva(e)}>{e.activa ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAEliminar(e)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aEliminar && (
        <ConfirmDialog
          title="Eliminar empresa"
          danger
          message={<>¿Eliminar <strong>{aEliminar.nombre}</strong> ({aEliminar.clave})? Si tiene gastos fijos asociados, se <strong>desactivará</strong> en lugar de borrarse, para no perder el histórico.</>}
          confirmText="Eliminar"
          onConfirm={() => void confirmarEliminar(aEliminar)}
          onCancel={() => setAEliminar(null)}
        />
      )}
    </Modal>
  );
}
