/* ============================================================
   MGG · Editar una colada/refinación EN CURSO (todo):
   - Cantidad producida, mano de obra.
   - Materiales: cambiar cantidades, quitar y agregar (ej. corregir un coque
     con nombre/stock equivocado). Al guardar, el repositorio revierte el consumo
     anterior (sin tocar el PMP) y consume los nuevos, recalculando costos.
   - Reporte de colada (MGG-FR-001): identificación, big bags/ley, proceso,
     temperaturas, observaciones, lingotes y escoria (para fundición).
   - Reporte de refinación (MGG-FR-002): identificación, orígenes del estaño
     crudo (coladas / 2ª refinación / manual), parámetros, etapas y jornada
     (para refinación). Las líneas de crudo de la orden se rearman desde los
     orígenes elegidos, y el inventario se devuelve y se vuelve a bajar.
   - Horno / olla, almacén destino y costos indirectos (ambos tipos).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { almacenDeFundicion } from './almacenFundicion';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import type { Existencia, Producto, ColadaDatos, RefinacionDatos } from '@/shared/lib/types';
import {
  getProduccionConMateriales, editarMaterialesProduccion,
  type ProduccionTipo, type MaterialInput,
} from './produccion.repository';
import { ColadaCampos } from './ColadaCampos';
import { RefinacionCampos } from './RefinacionCampos';
import { AlmacenSelectAgrupado } from '@/modules/inventario/AlmacenPicker';
import {
  getRefinacion, actualizarRefinacionDatos, actualizarRefinacionCabecera, refinacionDatosVacios,
  listColadasFinalizadas, listRefinacionesFinalizadas, type ColadaFinalizada,
} from './refinacion.repository';
import { getColada, actualizarColadaDatos, actualizarColadaCabecera, coladaDatosVacios, getConsumoBigBags } from './colada.repository';
import { CASITERITA_ALMACEN, SKU_CASITERITA, listCasiteritaDetalle, type CasiteritaDetalle } from '@/modules/inventario/casiteritaDetalle.repository';
import { findBySku } from '@/modules/inventario/inventario.repository';
import { lineaCasiterita } from './consumoCasiterita';

interface Row {
  key: string; producto_id: string | null; material_nombre: string; almacen: string; cantidad: number | null;
  /**
   * El material salió del PISO DE FUNDICIÓN: ya se descontó del inventario
   * cuando se hizo su salida. Tiene que viajar en la edición: si se pierde,
   * al guardar se vuelve a descontar y el inventario queda corto.
   */
  desde_fundicion: boolean;
  /**
   * La línea SÍ baja del inventario (el estaño crudo que la refinación toma de
   * las coladas). También viaja: si se pierde, al guardar la devolución queda
   * hecha y el nuevo descuento no, y el estaño reaparece en el almacén.
   */
  siempre_descuenta: boolean;
  /** Override del costo unitario. Sin esto, la orden se re-costea sola al PMP. */
  costo: number | null;
}

