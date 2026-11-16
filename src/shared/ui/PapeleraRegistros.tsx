import { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { ModuleKey } from '@/modules/usuarios/permisos.repository';
import { dateTime } from '@/shared/lib/format';
import { ConfirmDialog, Modal } from './Modal';
import { toast } from './Toast';

interface RegistroPapelera {
  id: string;
  titulo: string;
  eliminado_en: string;
  eliminado_motivo: string;
}

export interface AccionesPapelera {
  modulo: ModuleKey;
  titulo: string;
  listar: () => Promise<RegistroPapelera[]>;
  recuperar: (id: string) => Promise<void>;
  vaciar: (ids: string[]) => Promise<number>;
  hayAdjuntosPendientes: () => Promise<boolean>;
  limpiarAdjuntos: () => Promise<void>;
}

export function BotonPapeleraRegistros({ acciones, onChanged }: { acciones: AccionesPapelera; onChanged: () => void }) {
  const [abierta, setAbierta] = useState(false);
  return <>
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAbierta(true)}>🗑 Papelera</button>
    {abierta && <PapeleraRegistros acciones={acciones} onChanged={onChanged} onClose={() => setAbierta(false)} />}
  </>;
}

function PapeleraRegistros({ acciones, onChanged, onClose }: {
  acciones: AccionesPapelera;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { can } = usePermissions();
  const puedeVaciar = can(acciones.modulo, 'vaciar_papelera');
  const [registros, setRegistros] = useState<RegistroPapelera[]>([]);
  const [hayLimpieza, setHayLimpieza] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [idsParaVaciar, setIdsParaVaciar] = useState<string[] | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setRegistros(await acciones.listar());
      setHayLimpieza(puedeVaciar && await acciones.hayAdjuntosPendientes());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la papelera');
    } finally {
      setCargando(false);
    }
  }, [acciones, puedeVaciar]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function recuperar(id: string) {
    setOcupado(true);
    try {
      await acciones.recuperar(id);
      toast('Registro recuperado', 'success');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo recuperar el registro', 'error');
    } finally {
      await cargar();
      setOcupado(false);
    }
  }

  async function vaciar(ids: string[]) {
    setOcupado(true);
    setIdsParaVaciar(null);
    try {
      if (ids.length) {
        const cantidad = await acciones.vaciar(ids);
        toast(`${cantidad} registro(s) eliminados definitivamente`, 'success');
        onChanged();
      }
      await acciones.limpiarAdjuntos();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo vaciar la papelera', 'error');
    } finally {
      await cargar();
      setOcupado(false);
    }
  }

  return (
    <Modal title={acciones.titulo} size="lg" onClose={onClose} footer={
      <>
        {puedeVaciar && hayLimpieza && <button type="button" className="btn btn-ghost" disabled={ocupado || cargando}
          onClick={() => void vaciar([])}>Limpiar adjuntos pendientes</button>}
        {puedeVaciar && <button type="button" className="btn btn-danger"
          disabled={ocupado || cargando || !!error || !registros.length}
          onClick={() => setIdsParaVaciar(registros.map((r) => r.id))}>Vaciar papelera</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      {cargando && <p>Cargando papelera…</p>}
      {error && <p role="alert">{error}</p>}
      {!cargando && !error && !registros.length && <p>La papelera está vacía.</p>}
      {registros.map((r) => <article className="card" key={r.id}>
        <strong>{r.titulo}</strong>
        <p className="muted">{dateTime(r.eliminado_en)} · {r.eliminado_motivo}</p>
        {can(acciones.modulo, 'escritura') && <button type="button" className="btn btn-sm btn-ghost"
          disabled={ocupado || cargando} onClick={() => void recuperar(r.id)}>Recuperar</button>}
      </article>)}
      {idsParaVaciar && <ConfirmDialog title="Vaciar papelera" danger confirmText="Eliminar definitivamente"
        message={`Se eliminarán definitivamente ${idsParaVaciar.length} registro(s) de la papelera.`}
        onCancel={() => setIdsParaVaciar(null)} onConfirm={() => vaciar(idsParaVaciar)} />}
    </Modal>
  );
}

export function EnviarRegistroPapelera({ nombre, onClose, onConfirm }: {
  nombre: string;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function enviar() {
    setOcupado(true);
    try { await onConfirm(motivo.trim()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar el registro a la papelera', 'error'); }
    finally { setOcupado(false); }
  }
  return <Modal title="Enviar a la papelera" size="sm" onClose={onClose} footer={
    <>
      <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-danger" disabled={ocupado || motivo.trim().length < 5}
        onClick={() => void enviar()}>Enviar a papelera</button>
    </>
  }>
    <p>Podrás recuperar {nombre} y sus adjuntos.</p>
    <label>Motivo
      <textarea className="input" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </label>
  </Modal>;
}
