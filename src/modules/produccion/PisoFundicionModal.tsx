/* ============================================================
   MGG · Fundición · Piso: qué hay entregado y qué se devuelve
   El material que Salidas mandó a fundición vive acá hasta que se
   quema en una colada o se devuelve al inventario. No es un almacén:
   es el saldo de lo entregado menos lo usado.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { money, num } from '@/shared/lib/format';
import { destinosDeTraslado } from '@/modules/inventario/stockPorAlmacen';
import { listAlmacenes } from '@/modules/inventario/almacenes.repository';
import type { Almacen } from '@/shared/lib/types';
import { cargarPisoFundicion, devolverDeFundicion } from './pisoFundicion.repository';
import type { DisponibleFundicion } from './pisoFundicion';

export function PisoFundicionModal({ actor, actorName, canWrite, onClose, onCambio }: {
  actor: string;
  actorName?: string | null;
  canWrite: boolean;
  onClose: () => void;
  /** Se llama cuando algo se devolvió, para que la página recargue el inventario. */
  onCambio?: () => void;
}) {
  const [piso, setPiso] = useState<DisponibleFundicion[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [devolver, setDevolver] = useState<DisponibleFundicion | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, a] = await Promise.all([cargarPisoFundicion(), listAlmacenes()]);
      setPiso(p); setAlmacenes(a);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar().catch((e) => toast(e instanceof Error ? e.message : 'Error al cargar', 'error')); }, [cargar]);

  const conSaldo = piso.filter((f) => f.disponible > 0);
  const valor = conSaldo.reduce((a, f) => a + f.disponible * f.costo_unitario, 0);

  return (
    <Modal title="🔥 Piso de fundición" size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Material que <strong>ya salió del inventario</strong> por una salida marcada «va para fundición».
        Las coladas lo consumen de acá <strong>sin volver a descontarlo</strong>. Lo que no se funda,
        se devuelve al inventario con el botón de cada fila.
      </p>

      {cargando ? <EmptyState message="Cargando…" icon="◔" />
        : !piso.length ? (
          <EmptyState icon="🔥" message="Todavía no se entregó material a fundición. Se marca en Salidas, en la línea del material." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '.5rem 0 .8rem' }}>
              <div className="card"><div className="muted" style={{ fontSize: '.7rem' }}>MATERIALES CON SALDO</div><strong className="mono">{conSaldo.length}</strong></div>
              <div className="card"><div className="muted" style={{ fontSize: '.7rem' }}>VALOR EN EL PISO</div><strong className="mono">{money(valor)}</strong></div>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.82rem' }}>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th style={{ textAlign: 'right' }}>Entregado</th>
                    <th style={{ textAlign: 'right' }}>Fundido</th>
                    <th style={{ textAlign: 'right' }}>Devuelto</th>
                    <th style={{ textAlign: 'right' }}>Disponible</th>
                    <th style={{ textAlign: 'right' }}>Costo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {piso.map((f) => (
                    <tr key={f.producto_id} style={f.disponible <= 0 ? { opacity: 0.55 } : undefined}>
                      <td>
                        <strong>{f.producto_nombre || '(sin nombre)'}</strong>
                        <div className="muted" style={{ fontSize: '.7rem' }}
                          title={f.entregas.map((e) => `${e.codigo}: ${num(e.cantidad)}`).join(' · ')}>
                          {f.entregas.length} entrega{f.entregas.length !== 1 ? 's' : ''}
                          {f.entregas.length > 0 ? ` · última ${f.entregas[f.entregas.length - 1].codigo ?? ''}` : ''}
                        </div>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(f.entregado)} {f.unidad ?? ''}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(f.fundido)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{num(f.devuelto)}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: f.disponible > 0 ? 'var(--primary-3)' : undefined }}>{num(f.disponible)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(f.costo_unitario)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {canWrite && f.disponible > 0 && (
                          <button className="btn btn-sm btn-ghost" onClick={() => setDevolver(f)}
                            title="Devolver al inventario lo que no se va a fundir">↩ Devolver</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

      {devolver && (
        <DevolverModal fila={devolver} almacenes={almacenes} actor={actor} actorName={actorName}
          onClose={() => setDevolver(null)}
          onHecho={async () => { setDevolver(null); await cargar(); onCambio?.(); }} />
      )}
    </Modal>
  );
}

function DevolverModal({ fila, almacenes, actor, actorName, onClose, onHecho }: {
  fila: DisponibleFundicion; almacenes: Almacen[]; actor: string; actorName?: string | null;
  onClose: () => void; onHecho: () => void;
}) {
  // Vuelve a un almacén padre o de mineral, igual que cualquier destino del sistema.
  const grupos = useMemo(() => destinosDeTraslado(almacenes), [almacenes]);
  const porDefecto = useMemo(() => {
    const matanza = grupos.find(([sede]) => sede.toUpperCase().includes('MATANZA'));
    return matanza?.[1][0]?.nombre ?? grupos[0]?.[1][0]?.nombre ?? '';
  }, [grupos]);

  const [cantidad, setCantidad] = useState(String(fila.disponible));
  const [almacen, setAlmacen] = useState(porDefecto);
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cant = Number(cantidad) || 0;
  const puede = cant > 0 && cant <= fila.disponible && !!almacen && !saving;

  async function confirmar() {
    if (!puede) return;
    setError(null); setSaving(true);
    try {
      await devolverDeFundicion({
        productoId: fila.producto_id, cantidad: cant, almacen,
        costoUnitario: fila.costo_unitario, nota: nota.trim() || null, actor, actorName,
      });
      toast(`Devueltos ${num(cant)} ${fila.unidad ?? ''} de ${fila.producto_nombre} a ${almacen}`, 'success');
      onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo devolver');
      setSaving(false);
    }
  }

  return (
    <Modal title={`Devolver · ${fila.producto_nombre}`} size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={confirmar} disabled={!puede}>{saving ? 'Devolviendo…' : 'Devolver al inventario'}</button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div className="muted" style={{ fontSize: '.82rem' }}>
          En el piso hay <strong className="mono">{num(fila.disponible)} {fila.unidad ?? ''}</strong> ·
          entra de vuelta a <strong className="mono">{money(fila.costo_unitario)}</strong>, el costo con el que salió.
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span>Cantidad a devolver</span>
          <input className="input mono" type="number" min={0} max={fila.disponible} step="any"
            value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          {cant > fila.disponible && <span style={{ color: 'var(--danger)', fontSize: '.8rem' }}>Supera lo que queda en el piso.</span>}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span>Vuelve al almacén</span>
          <select className="select" value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
            {grupos.map(([sede, destinos]) => (
              <optgroup key={sede} label={sede}>
                {destinos.map((d) => <option key={d.nombre} value={d.nombre}>{d.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <span>Nota (opcional)</span>
          <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Por qué se devuelve…" />
        </label>
        {error && <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>}
        <small className="muted">Queda como una <strong>entrada</strong> en el kardex del material.</small>
      </div>
    </Modal>
  );
}
