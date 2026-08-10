/* ============================================================
   MGG · Editar los MATERIALES de una colada/refinación EN CURSO.
   Permite cambiar cantidades, quitar y agregar materiales (ej. corregir un
   coque con nombre/stock equivocado). Al guardar, el repositorio revierte el
   consumo anterior (sin tocar el PMP) y consume los nuevos, recalculando costos.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import type { Existencia, Producto } from '@/shared/lib/types';
import {
  getProduccionConMateriales, editarMaterialesProduccion,
  type ProduccionTipo, type MaterialInput,
} from './produccion.repository';

interface Row { key: string; producto_id: string | null; material_nombre: string; almacen: string; cantidad: number | null }

export function EditarMaterialesModal({
  produccionId, tipo = 'fundicion', productos, existencias, almacenesList, actor, actorName, onClose, onSaved,
}: {
  produccionId: string;
  tipo?: ProduccionTipo;
  productos: Producto[];
  existencias: Existencia[];
  almacenesList: string[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const [productoNombre, setProductoNombre] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSel, setAddSel] = useState('');

  useEffect(() => {
    let cancel = false;
    getProduccionConMateriales(produccionId).then((p) => {
      if (cancel || !p) { if (!cancel) setError('Orden no encontrada.'); return; }
      setProductoNombre(p.producto_nombre ?? '');
      setCantidad(Number(p.cantidad) || null);
      setRows((p.materiales ?? []).map((m, i) => ({
        key: `m${i}`, producto_id: m.producto_id ?? null, material_nombre: m.material_nombre,
        almacen: m.almacen, cantidad: Number(m.cantidad) || null,
      })));
    }).catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : 'Error al cargar'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [produccionId]);

  const stockDe = (pid: string | null, alm: string): number =>
    !pid ? Infinity : Number(existencias.find((e) => e.producto_id === pid && e.almacen === alm)?.stock) || 0;

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  // Opciones para agregar material: productos que no están ya en la lista.
  const opcionesAdd = useMemo(() => {
    const usados = new Set(rows.map((r) => r.producto_id).filter(Boolean));
    return productos.filter((p) => !usados.has(p.id)).map((p) => ({ value: p.id, label: `${p.nombre}${p.stock != null ? ` · ${num(p.stock)} en stock` : ''}` }));
  }, [productos, rows]);

  function agregar(pid: string) {
    const p = productos.find((x) => x.id === pid);
    if (!p) return;
    const alm = (p.almacen || almacenesList[0] || 'General');
    setRows((rs) => [...rs, { key: `n${rs.length}-${pid}`, producto_id: p.id, material_nombre: p.nombre, almacen: alm, cantidad: null }]);
    setAddSel('');
  }

  async function guardar() {
    setError(null);
    const cant = Number(cantidad) || 0;
    if (cant <= 0) { setError('La cantidad producida debe ser mayor que 0.'); return; }
    const validas = rows.filter((r) => (Number(r.cantidad) || 0) > 0);
    if (!validas.length) { setError('Dejá al menos un material con cantidad.'); return; }
    for (const r of validas) {
      const st = stockDe(r.producto_id, r.almacen);
      if ((Number(r.cantidad) || 0) > st) { setError(`"${r.material_nombre}" en ${r.almacen}: pedís ${num(Number(r.cantidad) || 0)} pero hay ${num(st)}.`); return; }
    }
    setSaving(true);
    try {
      const materiales: MaterialInput[] = validas.map((r) => ({
        producto_id: r.producto_id, material_nombre: r.material_nombre, almacen: r.almacen, cantidad: Number(r.cantidad) || 0,
      }));
      await editarMaterialesProduccion({ produccionId, cantidad: cant, materiales, actor, actorName });
      toast('Colada actualizada: materiales e inventario ajustados', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`✎ Editar materiales · ${tipo === 'refinacion' ? 'Refinación' : 'Colada'}`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || loading}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </>}>
      {loading ? (
        <p className="hint muted">Cargando…</p>
      ) : (
        <>
          <p className="hint muted" style={{ marginTop: 0 }}>
            Editás los materiales de <strong>{productoNombre}</strong> (orden en curso). Al guardar se <strong>revierte el consumo anterior</strong> y se consume lo nuevo; el inventario y los costos se reajustan solos.
          </p>

          <div className="form-row" style={{ maxWidth: 260 }}>
            <label>Cantidad producida</label>
            <DecimalInput className="input mono" value={cantidad} onChange={setCantidad} style={{ textAlign: 'right' }} />
          </div>

          <div className="table-wrap" style={{ marginTop: '.6rem' }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>Material</th><th>Almacén</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Stock</th><th></th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin materiales. Agregá abajo.</td></tr>}
                {rows.map((r) => {
                  const st = stockDe(r.producto_id, r.almacen);
                  const falta = r.producto_id && (Number(r.cantidad) || 0) > st;
                  return (
                    <tr key={r.key}>
                      <td><strong>{r.material_nombre}</strong>{!r.producto_id && <span className="muted"> · manual</span>}</td>
                      <td>
                        {r.producto_id ? (
                          <select className="select" value={r.almacen} onChange={(e) => setRow(r.key, { almacen: e.target.value })} style={{ fontSize: '.82rem' }}>
                            {!almacenesList.includes(r.almacen) && <option value={r.almacen}>{r.almacen}</option>}
                            {almacenesList.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}><DecimalInput className="input mono" value={r.cantidad} onChange={(n) => setRow(r.key, { cantidad: n })} style={{ width: 96, textAlign: 'right' }} /></td>
                      <td className="mono" style={{ textAlign: 'right', color: falta ? 'var(--danger)' : undefined }}>{r.producto_id ? num(st) : '∞'}</td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => delRow(r.key)} style={{ color: 'var(--danger)' }} title="Quitar">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '.6rem', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="muted" style={{ fontSize: '.82rem' }}>Agregar material:</label>
            <div style={{ minWidth: 260 }}>
              <SearchSelect value={addSel} options={opcionesAdd} placeholder="Buscar producto…" onChange={(v) => { if (v) agregar(v); }} />
            </div>
          </div>

          {error && <p style={{ color: 'var(--danger)', marginTop: '.7rem', fontWeight: 600 }}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
