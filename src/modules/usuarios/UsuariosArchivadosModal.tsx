/* ============================================================
   MGG · Usuarios · Archivados

   Deshabilitar y archivar son dos pasos distintos: el deshabilitado
   sigue a la vista en la tabla (puede ser temporal); el archivado
   sale de ahí y vive solo acá, hasta que alguien lo desarchive
   (vuelve deshabilitado) o lo habilite (vuelve con acceso, y se
   desarchiva solo). Cada archivo queda firmado: cuándo y quién.
   ============================================================ */
import { useMemo, useState } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import type { Usuario } from '@/shared/lib/types';
import { desarchivarUsuario, labelRol, setEstadoUsuario } from './usuarios.repository';
import {
  archivadosFiltrados, estaArchivado, FILTRO_ARCHIVADOS_VACIO,
  quienesArchivaron, type FiltroArchivados,
} from './usuariosArchivados';

interface Props {
  usuarios: Usuario[];
  canWrite: boolean;
  onClose: () => void;
  /** Se avisa al padre cuando alguien salió del archivo, para recargar. */
  onCambio: () => void | Promise<void>;
}

export function UsuariosArchivadosModal({ usuarios, canWrite, onClose, onCambio }: Props) {
  const [f, setF] = useState<FiltroArchivados>(FILTRO_ARCHIVADOS_VACIO);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aHabilitar, setAHabilitar] = useState<Usuario | null>(null);

  const set = (k: keyof FiltroArchivados, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const archivados = useMemo(() => usuarios.filter(estaArchivado), [usuarios]);
  const visibles = useMemo(() => archivadosFiltrados(usuarios, f), [usuarios, f]);
  const archivadores = useMemo(() => quienesArchivaron(usuarios), [usuarios]);
  const hayFiltro = JSON.stringify(f) !== JSON.stringify(FILTRO_ARCHIVADOS_VACIO);

  const nombreCompleto = (u: Usuario) => [u.nombre, u.apellido].filter(Boolean).join(' ') || u.email;

  async function desarchivar(u: Usuario) {
    setTrabajando(u.id);
    try {
      await desarchivarUsuario(u.id);
      toast(`${nombreCompleto(u)} volvió a la lista (sigue deshabilitado)`, 'success');
      await onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo desarchivar.', 'error');
    } finally {
      setTrabajando(null);
    }
  }

  async function habilitar(u: Usuario) {
    setTrabajando(u.id);
    try {
      await setEstadoUsuario(u.id, 'activo'); // habilitar desarchiva solo
      toast(`${nombreCompleto(u)} habilitado: puede volver a ingresar`, 'success');
      await onCambio();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo habilitar.', 'error');
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <Modal title="Usuarios archivados" size="xl" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.86rem' }}>
        Un usuario archivado <strong>no aparece</strong> en la tabla principal y sigue deshabilitado.
        Desarchivalo para verlo de nuevo en la lista, o habilitalo para devolverle el acceso
        (habilitar lo desarchiva solo).
      </p>

      <div className="filterbar" style={{ marginBottom: '.75rem' }}>
        <input
          className="search"
          placeholder="Buscar por nombre, apellido, email, CI, rol…"
          value={f.texto}
          onChange={(e) => set('texto', e.target.value)}
        />
        <select className="select" style={{ maxWidth: 210 }} value={f.porQuien} onChange={(e) => set('porQuien', e.target.value)} title="Quién archivó al usuario">
          <option value="">Archivado por cualquiera</option>
          {archivadores.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 150 }} type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} title="Archivado desde" />
        <input className="input" style={{ maxWidth: 150 }} type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} title="Archivado hasta" />
        {hayFiltro && (
          <button className="btn btn-ghost btn-sm" onClick={() => setF(FILTRO_ARCHIVADOS_VACIO)}>Limpiar filtros</button>
        )}
      </div>

      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.5rem' }}>
        {visibles.length} de {archivados.length} usuario{archivados.length === 1 ? '' : 's'} archivado{archivados.length === 1 ? '' : 's'}
      </div>

      {!visibles.length ? (
        <div className="empty" style={{ padding: '2rem', textAlign: 'center' }}>
          {archivados.length ? 'Ningún usuario archivado coincide con esos filtros.' : 'No hay usuarios archivados.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Nombre completo</th>
                <th>CI</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Archivado</th>
                <th>Por</th>
                <th style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((u) => (
                <tr key={u.id}>
                  <td><strong>{nombreCompleto(u)}</strong></td>
                  <td className="mono">{u.ci ?? '—'}</td>
                  <td>{u.email}</td>
                  <td>{labelRol(u.role)}</td>
                  <td>{u.archivado_en ? dateTime(u.archivado_en) : <span className="muted">sin registro</span>}</td>
                  <td>{u.archivado_por || <span className="muted">sin registro</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canWrite ? (
                      <>
                        <button
                          className="btn btn-sm btn-ghost"
                          disabled={trabajando === u.id}
                          onClick={() => void desarchivar(u)}
                          title="Devolverlo a la tabla principal, todavía deshabilitado"
                        >
                          {trabajando === u.id ? '…' : '↩ Desarchivar'}
                        </button>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={trabajando === u.id}
                          onClick={() => setAHabilitar(u)}
                          title="Devolverle el acceso al sistema (lo desarchiva solo)"
                        >
                          ✓ Habilitar
                        </button>
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: '.78rem' }}>sin permiso</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aHabilitar && (
        <ConfirmDialog
          title="Habilitar usuario"
          message={`${aHabilitar.email} saldrá del archivo y podrá volver a ingresar al sistema. ¿Continuar?`}
          confirmText="Habilitar"
          onCancel={() => setAHabilitar(null)}
          onConfirm={async () => {
            const u = aHabilitar;
            setAHabilitar(null);
            await habilitar(u);
          }}
        />
      )}
    </Modal>
  );
}
