/* ============================================================
   MGG · Editar una colada/refinación EN CURSO (todo):
   - Cantidad producida, mano de obra.
   - Materiales: cambiar cantidades, quitar y agregar (ej. corregir un coque
     con nombre/stock equivocado). Al guardar, el repositorio revierte el consumo
     anterior (sin tocar el PMP) y consume los nuevos, recalculando costos.
   - Reporte de colada (MGG-FR-001): identificación, big bags/ley, proceso,
     temperaturas, observaciones, lingotes y escoria (para fundición).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import type { Existencia, Producto, ColadaDatos } from '@/shared/lib/types';
import {
  getProduccionConMateriales, editarMaterialesProduccion,
  type ProduccionTipo, type MaterialInput,
} from './produccion.repository';
import { ColadaCampos } from './ColadaCampos';
import { getColada, actualizarColadaDatos, actualizarColadaCabecera, coladaDatosVacios, getConsumoBigBags } from './colada.repository';
import { listCasiteritaDetalle, type CasiteritaDetalle } from '@/modules/inventario/casiteritaDetalle.repository';

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
  const [manoObra, setManoObra] = useState<number | null>(null);
  const [sumarInventario, setSumarInventario] = useState(true);
  const [productoNombre, setProductoNombre] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSel, setAddSel] = useState('');

  // Reporte de colada (solo fundición con reporte). Si no hay colada, esColada = false.
  const [esColada, setEsColada] = useState(false);
  const [coladaDatos, setColadaDatos] = useState<ColadaDatos>(coladaDatosVacios());
  const [coladaNum, setColadaNum] = useState('');
  const [coladaFecha, setColadaFecha] = useState('');
  const [casiteritaDetalle, setCasiteritaDetalle] = useState<CasiteritaDetalle[]>([]);
  const [consumoBigBags, setConsumoBigBags] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancel = false;
    (async () => {
      const p = await getProduccionConMateriales(produccionId);
      if (cancel) return;
      if (!p) { setError('Orden no encontrada.'); return; }
      setProductoNombre(p.producto_nombre ?? '');
      setCantidad(Number(p.cantidad) || null);
      setManoObra(Number(p.mano_obra) || null);
      setSumarInventario(p.sumar_inventario !== false);
      setRows((p.materiales ?? []).map((m, i) => ({
        key: `m${i}`, producto_id: m.producto_id ?? null, material_nombre: m.material_nombre,
        almacen: m.almacen, cantidad: Number(m.cantidad) || null,
      })));
      // Reporte de colada (fundición).
      if (tipo === 'fundicion') {
        const [col, det, cons] = await Promise.all([
          getColada(produccionId),
          listCasiteritaDetalle().catch(() => [] as CasiteritaDetalle[]),
          getConsumoBigBags(produccionId).catch(() => new Map<string, number>()),
        ]);
        if (cancel) return;
        if (col) {
          setEsColada(true);
          setColadaDatos({ ...coladaDatosVacios(), ...(col.datos ?? {}) });
          setColadaNum(col.colada_num != null ? String(col.colada_num) : '');
          setColadaFecha(col.fecha ?? '');
          setCasiteritaDetalle(det);
          setConsumoBigBags(cons);
        }
      }
    })().catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : 'Error al cargar'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [produccionId, tipo]);

  const stockDe = (pid: string | null, alm: string): number =>
    !pid ? Infinity : Number(existencias.find((e) => e.producto_id === pid && e.almacen === alm)?.stock) || 0;

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

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
      await editarMaterialesProduccion({ produccionId, cantidad: cant, manoObra: manoObra ?? undefined, sumarInventario, materiales, actor, actorName });
      // Reporte de colada: guarda todo el detalle + cabecera (Colada N° / fecha).
      if (esColada) {
        await actualizarColadaDatos(produccionId, coladaDatos);
        const nCol = Number(coladaNum);
        await actualizarColadaCabecera(produccionId, { colada_num: Number.isFinite(nCol) && nCol > 0 ? nCol : undefined, fecha: coladaFecha || undefined });
      }
      toast('Colada actualizada: materiales, inventario y reporte ajustados', 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`✎ Editar ${tipo === 'refinacion' ? 'refinación' : 'colada'} (completo)`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || loading}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </>}>
      {loading ? (
        <p className="hint muted">Cargando…</p>
      ) : (
        <>
          <p className="hint muted" style={{ marginTop: 0 }}>
            Editás <strong>{productoNombre}</strong> (orden en curso). Al guardar se <strong>revierte el consumo anterior</strong> y se consume lo nuevo; el inventario, los costos y el reporte se reajustan solos.
          </p>

          <div className="form-grid">
            <div className="form-row" style={{ maxWidth: 220 }}>
              <label>Cantidad producida</label>
              <DecimalInput className="input mono" value={cantidad} onChange={setCantidad} style={{ textAlign: 'right' }} />
            </div>
            <div className="form-row" style={{ maxWidth: 220 }}>
              <label>Mano de obra ($)</label>
              <DecimalInput className="input mono" value={manoObra} onChange={setManoObra} style={{ textAlign: 'right' }} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', margin: '.2rem 0 .2rem', cursor: 'pointer', fontSize: '.86rem' }}>
            <input type="checkbox" checked={sumarInventario} onChange={(e) => setSumarInventario(e.target.checked)} />
            <span><strong>Sumar al inventario</strong> al finalizar <span className="muted" style={{ fontSize: '.76rem' }}>· si lo destildás, queda como registro/reporte y NO suma stock del producto</span></span>
          </label>

          <div className="card-title" style={{ marginTop: '.8rem' }}>Materiales (consumo de inventario)</div>
          <div className="table-wrap">
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

          {esColada && (
            <div style={{ marginTop: '1rem', borderTop: '2px dashed var(--border)', paddingTop: '.8rem' }}>
              <div className="card-title" style={{ marginBottom: '.4rem' }}>🔥 Reporte de colada (MGG-FR-001)</div>
              <ColadaCampos
                coladaNum={coladaNum} setColadaNum={setColadaNum}
                fecha={coladaFecha} setFecha={setColadaFecha}
                datos={coladaDatos} setDatos={setColadaDatos}
                casiteritaDetalle={casiteritaDetalle} consumoBigBags={consumoBigBags}
              />
            </div>
          )}

          {error && <p style={{ color: 'var(--danger)', marginTop: '.7rem', fontWeight: 600 }}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
