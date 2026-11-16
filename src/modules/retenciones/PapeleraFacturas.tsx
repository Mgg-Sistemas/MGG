import { useCallback, useEffect, useState } from 'react';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { dateTime } from '@/shared/lib/format';
import { supabase } from '@/shared/lib/supabase';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { TABLE_FACTURAS_EXTERNAS } from './facturasExternas.repository';

interface FacturaPapelera {
  id: string;
  numero_factura: string;
  proveedor_nombre: string;
  eliminado_en: string;
  eliminado_motivo: string;
}

export function BotonPapeleraFacturas({ onChanged }: { onChanged: () => void }) {
  const [abierta, setAbierta] = useState(false);
  return <>
    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAbierta(true)}>🗑 Papelera</button>
    {abierta && <PapeleraFacturas onChanged={onChanged} onClose={() => setAbierta(false)} />}
  </>;
}

function PapeleraFacturas({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const { can } = usePermissions();
  const [facturas, setFacturas] = useState<FacturaPapelera[]>([]);
  const [hayLimpieza, setHayLimpieza] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [idsParaVaciar, setIdsParaVaciar] = useState<string[] | null>(null);
  const puedeVaciar = can('retenciones', 'vaciar_papelera');

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: fallo } = await supabase.from(TABLE_FACTURAS_EXTERNAS)
      .select('id, numero_factura, proveedor_nombre, eliminado_en, eliminado_motivo')
      .not('eliminado_en', 'is', null).order('eliminado_en', { ascending: false });
    setError(fallo?.message ?? '');
    setFacturas(fallo ? [] : (data ?? []) as FacturaPapelera[]);
    if (puedeVaciar) {
      const { data: pendientes } = await supabase.from('ret_factura_adjuntos_por_vaciar').select('ruta').limit(1);
      setHayLimpieza(!!pendientes?.length);
    }
    setCargando(false);
  }, [puedeVaciar]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function recuperar(id: string) {
    setOcupado(true);
    try {
      const { error: fallo } = await supabase.rpc('ret_factura_recuperar', { p_id: id });
      if (fallo) throw new Error(fallo.message);
      toast('Factura recuperada', 'success');
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo recuperar la factura', 'error');
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
        const { data, error: fallo } = await supabase.rpc('ret_factura_vaciar_papelera', { p_ids: ids });
        if (fallo) throw new Error(fallo.message);
        toast(`${data ?? 0} factura(s) eliminadas definitivamente`, 'success');
      }
      onChanged();
      const { data: adjuntos, error: errorCola } = await supabase
        .from('ret_factura_adjuntos_por_vaciar').select('bucket, ruta').limit(500);
      if (errorCola) throw new Error(errorCola.message);
      for (const bucket of ['compras-oc', 'retenciones-facturas-externas']) {
        const rutas = (adjuntos ?? []).filter((a) => a.bucket === bucket).map((a) => String(a.ruta));
        if (!rutas.length) continue;
        const { error: errorStorage } = await supabase.storage.from(bucket).remove(rutas);
        if (errorStorage) throw new Error(errorStorage.message);
        const { error: errorCierre } = await supabase.rpc('ret_factura_cerrar_limpieza', { p_bucket: bucket, p_rutas: rutas });
        if (errorCierre) throw new Error(errorCierre.message);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo vaciar la papelera', 'error');
    } finally {
      await cargar();
      setOcupado(false);
    }
  }

  return (
    <Modal title="Papelera de facturas externas" size="lg" onClose={onClose} footer={
      <>
        {puedeVaciar && hayLimpieza && <button type="button" className="btn btn-ghost" disabled={ocupado || cargando}
          onClick={() => void vaciar([])}>Limpiar adjuntos pendientes</button>}
        {puedeVaciar && <button type="button" className="btn btn-danger"
          disabled={ocupado || cargando || !facturas.length}
          onClick={() => setIdsParaVaciar(facturas.map((f) => f.id))}>Vaciar papelera</button>}
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      {cargando && <p>Cargando papelera…</p>}
      {error && <p role="alert">{error}</p>}
      {!cargando && !error && !facturas.length && <p>La papelera está vacía.</p>}
      {facturas.map((f) => <article className="card" key={f.id}>
        <strong>#{f.numero_factura} · {f.proveedor_nombre}</strong>
        <p className="muted">{dateTime(f.eliminado_en)} · {f.eliminado_motivo}</p>
        {can('retenciones', 'escritura') && <button type="button" className="btn btn-sm btn-ghost"
          disabled={ocupado} onClick={() => void recuperar(f.id)}>Recuperar</button>}
      </article>)}
      {idsParaVaciar && <ConfirmDialog title="Vaciar papelera" danger confirmText="Eliminar definitivamente"
        message={`Se eliminarán definitivamente ${idsParaVaciar.length} factura(s) de la papelera.`}
        onCancel={() => setIdsParaVaciar(null)} onConfirm={() => vaciar(idsParaVaciar)} />}
    </Modal>
  );
}

export function EnviarFacturaPapelera({ nombre, onClose, onConfirm }: {
  nombre: string;
  onClose: () => void;
  onConfirm: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function enviar() {
    setOcupado(true);
    try { await onConfirm(motivo.trim()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar la factura a la papelera', 'error'); }
    finally { setOcupado(false); }
  }
  return <Modal title="Enviar factura a la papelera" size="sm" onClose={onClose} footer={
    <>
      <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onClose}>Cancelar</button>
      <button type="button" className="btn btn-danger" disabled={ocupado || motivo.trim().length < 5}
        onClick={() => void enviar()}>Enviar a papelera</button>
    </>
  }>
    <p>Podrás recuperar {nombre} con sus soportes.</p>
    <label>Motivo
      <textarea className="input" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </label>
  </Modal>;
}
