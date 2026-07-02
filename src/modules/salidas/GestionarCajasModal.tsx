import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import type { Caja, MonedaCaja, CajaSaldo } from '@/shared/lib/types';
import {
  listCajas, crearCaja, renombrarCaja, deshabilitarCaja, habilitarCaja, ajustarSaldo,
} from './cajas.repository';
import { ingresarDivisa, listSaldos } from '@/modules/tesoreria/cajaSaldos.repository';
import { getTasasMercado } from '@/modules/tesoreria/tasas.repository';

/** Monedas que se manejan como divisa con tasa (Bs por unidad). USDT usa la tasa Binance. */
const ES_DIVISA = (m: string) => m === 'USDT';

/** Administra las cajas de la tesorería: alta (con moneda + saldo inicial),
 *  renombrar, deshabilitar/reactivar y ajustar saldo. */
export function GestionarCajasModal({
  actor, actorName, onClose, onCambioAplicado,
}: {
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onCambioAplicado?: () => void;
}) {
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [saldos, setSaldos] = useState<CajaSaldo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [nombre, setNombre] = useState('');
  const [moneda, setMoneda] = useState<MonedaCaja>('USD');
  const [saldoIni, setSaldoIni] = useState('0');
  // Tasa Binance (Bs por 1 USDT) para cajas USDT: sugerida del mercado, editable.
  const [tasaUsdt, setTasaUsdt] = useState('');
  const [tasaBinance, setTasaBinance] = useState<number | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [ajusteId, setAjusteId] = useState<string | null>(null);
  const [ajusteVal, setAjusteVal] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('');

  async function recargar() {
    setLoading(true);
    try {
      const [cs, sal] = await Promise.all([listCajas(), listSaldos().catch(() => [] as CajaSaldo[])]);
      setCajas(cs);
      setSaldos(sal);
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar las cajas', 'error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void recargar(); }, []);
  function cambio() { onCambioAplicado?.(); }

  // Tasa Binance del día (Bs por 1 USDT): se sugiere al crear una caja USDT.
  useEffect(() => {
    getTasasMercado().then((m) => setTasaBinance(m.usdtVes ?? null)).catch(() => setTasaBinance(null));
  }, []);
  useEffect(() => {
    if (ES_DIVISA(moneda) && tasaBinance != null && !tasaUsdt) setTasaUsdt(String(tasaBinance));
  }, [moneda, tasaBinance, tasaUsdt]);

  // Saldo multimoneda (caja_saldos) por caja: para USDT el saldo real vive acá.
  const saldoMultiPorCaja = useMemo(() => {
    const m = new Map<string, { saldo: number; tasaProm: number | null; moneda: string }>();
    for (const s of saldos) {
      if (s.moneda === 'Bs') continue; // las cajas de divisa que nos importan acá son USDT/USD
      const cur = m.get(s.caja_id);
      const saldo = (cur?.saldo ?? 0) + (Number(s.saldo) || 0);
      m.set(s.caja_id, { saldo, tasaProm: s.tasa_prom != null ? Number(s.tasa_prom) : (cur?.tasaProm ?? null), moneda: s.moneda });
    }
    return m;
  }, [saldos]);

  async function agregar() {
    if (!nombre.trim()) { toast('Escribí el nombre de la caja', 'error'); return; }
    const saldoInicial = Number(saldoIni) || 0;
    const esUsdt = ES_DIVISA(moneda);
    const tasa = Number(tasaUsdt) || 0;
    if (esUsdt && saldoInicial > 0 && tasa <= 0) { toast('Indicá la tasa Binance (Bs por USDT) del saldo inicial.', 'error'); return; }
    setBusy(true);
    try {
      // USDT es multimoneda: la caja nace sin saldo legacy y el saldo entra como
      // divisa (caja_saldos) con su tasa Binance → registra lote + tasa promedio.
      const caja = await crearCaja({ nombre, moneda, saldoInicial: esUsdt ? 0 : saldoInicial }, actor);
      if (esUsdt && saldoInicial > 0) {
        await ingresarDivisa({
          cajaId: caja.id, cuenta: 'general', moneda: 'USDT', monto: saldoInicial, tasaBs: tasa,
          origen: 'Saldo inicial', motivo: 'Saldo inicial de la caja', actor, actorName,
        });
      }
      notify(`Caja "${nombre.trim()}" creada${esUsdt ? ' · USDT' : ''}`, 'success');
      setNombre(''); setSaldoIni('0'); setTasaUsdt(esUsdt && tasaBinance != null ? String(tasaBinance) : '');
      await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo crear', 'error'); }
    finally { setBusy(false); }
  }

  async function guardarRename() {
    if (!editId) return;
    setBusy(true);
    try {
      await renombrarCaja(editId, editVal);
      notify('Caja renombrada', 'success');
      setEditId(null); await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error'); }
    finally { setBusy(false); }
  }

  async function toggleEstado(c: Caja) {
    setBusy(true);
    try {
      if (c.estado === 'activo') { await deshabilitarCaja(c.id); notify(`Caja "${c.nombre}" deshabilitada`, 'success'); }
      else { await habilitarCaja(c.id); notify(`Caja "${c.nombre}" reactivada`, 'success'); }
      await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error'); }
    finally { setBusy(false); }
  }

  async function guardarAjuste() {
    if (!ajusteId) return;
    if (!ajusteMotivo.trim()) { toast('Indicá el motivo del ajuste', 'error'); return; }
    setBusy(true);
    try {
      await ajustarSaldo(ajusteId, Number(ajusteVal) || 0, ajusteMotivo, actor, actorName);
      notify('Saldo ajustado', 'success');
      setAjusteId(null); setAjusteMotivo('');
      await recargar(); cambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo ajustar', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Cajas (tesorería)" size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Cuentas de dinero con saldo. Una salida de dinero descuenta el saldo; un traslado
        lo mueve entre cajas de la misma moneda.
      </p>

      {/* Alta */}
      <div className="form-grid" style={{ marginBottom: '.85rem' }}>
        <div className="form-row">
          <label>Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Caja chica" />
        </div>
        <div className="form-row">
          <label>Moneda</label>
          <select className="select" value={moneda} onChange={(e) => setMoneda(e.target.value as MonedaCaja)}>
            <option value="USD">USD ($)</option>
            <option value="Bs">Bolívares (Bs)</option>
            <option value="USDT">USDT</option>
          </select>
        </div>
        <div className="form-row">
          <label>Saldo inicial</label>
          <input className="input mono" type="number" min={0} step="0.01" value={saldoIni} onChange={(e) => setSaldoIni(e.target.value)} />
        </div>
        {ES_DIVISA(moneda) ? (
          <div className="form-row">
            <label>Tasa Binance (Bs por USDT)</label>
            <input className="input mono" type="number" min={0} step="0.0001" value={tasaUsdt} onChange={(e) => setTasaUsdt(e.target.value)} placeholder={tasaBinance != null ? String(tasaBinance) : 'Bs por 1 USDT'} />
            <small className="muted">{tasaBinance != null ? `Sugerida (Binance hoy): ${tasaBinance.toLocaleString('es-VE', { maximumFractionDigits: 4 })} Bs` : 'Sin tasa Binance cargada'}</small>
          </div>
        ) : <div className="form-row" />}
        <div className="form-row" style={{ alignSelf: 'end' }}>
          <button className="btn btn-primary" onClick={agregar} disabled={busy}>+ Crear caja</button>
        </div>
      </div>
      {ES_DIVISA(moneda) && (
        <p className="hint muted" style={{ marginTop: '-.4rem', marginBottom: '.85rem', fontSize: '.8rem' }}>
          La caja USDT registra en cada ingreso la <strong>tasa Binance</strong> con la que entró el dinero,
          y muestra el <strong>promedio ponderado</strong> de todas las entradas.
        </p>
      )}

      {loading ? (
        <div className="muted" style={{ padding: '1rem' }}>Cargando cajas…</div>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr><th>Caja</th><th>Moneda</th><th style={{ textAlign: 'right' }}>Saldo</th><th>Estado</th><th style={{ width: 280 }}></th></tr>
            </thead>
            <tbody>
              {cajas.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin cajas.</td></tr>}
              {cajas.map((c) => {
                const enEd = editId === c.id;
                const activo = c.estado === 'activo';
                const esUsdt = (c.moneda as string) === 'USDT';
                const multi = saldoMultiPorCaja.get(c.id);
                const saldoShow = esUsdt ? (multi?.saldo ?? 0) : (Number(c.saldo) || 0);
                return (
                  <tr key={c.id}>
                    <td>{enEd ? (
                      <input className="input" value={editVal} onChange={(e) => setEditVal(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') void guardarRename(); if (e.key === 'Escape') setEditId(null); }} />
                    ) : <strong>{c.nombre}</strong>}</td>
                    <td><span className="badge">{c.moneda}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {esUsdt ? `${saldoShow.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : money(saldoShow)}
                      {esUsdt && multi?.tasaProm != null && multi.tasaProm > 0 && (
                        <div className="muted" style={{ fontSize: '.7rem' }}>tasa prom: {multi.tasaProm.toLocaleString('es-VE', { maximumFractionDigits: 4 })} Bs</div>
                      )}
                    </td>
                    <td><span className={`badge ${activo ? 'success' : 'warning'}`}>{activo ? 'Activa' : 'Inhabilitada'}</span></td>
                    <td className="actions">
                      {enEd ? (
                        <>
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void guardarRename()}>Guardar</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditId(null)}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setEditId(c.id); setEditVal(c.nombre); }}>✎</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setAjusteId(c.id); setAjusteVal(String(c.saldo)); setAjusteMotivo(''); }}>$ Ajustar</button>
                          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => toggleEstado(c)}>{activo ? '⃠ Deshabilitar' : '↺ Reactivar'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {cajas.length > 0 && (
              <tfoot>
                {(['USD', 'Bs'] as MonedaCaja[]).map((m) => {
                  const total = cajas.filter((c) => c.moneda === m).reduce((a, c) => a + (Number(c.saldo) || 0), 0);
                  if (!cajas.some((c) => c.moneda === m)) return null;
                  return (
                    <tr key={m}>
                      <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total registrado ({m})</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{m === 'USD' ? '$ ' : 'Bs '}{total.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td colSpan={2}></td>
                    </tr>
                  );
                })}
                {cajas.some((c) => (c.moneda as string) === 'USDT') && (() => {
                  // Total USDT (de caja_saldos) y tasa promedio ponderada entre todas las cajas USDT.
                  const usdtCajas = cajas.filter((c) => (c.moneda as string) === 'USDT');
                  let totalUsdt = 0, sumaBs = 0;
                  for (const c of usdtCajas) {
                    const mu = saldoMultiPorCaja.get(c.id);
                    const sal = mu?.saldo ?? 0;
                    totalUsdt += sal;
                    if (mu?.tasaProm != null) sumaBs += sal * mu.tasaProm;
                  }
                  const tasaProm = totalUsdt > 0 ? sumaBs / totalUsdt : 0;
                  return (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>
                        Total registrado (USDT)
                        {tasaProm > 0 && <div className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}>tasa prom. ponderada: {tasaProm.toLocaleString('es-VE', { maximumFractionDigits: 4 })} Bs</div>}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{totalUsdt.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT</td>
                      <td colSpan={2}></td>
                    </tr>
                  );
                })()}
              </tfoot>
            )}
          </table>
        </div>
      )}

      {ajusteId && (
        <Modal title="Ajustar saldo" size="md" onClose={() => setAjusteId(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setAjusteId(null)} disabled={busy}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardarAjuste} disabled={busy}>Guardar</button>
          </>}>
          <div className="form-row">
            <label>Nuevo saldo</label>
            <input className="input mono" type="number" step="0.01" value={ajusteVal} onChange={(e) => setAjusteVal(e.target.value)} autoFocus />
          </div>
          <div className="form-row">
            <label>Motivo del ajuste</label>
            <input className="input" value={ajusteMotivo} onChange={(e) => setAjusteMotivo(e.target.value)} placeholder="Ej. conciliación de caja" />
          </div>
        </Modal>
      )}
    </Modal>
  );
}
