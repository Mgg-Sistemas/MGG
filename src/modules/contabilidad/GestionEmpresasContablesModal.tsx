/* ============================================================
   Golden Touch · Contabilidad · Modal para Gestionar Empresas
   
   Permite ver, crear y actualizar las entidades jurídicas del grupo
   (tabla `admin_empresas`), compartidas entre Administración y Contabilidad.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  listTodasEmpresasContables,
  guardarNuevaEmpresaContable,
  actualizarEmpresaContable,
  cambiarActivaEmpresaContable,
  type EmpresaContable,
} from './empresasContabilidad';

interface EmpresaDraft {
  id?: string;
  clave: string;
  nombre: string;
  rif: string;
  activa: boolean;
}

const VACIO: EmpresaDraft = { clave: '', nombre: '', rif: '', activa: true };

export function GestionEmpresasContablesModal({
  onClose,
  onActualizado,
}: {
  onClose: () => void;
  onActualizado: () => void;
}) {
  const [empresas, setEmpresas] = useState<EmpresaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [draft, setDraft] = useState<EmpresaDraft>(VACIO);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarInactivar, setConfirmarInactivar] = useState<EmpresaContable | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const data = await listTodasEmpresasContables();
      setEmpresas(data);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron consultar las empresas.', 'error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function iniciarEdicion(e: EmpresaContable) {
    setEditandoId(e.clave);
    setDraft({
      id: e.id,
      clave: e.clave,
      nombre: e.nombre,
      rif: e.rif ?? '',
      activa: e.activa,
    });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setDraft(VACIO);
  }

  async function guardar() {
    const clave = draft.clave.trim().toUpperCase();
    const nombre = draft.nombre.trim();
    const rif = draft.rif.trim().toUpperCase() || null;

    if (!clave || clave.length < 2) {
      toast('La clave de la empresa debe tener al menos 2 caracteres (p. ej. GT, MGG).', 'warning');
      return;
    }
    if (!nombre) {
      toast('El nombre o razón social es obligatorio.', 'warning');
      return;
    }

    setGuardando(true);
    try {
      if (editandoId) {
        await actualizarEmpresaContable(editandoId, {
          nombre,
          rif,
          activa: draft.activa,
        });
        toast(`Empresa ${clave} actualizada exitosamente.`, 'success');
      } else {
        const existe = empresas.some((e) => e.clave.toUpperCase() === clave);
        if (existe) {
          toast(`Ya existe una empresa registrada con la clave «${clave}».`, 'warning');
          setGuardando(false);
          return;
        }

        const orden = empresas.length + 1;
        await guardarNuevaEmpresaContable({
          clave,
          nombre,
          rif,
          activa: draft.activa,
          orden,
        });
        toast(`Empresa ${clave} creada exitosamente.`, 'success');
      }

      cancelarEdicion();
      await cargar();
      onActualizado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al guardar la empresa.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function alternarEstado(e: EmpresaContable) {
    try {
      const nuevoEstado = !e.activa;
      await cambiarActivaEmpresaContable(e.clave, nuevoEstado);
      toast(`Empresa ${e.clave} ${nuevoEstado ? 'activada' : 'inactivada'}.`, 'success');
      await cargar();
      onActualizado();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al cambiar el estado.', 'error');
    } finally {
      setConfirmarInactivar(null);
    }
  }

  return (
    <>
      <Modal
        title="🏢 Gestión de Empresas (Multi-Empresa)"
        size="lg"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        }
      >
        <p className="muted" style={{ marginTop: 0, fontSize: '.9rem' }}>
          Las empresas registradas comparten el catálogo maestro con Administración y disponen de su
          propio plan de cuentas, comprobantes y libros contables independientes.
        </p>

        {/* Formulario de Alta / Edición */}
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--surface-2)' }}>
          <div className="card-title" style={{ fontSize: '1rem', marginBottom: '.75rem' }}>
            {editandoId ? `✏ Modificar Empresa: ${editandoId}` : '+ Registrar Nueva Empresa'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.75rem', alignItems: 'end' }}>
            <label>
              <span className="muted" style={{ fontSize: '.8rem', display: 'block', marginBottom: '.25rem' }}>Clave (Acrónimo)</span>
              <input
                className="input mono"
                placeholder="Ej. GT"
                maxLength={8}
                value={draft.clave}
                disabled={Boolean(editandoId) || guardando}
                onChange={(e) => setDraft({ ...draft, clave: e.target.value.toUpperCase() })}
              />
            </label>
            <label style={{ gridColumn: 'span 2' }}>
              <span className="muted" style={{ fontSize: '.8rem', display: 'block', marginBottom: '.25rem' }}>Razón Social / Nombre Oficial</span>
              <input
                className="input"
                placeholder="Ej. GOLDEN TOUCH 1127, C.A."
                value={draft.nombre}
                disabled={guardando}
                onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
              />
            </label>
            <label>
              <span className="muted" style={{ fontSize: '.8rem', display: 'block', marginBottom: '.25rem' }}>RIF Fiscal</span>
              <input
                className="input mono"
                placeholder="J-12345678-9"
                value={draft.rif}
                disabled={guardando}
                onChange={(e) => setDraft({ ...draft, rif: e.target.value.toUpperCase() })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.85rem' }}>
            {editandoId && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={guardando} onClick={cancelarEdicion}>
                Cancelar
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? 'Guardando…' : editandoId ? 'Guardar Cambios' : 'Registrar Empresa'}
            </button>
          </div>
        </div>

        {/* Tabla de Empresas */}
        {cargando ? (
          <p className="muted">Cargando empresas…</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Clave</th>
                  <th>Razón Social</th>
                  <th>RIF</th>
                  <th style={{ textAlign: 'center', width: 100 }}>Estado</th>
                  <th style={{ textAlign: 'right', width: 130 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e) => (
                  <tr key={e.clave}>
                    <td><strong className="mono">{e.clave}</strong></td>
                    <td>{e.nombre}</td>
                    <td><span className="mono">{e.rif ?? '—'}</span></td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`cont-etq ${e.activa ? 'mov' : 'descuadrado'}`}>
                        {e.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Modificar razón social o RIF"
                        onClick={() => iniciarEdicion(e)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title={e.activa ? 'Inactivar empresa' : 'Activar empresa'}
                        onClick={() => {
                          if (e.activa) setConfirmarInactivar(e);
                          else void alternarEstado(e);
                        }}
                      >
                        {e.activa ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Diálogo de confirmación para inactivar */}
      {confirmarInactivar && (
        <ConfirmDialog
          title={`Inactivar empresa ${confirmarInactivar.nombre} (${confirmarInactivar.clave})`}
          message="Al inactivar esta empresa, no aparecerá en las operaciones habituales pero se conservará todo su histórico contable. ¿Deseas continuar?"
          confirmText="Inactivar"
          danger
          onConfirm={() => void alternarEstado(confirmarInactivar)}
          onCancel={() => setConfirmarInactivar(null)}
        />
      )}
    </>
  );
}