export function EditarMaterialesModal({
  produccionId, tipo = 'fundicion', productos, existencias, almacenesMatanza = [], almacenesList = [], hornosList = [], actor, actorName, onClose, onSaved,
}: {
  produccionId: string;
  tipo?: ProduccionTipo;
  productos: Producto[];
  existencias: Existencia[];
  /** Almacenes de MATANZA: de ahí sale el material de la colada, siempre. */
  almacenesMatanza?: string[];
  /** Todos los almacenes, para elegir el destino del producto terminado. */
  almacenesList?: string[];
  /** Hornos activos, para el desplegable de horno / olla. */
  hornosList?: string[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esRef = tipo === 'refinacion';
  const [rows, setRows] = useState<Row[]>([]);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const [manoObra, setManoObra] = useState<number | null>(null);
  const [costosIndirectos, setCostosIndirectos] = useState<number | null>(null);
  const [horno, setHorno] = useState('');
  const [almacenDestino, setAlmacenDestino] = useState('');
  const [sumarInventario, setSumarInventario] = useState(true);
  const [productoNombre, setProductoNombre] = useState('');

  // Reporte de refinación (MGG-FR-002): se edita entero, orígenes incluidos.
  const [refDatos, setRefDatos] = useState<RefinacionDatos>(refinacionDatosVacios());
  const [refNum, setRefNum] = useState('');
  const [refFecha, setRefFecha] = useState('');
  const [origenesRef, setOrigenesRef] = useState<ColadaFinalizada[]>([]);
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
  /** Ficha de casiterita: su línea de material se rearma desde los big bags al guardar. */
  const [fichaCasiterita, setFichaCasiterita] = useState<string | null>(null);
  /** Lo que ESTA orden ya tiene consumido, por producto+almacén. */
  const [yaConsumido, setYaConsumido] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancel = false;
    (async () => {
      const p = await getProduccionConMateriales(produccionId);
      if (cancel) return;
      if (!p) { setError('Orden no encontrada.'); return; }
      setProductoNombre(p.producto_nombre ?? '');
      setCantidad(Number(p.cantidad) || null);
      setManoObra(Number(p.mano_obra) || null);
      setCostosIndirectos(Number(p.costos_indirectos) || null);
      setHorno(p.horno ?? '');
      setAlmacenDestino(p.almacen_destino ?? '');
      setSumarInventario(p.sumar_inventario !== false);
      setRows((p.materiales ?? [])
        // En refinación, el estaño crudo no se edita en esta tabla: se rearma
        // desde los ORÍGENES del reporte (abajo), igual que la casiterita de la
        // colada se rearma desde sus big bags.
        .filter((m) => !(esRef && (m as { siempre_descuenta?: boolean | null }).siempre_descuenta === true))
        .map((m, i) => ({
          key: `m${i}`, producto_id: m.producto_id ?? null, material_nombre: m.material_nombre,
          almacen: m.almacen, cantidad: Number(m.cantidad) || null,
          // Estos dos viajan aunque el formulario no los muestre: son del material,
          // no de la pantalla, y perderlos descuenta inventario de más.
          desde_fundicion: m.desde_fundicion === true,
          siempre_descuenta: (m as { siempre_descuenta?: boolean | null }).siempre_descuenta === true,
          costo: m.costo_unitario == null ? null : Number(m.costo_unitario),
        })));
      // Reporte de colada (fundición).
      // El stock de hoy YA tiene descontado lo que esta orden consumió. Si no se
      // devuelve para la revisión, editar una colada sin cambiarle nada se
      // rechaza sola por «stock insuficiente» de su propio material.
      const descontaba = p.descontar_inventario !== false;
      const devuelto = new Map<string, number>();
      for (const m of p.materiales ?? []) {
        if (!m.producto_id || m.desde_fundicion === true) continue;
        // En una carga vieja lo único que se descontó fue la casiterita, así que
        // es lo único que hay para devolver.
        const siempre = (m as { siempre_descuenta?: boolean | null }).siempre_descuenta === true;
        if (!descontaba && !siempre) continue;
        const k = `${m.producto_id}|${m.almacen}`;
        devuelto.set(k, (devuelto.get(k) ?? 0) + (Number(m.cantidad) || 0));
      }
      setYaConsumido(devuelto);
      if (tipo === 'fundicion') {
        const [col, det, cons, ficha] = await Promise.all([
          getColada(produccionId),
          listCasiteritaDetalle().catch(() => [] as CasiteritaDetalle[]),
          getConsumoBigBags(produccionId).catch(() => new Map<string, number>()),
          findBySku(SKU_CASITERITA).catch(() => null),
        ]);
        if (cancel) return;
        setFichaCasiterita(ficha?.id ?? null);
        if (col) {
          setEsColada(true);
          setColadaDatos({ ...coladaDatosVacios(), ...(col.datos ?? {}) });
          setColadaNum(col.colada_num != null ? String(col.colada_num) : '');
          setColadaFecha(col.fecha ?? '');
          setCasiteritaDetalle(det);
          setConsumoBigBags(cons);
        }
      } else {
        // Refinación: el reporte entero + los orígenes que puede elegir. Las
        // listas excluyen ESTA orden: lo que ella ya tomó vuelve a contar como
        // disponible (se devuelve y se vuelve a bajar al guardar).
        const [ref, coladas, refinados] = await Promise.all([
          getRefinacion(produccionId),
          listColadasFinalizadas(produccionId).catch(() => [] as ColadaFinalizada[]),
          listRefinacionesFinalizadas(produccionId).catch(() => [] as ColadaFinalizada[]),
        ]);
        if (cancel) return;
        setOrigenesRef([...coladas, ...refinados]);
        if (ref) {
          setRefDatos({ ...refinacionDatosVacios(), ...(ref.datos ?? {}) });
          setRefNum(ref.refinacion_num != null ? String(ref.refinacion_num) : '');
          setRefFecha(ref.fecha ?? '');
        }
      }
    })().catch((e) => { if (!cancel) setError(e instanceof Error ? e.message : 'Error al cargar'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [produccionId, tipo, esRef]);

  // Refinación: líneas de crudo según los orígenes elegidos (coladas, 2ª
  // refinación o manual). Es lo mismo que hace el modal de inicio.
  const crudoLines = useMemo(
    () => (esRef ? (refDatos.coladas ?? []).filter((c) => (c.producto_id || c.origen === 'manual') && (Number(c.estano_kg) || 0) > 0) : []),
    [esRef, refDatos.coladas],
  );
  const crudoKg = useMemo(() => Math.round(crudoLines.reduce((a, c) => a + (Number(c.estano_kg) || 0), 0) * 100) / 100, [crudoLines]);
  // En refinación la cantidad de la orden ES el crudo cargado (al finalizar se
  // reemplaza por el estaño refinado obtenido).
  useEffect(() => { if (esRef && !loading) setCantidad(crudoKg > 0 ? crudoKg : null); }, [esRef, loading, crudoKg]);

  const stockDe = (pid: string | null, alm: string): number => {
    if (!pid) return Infinity;
    const hay = Number(existencias.find((e) => e.producto_id === pid && e.almacen === alm)?.stock) || 0;
    // Más lo que esta misma orden tiene tomado y se le devuelve al guardar.
    return hay + (yaConsumido.get(`${pid}|${alm}`) ?? 0);
  };

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const delRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const opcionesAdd = useMemo(() => {
    const usados = new Set(rows.map((r) => r.producto_id).filter(Boolean));
    // Los dados de baja no existen: no se pueden meter en una producción.
    return productos.filter((p) => p.estado === 'activo' && !usados.has(p.id)).map((p) => ({ value: p.id, label: `${p.nombre}${p.stock != null ? ` · ${num(p.stock)} en stock` : ''}` }));
  }, [productos, rows]);

  function agregar(pid: string) {
    const p = productos.find((x) => x.id === pid);
    if (!p) return;
    const alm = almacenDeFundicion(p.id, existencias, almacenesMatanza);
    // Un material agregado a mano sale del inventario: no viene del piso de
    // fundición y no trae un costo propio que respetar.
    setRows((rs) => [...rs, { key: `n${rs.length}-${pid}`, producto_id: p.id, material_nombre: p.nombre, almacen: alm, cantidad: null, desde_fundicion: false, siempre_descuenta: false, costo: null }]);
    setAddSel('');
  }

  async function guardar() {
    setError(null);
    const cant = Number(cantidad) || 0;
    if (cant <= 0) { setError('La cantidad producida debe ser mayor que 0.'); return; }
    const validas = rows.filter((r) => (Number(r.cantidad) || 0) > 0);
    if (!validas.length && !(esRef && crudoLines.length)) { setError('Dejá al menos un material con cantidad.'); return; }
    if (esRef && !crudoLines.length) { setError('Elegí al menos un origen del estaño a refinar (o cargá material manual).'); return; }
    // No se topa contra el stock (29-09-2026): editar una colada tampoco mueve
    // inventario —`editarMaterialesProduccion` lo dice y lo cumple—, así que
    // exigir existencia solo impedía corregir el dato. El exceso se sigue
    // marcando en rojo en la columna «Stock».
    setSaving(true);
    try {
      // La línea de casiterita no se edita a mano: se rearma desde los big bags
      // del reporte, que son los que mandan. Si acá se dejara la vieja, cambiar
      // una bolsa movería el reporte y no el inventario.
      const materiales: MaterialInput[] = validas
        .filter((r) => !(esColada && fichaCasiterita && r.producto_id === fichaCasiterita))
        .map((r) => ({
          producto_id: r.producto_id, material_nombre: r.material_nombre, almacen: r.almacen, cantidad: Number(r.cantidad) || 0,
          desde_fundicion: r.desde_fundicion, siempre_descuenta: r.siempre_descuenta, costo: r.costo,
        }));
      if (esColada) {
        const lineaCas = lineaCasiterita(coladaDatos.big_bags, fichaCasiterita, CASITERITA_ALMACEN);
        if (lineaCas) materiales.unshift(lineaCas);
      }
      // Refinación: el crudo se rearma desde los orígenes elegidos, a su costo
      // de colada, y marcado para descontar (el repositorio devuelve lo viejo
      // y baja lo nuevo). Los manuales entran solo al costo.
      if (esRef) {
        materiales.unshift(...crudoLines.map((c) => ({
          producto_id: c.producto_id ?? null,
          material_nombre: c.origen === 'refinacion'
            ? `Estaño a refinar · ${c.etiqueta ?? `Refinación #${c.colada_num || 's/n'}`}`
            : c.origen === 'manual'
              ? (c.etiqueta?.trim() || 'Material manual')
              : `Estaño crudo · ${c.etiqueta ?? `Colada #${c.colada_num || 's/n'}`}`,
          almacen: c.almacen,
          cantidad: Number(c.estano_kg) || 0,
          costo: Number(c.costo_unitario) || 0,
          siempre_descuenta: !!c.producto_id,
        })));
      }
      if (!materiales.length) { setError('Dejá al menos un material con cantidad.'); setSaving(false); return; }
      const nRef = Number(refNum);
      await editarMaterialesProduccion({
        produccionId, cantidad: cant, manoObra: manoObra ?? undefined, costosIndirectos: costosIndirectos ?? undefined,
        sumarInventario, descontarInventario: false, materiales, actor, actorName,
        horno, almacenDestino,
        etiquetaKardex: esRef ? `Refinación${Number.isFinite(nRef) && nRef > 0 ? ` #${nRef}` : ''}` : null,
      });
      // Reporte de colada: guarda todo el detalle + cabecera (Colada N° / fecha).
      if (esColada) {
        await actualizarColadaDatos(produccionId, coladaDatos);
        const nCol = Number(coladaNum);
        await actualizarColadaCabecera(produccionId, { colada_num: Number.isFinite(nCol) && nCol > 0 ? nCol : undefined, fecha: coladaFecha || undefined });
      }
      // Reporte de refinación: todo el detalle + cabecera (N° / fecha).
      if (esRef) {
        await actualizarRefinacionDatos(produccionId, {
          ...refDatos, estano_crudo_kg: crudoKg || null,
          destino_almacen: almacenDestino || refDatos.destino_almacen,
        });
        await actualizarRefinacionCabecera(produccionId, { refinacion_num: Number.isFinite(nRef) && nRef > 0 ? nRef : undefined, fecha: refFecha || undefined });
      }
      toast(`${esRef ? 'Refinación' : 'Colada'} actualizada: materiales, inventario y reporte ajustados`, 'success');
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
              <label>{esRef ? 'Estaño crudo cargado (kg)' : 'Cantidad producida'}</label>
              <DecimalInput className="input mono" value={cantidad} onChange={setCantidad} style={{ textAlign: 'right' }} disabled={esRef} />
              {esRef && <small className="hint muted" style={{ fontSize: '.7rem' }}>Σ de los orígenes elegidos abajo</small>}
            </div>
            <div className="form-row" style={{ maxWidth: 220 }}>
              <label>Mano de obra ($)</label>
              <DecimalInput className="input mono" value={manoObra} onChange={setManoObra} style={{ textAlign: 'right' }} />
            </div>
            <div className="form-row" style={{ maxWidth: 220 }}>
              <label>Costos indirectos ($)</label>
              <DecimalInput className="input mono" value={costosIndirectos} onChange={setCostosIndirectos} style={{ textAlign: 'right' }} />
            </div>
            <div className="form-row" style={{ maxWidth: 260 }}>
              <label>{esRef ? 'Olla / horno de refinación' : 'Horno'}</label>
              <select className="select" value={horno} onChange={(e) => setHorno(e.target.value)}>
                <option value="">— Sin horno —</option>
                {/* El horno actual se conserva aunque ya no esté activo en el catálogo. */}
                {horno && !hornosList.includes(horno) && <option value={horno}>{horno}</option>}
                {hornosList.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ maxWidth: 320 }}>
              <label>Almacén destino</label>
              <AlmacenSelectAgrupado value={almacenDestino} onChange={setAlmacenDestino} extraNombres={almacenesList} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '.45rem', margin: '.2rem 0 .2rem', cursor: 'pointer', fontSize: '.86rem' }}>
            <input type="checkbox" checked={sumarInventario} onChange={(e) => setSumarInventario(e.target.checked)} />
            <span><strong>Sumar al inventario</strong> al finalizar <span className="muted" style={{ fontSize: '.76rem' }}>· si lo destildás, queda como registro/reporte y NO suma stock del producto</span></span>
          </label>

          <div className="muted" style={{ fontSize: '.78rem', margin: '0 0 .2rem', lineHeight: 1.6 }}>
            📦 <strong>Los materiales son el registro de lo que se usó, no una salida.</strong> Editarlos recalcula el costo
            pero <strong>no mueve inventario</strong>, así que podés cargar más de lo que figura en «Stock».
            {esColada && <> La <strong>casiterita de los big bags</strong> es la excepción: se descuenta del Inventario Detallado.</>}
            {esRef && <> El <strong>estaño crudo de las coladas</strong> es la excepción: se descuenta del almacén; se edita en <strong>«Material a procesar»</strong>, más abajo.</>}
          </div>

          <div className="card-title" style={{ marginTop: '.8rem' }}>{esRef ? 'Reactivos / insumos' : 'Materiales (consumo de inventario)'}</div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>Material</th><th>Sale de</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Stock</th><th></th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin materiales. Agregá abajo.</td></tr>}
                {rows.map((r) => {
                  const st = stockDe(r.producto_id, r.almacen);
                  const falta = r.producto_id && (Number(r.cantidad) || 0) > st;
                  return (
                    <tr key={r.key}>
                      <td><strong>{r.material_nombre}</strong>{!r.producto_id && <span className="muted"> · manual</span>}</td>
                      <td>
                        {r.producto_id ? <span title="El material de una colada sale siempre de Matanza">🏭 {r.almacen}</span> : <span className="muted">—</span>}
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
                fase="edicion"
                coladaNum={coladaNum} setColadaNum={setColadaNum}
                fecha={coladaFecha} setFecha={setColadaFecha}
                datos={coladaDatos} setDatos={setColadaDatos}
                casiteritaDetalle={casiteritaDetalle} consumoBigBags={consumoBigBags}
              />
            </div>
          )}

          {esRef && (
            <div style={{ marginTop: '1rem', borderTop: '2px dashed var(--border)', paddingTop: '.8rem' }}>
              <div className="card-title" style={{ marginBottom: '.4rem' }}>⚗️ Reporte de refinación (MGG-FR-002)</div>
              <RefinacionCampos
                refinacionNum={refNum} setRefinacionNum={setRefNum}
                fecha={refFecha} setFecha={setRefFecha}
                datos={refDatos} setDatos={setRefDatos}
                coladasFin={origenesRef}
                materialesReceta={rows.filter((r) => (Number(r.cantidad) || 0) > 0).map((r) => ({ nombre: r.material_nombre }))}
              />
            </div>
          )}

          {error && <p style={{ color: 'var(--danger)', marginTop: '.7rem', fontWeight: 600 }}>{error}</p>}
        </>
      )}
    </Modal>
  );
}
