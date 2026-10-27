import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import {
  SISTEMAS_REPUESTO, TIPOS_SUGERIDOS, UNIDADES_REPUESTO, separarEquivalencias, limpiarCodigo, coincideProducto,
  type DatosRepuesto, type ProductoRepuesto, type RepuestoEquipo, type SistemaRepuesto,
} from './repuestosEquipo';
import { crearRepuestoEquipo, editarRepuestoEquipo } from './repuestosEquipo.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

const errMsg = (e: unknown, def: string) => (e instanceof Error ? e.message : (e as { message?: string })?.message || def);

/**
 * Agregar (o con `renglon`, editar) un repuesto de la ficha del equipo: sistema, tipo,
 * número de parte original, equivalencias por marca, especificación, cantidad por
 * servicio, cada cuánto se cambia y el producto del inventario que le corresponde.
 */
export function RepuestoEquipoModal({ equipo, renglon, productos, actor, sistemaInicial, onClose, onSaved }: {
  equipo: MaquinariaEquipo;
  renglon?: RepuestoEquipo | null;
  productos: Map<string, ProductoRepuesto>;
  actor: string;
  sistemaInicial?: SistemaRepuesto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sistema, setSistema] = useState<SistemaRepuesto>(renglon?.sistema ?? sistemaInicial ?? 'motor');
  const [tipo, setTipo] = useState(renglon?.tipo ?? '');
  const [numeroParte, setNumeroParte] = useState(renglon?.numero_parte ?? '');
  const [equivalencias, setEquivalencias] = useState((renglon?.equivalencias ?? []).join('\n'));
  const [especificacion, setEspecificacion] = useState(renglon?.especificacion ?? '');
  const [cantidad, setCantidad] = useState<number | null>(renglon?.cantidad ?? 1);
  const [unidad, setUnidad] = useState(renglon?.unidad ?? 'und');
  const [cadaHrs, setCadaHrs] = useState<number | null>(renglon?.cada_hrs ?? null);
  const [cadaKm, setCadaKm] = useState<number | null>(renglon?.cada_km ?? null);
  const [enServicio, setEnServicio] = useState(renglon?.en_servicio ?? sistema !== 'cauchos');
  const [productoId, setProductoId] = useState(renglon?.producto_id ?? '');
  const [nota, setNota] = useState(renglon?.nota ?? '');
  const [saving, setSaving] = useState(false);

  const opciones = useMemo(() => [...productos.values()].map((p) => ({
    value: p.id, label: `${p.nombre} · ${fmtNum(p.stock)} ${p.unidad}${p.sku ? ` · ${p.sku}` : ''}`,
  })), [productos]);

  // Productos del inventario cuyo nombre trae el número de parte o alguna equivalencia.
  const sugeridos = useMemo(() => {
    if (productoId) return [];
    const codigos = [numeroParte, ...separarEquivalencias(equivalencias).map((e) => e.split(' ').pop() ?? e)]
      .map((c) => limpiarCodigo(c)).filter((c) => c.length >= 4);
    if (!codigos.length) return [];
    return [...productos.values()].filter((p) => codigos.some((c) => coincideProducto(p, c))).slice(0, 5);
  }, [productos, numeroParte, equivalencias, productoId]);

  const producto = productoId ? productos.get(productoId) ?? null : null;
  const listo = tipo.trim().length >= 2 && (cantidad ?? 0) > 0;

  function elegirSistema(s: SistemaRepuesto) {
    setSistema(s);
    if (!renglon) setEnServicio(s !== 'cauchos' && s !== 'rodaje');
  }

  async function guardar() {
    if (!listo) { toast('Indica el tipo de repuesto y la cantidad.', 'warning'); return; }
    const d: DatosRepuesto = {
      sistema, tipo: tipo.trim(), numero_parte: limpiarCodigo(numeroParte) || null,
      equivalencias: separarEquivalencias(equivalencias), especificacion: especificacion.trim() || null,
      cantidad: cantidad ?? 1, unidad: unidad.trim() || 'und', cada_hrs: cadaHrs && cadaHrs > 0 ? cadaHrs : null,
      cada_km: cadaKm && cadaKm > 0 ? cadaKm : null, en_servicio: enServicio, producto_id: productoId || null, nota: nota.trim() || null,
    };
    setSaving(true);
    try {
      if (renglon) await editarRepuestoEquipo(renglon.id, d, actor);
      else await crearRepuestoEquipo(equipo.id, d, actor);
      toast(`🔧 ${d.tipo} ${renglon ? 'actualizado' : 'agregado'} · ${equipo.equipo}`, 'success');
      onSaved();
      onClose();
    } catch (e) { toast(errMsg(e, 'No se pudo guardar el repuesto'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal title={`${renglon ? '✎ Editar repuesto' : '🔧 Agregar repuesto'} · ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !listo}>{saving ? 'Guardando…' : renglon ? 'Guardar cambios' : 'Agregar a la ficha'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <div className="flo-svc-grid flo-rep-sist" role="group" aria-label="Sistema del equipo">
          {SISTEMAS_REPUESTO.map((s) => (
            <button key={s.id} type="button" className="flo-svc" aria-pressed={sistema === s.id} onClick={() => elegirSistema(s.id)}>
              <span className="ico">{s.icon}</span><strong>{s.label}</strong>
            </button>
          ))}
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-tipo">Tipo de repuesto</label>
          <input id="rep-tipo" className="input" list="rep-tipos" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Filtro de aceite, aceite de motor, caucho delantero…" />
          <datalist id="rep-tipos">{TIPOS_SUGERIDOS[sistema].map((t) => <option key={t} value={t} />)}</datalist>
        </div>

        <div className="form-grid">
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label htmlFor="rep-np">Número de parte original</label>
            <input id="rep-np" className="input mono" value={numeroParte} onChange={(e) => setNumeroParte(e.target.value)} placeholder="17457469" />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label htmlFor="rep-spec">Especificación</label>
            <input id="rep-spec" className="input" value={especificacion} onChange={(e) => setEspecificacion(e.target.value)} placeholder="15W-40 · ISO 68 · 23.5R25 · 12 V 1000 CCA" />
          </div>
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-eq">Equivalencias por marca <span className="muted" style={{ fontWeight: 400 }}>(una por renglón)</span></label>
          <textarea id="rep-eq" className="textarea mono" rows={3} value={equivalencias} onChange={(e) => setEquivalencias(e.target.value)}
            placeholder={'DONALDSON P553771\nFLEETGUARD LF3413\nBALDWIN B236'} />
        </div>

        <div className="form-grid">
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label htmlFor="rep-cant">Cantidad por servicio</label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <DecimalInput className="input" value={cantidad} onChange={setCantidad} placeholder="1" aria-label="Cantidad por servicio" style={{ flex: 1, minWidth: 0 }} />
              <input id="rep-cant" className="input" list="rep-unidades" value={unidad} onChange={(e) => setUnidad(e.target.value)} aria-label="Unidad" style={{ width: 96 }} />
              <datalist id="rep-unidades">{UNIDADES_REPUESTO.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Cada cuánto se cambia <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <DecimalInput className="input" value={cadaHrs} onChange={setCadaHrs} placeholder="250" aria-label="Cada cuántas horas" style={{ flex: 1, minWidth: 0 }} /><span className="muted">h</span>
              <DecimalInput className="input" value={cadaKm} onChange={setCadaKm} placeholder="10.000" aria-label="Cada cuántos km" style={{ flex: 1, minWidth: 0 }} /><span className="muted">km</span>
            </div>
          </div>
        </div>

        <label style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', fontSize: '.85rem' }}>
          <input type="checkbox" checked={enServicio} onChange={(e) => setEnServicio(e.target.checked)} style={{ marginTop: '.2rem' }} />
          <span>Se cambia en <strong>cada servicio preventivo</strong>. Entra en «Qué comprar para el próximo servicio» y se marca solo al cargar la ficha en una orden de mantenimiento. Quítalo a los cauchos, baterías y piezas de desgaste.</span>
        </label>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-prod">Producto del inventario</label>
          <SearchSelect id="rep-prod" options={opciones} value={productoId} onChange={setProductoId} placeholder="Buscar por nombre, número de parte o SKU…" emptyText="No está en el inventario" />
          {producto && (
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.3rem' }}>
              <span className="muted" style={{ fontSize: '.78rem' }}>Stock: <strong>{fmtNum(producto.stock)} {producto.unidad}</strong>{producto.almacen ? ` · ${producto.almacen}` : ''}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setProductoId('')}>Quitar enlace</button>
            </div>
          )}
          {!producto && sugeridos.length > 0 && (
            <div className="flo-rep-sug">
              <span className="muted" style={{ fontSize: '.78rem' }}>¿Es alguno de estos?</span>
              {sugeridos.map((p) => (
                <button key={p.id} type="button" className="btn btn-sm" onClick={() => setProductoId(p.id)}>{p.nombre} · {fmtNum(p.stock)} {p.unidad}</button>
              ))}
            </div>
          )}
          {!producto && !sugeridos.length && <span className="muted" style={{ fontSize: '.75rem' }}>Si no está en el inventario, déjalo vacío: igual queda en la ficha y en el buscador, y en la orden entra como pieza nueva.</span>}
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="rep-nota">Nota</label>
          <input id="rep-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Posición, proveedor habitual, observaciones" />
        </div>
      </div>
    </Modal>
  );
}
