import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import { listProductosActivos } from '@/modules/pedidos/pedidos.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import {
  SISTEMAS, sistemaDe, validarRepuestoEquipo, duplicadoEnFicha, nombreRepuesto, textoCada,
  type DatosRepuestoEquipo, type RepuestoEquipo, type SistemaRepuesto,
} from './repuestosEquipo';
import { registrarRepuestoEquipo, actualizarRepuestoEquipo } from './repuestosEquipo.repository';

const UNIDADES = ['und', 'L', 'kg', 'gal', 'm', 'juego', 'par'];

/**
 * Agregar (o con `repuesto`, editar) un renglón de la ficha de repuestos del equipo:
 * sistema, qué es, número de parte original, equivalencias por marca, especificación,
 * cantidad por servicio, cada cuánto toca y el producto del inventario si existe.
 */
export function RepuestoEquipoModal({ equipo, ficha, repuesto, actor, onClose, onSaved }: {
  equipo: MaquinariaEquipo;
  /** La ficha actual del equipo (para avisar duplicados). */
  ficha: RepuestoEquipo[];
  repuesto?: RepuestoEquipo | null;
  actor: { email: string; nombre: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sistema, setSistema] = useState<SistemaRepuesto>((repuesto ? sistemaDe(repuesto.sistema).id : 'motor'));
  const [tipo, setTipo] = useState(repuesto?.tipo ?? '');
  const [numero, setNumero] = useState(repuesto?.numero_parte ?? '');
  const [equiv, setEquiv] = useState(repuesto?.equivalencias ?? '');
  const [espec, setEspec] = useState(repuesto?.especificacion ?? '');
  const [cantidad, setCantidad] = useState(repuesto ? String(repuesto.cantidad) : '1');
  const [unidad, setUnidad] = useState(repuesto?.unidad ?? 'und');
  const [cadaH, setCadaH] = useState(repuesto?.cada_horas != null ? String(repuesto.cada_horas) : '');
  const [cadaK, setCadaK] = useState(repuesto?.cada_km != null ? String(repuesto.cada_km) : '');
  const [productoId, setProductoId] = useState(repuesto?.producto_id ?? '');
  const [nota, setNota] = useState(repuesto?.nota ?? '');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { listProductosActivos().then(setProductos).catch(() => setProductos([])); }, []);

  const n = (v: string) => { const x = Number(v.replace(',', '.')); return v.trim() && Number.isFinite(x) ? x : null; };
  const opciones = useMemo<SearchOption[]>(() => [
    { value: '', label: '— Sin producto del inventario (se pide por número de parte) —' },
    ...productos.map((p) => ({
      value: p.id, label: p.nombre, hint: `${p.sku} · ${Number(p.stock) > 0 ? `${fmtNum(p.stock)} ${p.unidad}` : 'sin stock'}`,
      keywords: [p.categoria, p.nombre_busqueda ?? '', p.marca ?? '', p.numero ?? '', p.codigo ?? ''].filter(Boolean),
    })),
  ], [productos]);
  const producto = productos.find((p) => p.id === productoId) ?? null;

  const datos: DatosRepuestoEquipo = {
    sistema, tipo: tipo.trim(), numero_parte: numero.trim() || null, equivalencias: equiv.trim() || null, especificacion: espec.trim() || null,
    cantidad: n(cantidad) ?? 0, unidad: unidad.trim() || 'und', cada_horas: n(cadaH), cada_km: n(cadaK), producto_id: productoId || null, nota: nota.trim() || null,
  };
  const error = validarRepuestoEquipo(datos);
  const duplicado = !error && duplicadoEnFicha(ficha, datos, repuesto?.id);
  const meta = sistemaDe(sistema);

  // Al elegir un producto sin haber escrito qué es, el tipo toma el nombre del producto; la unidad, la del producto.
  function elegirProducto(id: string) {
    setProductoId(id);
    const p = productos.find((x) => x.id === id);
    if (p) {
      if (!tipo.trim()) setTipo(p.nombre);
      if (p.unidad && (!repuesto || unidad === 'und')) setUnidad(p.unidad);
      if (!numero.trim() && p.numero) setNumero(p.numero);
    }
  }

  async function guardar() {
    if (error) { toast(error, 'warning'); return; }
    if (duplicado) { toast('Ese repuesto ya está en la ficha de este equipo (mismo tipo y número de parte).', 'warning'); return; }
    setSaving(true);
    try {
      if (repuesto) await actualizarRepuestoEquipo(repuesto.id, datos);
      else await registrarRepuestoEquipo(equipo.id, datos, actor);
      toast(`${meta.icon} ${nombreRepuesto(datos)} ${repuesto ? 'actualizado' : 'agregado'} · ${equipo.equipo}`, 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo guardar el repuesto', 'error');
    } finally { setSaving(false); }
  }

  return (
    <Modal title={`${repuesto ? '✎ Editar repuesto' : '🔩 Agregar repuesto a la ficha'} · ${equipo.equipo}`} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !!error || duplicado}>{saving ? 'Guardando…' : repuesto ? 'Guardar cambios' : 'Agregar a la ficha'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <div className="form-row" style={{ marginBottom: 0 }}><label>Sistema</label>
          <div className="flo-opt" role="group" aria-label="Sistema">
            {SISTEMAS.map((s) => (
              <button key={s.id} type="button" className="flo-pill" aria-pressed={sistema === s.id} onClick={() => setSistema(s.id)}>{s.icon} {s.label}</button>
            ))}
          </div>
        </div>
        <div className="flo-form2">
          <div className="form-row"><label htmlFor="rep-tipo">¿Qué es?</label>
            <input id="rep-tipo" className="input" list="rep-tipos" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder={meta.tipos[0] ? `Ej.: ${meta.tipos[0]}` : 'Ej.: Filtro de aceite'} autoFocus={!repuesto} />
            <datalist id="rep-tipos">{meta.tipos.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div className="form-row"><label htmlFor="rep-num">Número de parte original</label>
            <input id="rep-num" className="input" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej.: 17457469 (VOLVO)" />
          </div>
          <div className="form-row"><label htmlFor="rep-eq">Equivalencias por marca</label>
            <input id="rep-eq" className="input" value={equiv} onChange={(e) => setEquiv(e.target.value)} placeholder="Ej.: Donaldson P553771 · Fleetguard LF3413" />
          </div>
          <div className="form-row"><label htmlFor="rep-esp">Especificación</label>
            <input id="rep-esp" className="input" value={espec} onChange={(e) => setEspec(e.target.value)} placeholder="Ej.: 15W-40 · ISO 68 · 23.5R25 · 12 V 1000 CCA" />
          </div>
          <div className="form-row"><label htmlFor="rep-cant">Cantidad por servicio</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 7rem', gap: '.4rem' }}>
              <input id="rep-cant" className="input" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              <input className="input" list="rep-unidades" value={unidad} onChange={(e) => setUnidad(e.target.value)} aria-label="Unidad" />
              <datalist id="rep-unidades">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>
            </div>
          </div>
          <div className="form-row"><label>Cada cuánto toca <span className="muted" style={{ fontWeight: 400 }}>· vacío = en todos los servicios</span></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
              <input className="input" inputMode="decimal" value={cadaH} onChange={(e) => setCadaH(e.target.value)} placeholder="horas (250, 500…)" aria-label="Cada cuántas horas" />
              <input className="input" inputMode="decimal" value={cadaK} onChange={(e) => setCadaK(e.target.value)} placeholder="km (10.000…)" aria-label="Cada cuántos km" />
            </div>
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="rep-prod">Producto del inventario <span className="muted" style={{ fontWeight: 400 }}>· si ya existe, el stock se ve en la ficha y la orden lo pide del inventario</span></label>
          <SearchSelect id="rep-prod" options={opciones} value={productoId} onChange={elegirProducto} placeholder="🔍 Buscar por nombre, SKU o número…" emptyText="No está en el inventario (se pedirá por número de parte)" />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="rep-nota">Nota</label>
          <input id="rep-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional: dónde va, cómo se pide, proveedor habitual…" />
        </div>
        {duplicado && <div className="aviso warning sm"><span className="aviso-icono">⚠️</span><div>Ese repuesto ya está en la ficha de este equipo (mismo tipo y número de parte). Edita el que existe.</div></div>}
        <VistaPrevia titulo={repuesto ? 'Se guarda así' : 'Queda en la ficha así'}>
          <Dato label="Equipo">{equipo.equipo}</Dato>
          <Dato label="Sistema">{`${meta.icon} ${meta.label}`}</Dato>
          <Dato label="Repuesto">{datos.tipo ? nombreRepuesto(datos) : undefined}</Dato>
          <Dato label="Equivalencias">{datos.equivalencias ?? undefined}</Dato>
          <Dato label="Por servicio">{datos.cantidad > 0 ? `${fmtNum(datos.cantidad)} ${datos.unidad} · ${textoCada(datos, (x) => fmtNum(x))}` : undefined}</Dato>
          <Dato label="Inventario">{producto ? `${producto.nombre} (${producto.sku}) · ${Number(producto.stock) > 0 ? `${fmtNum(producto.stock)} ${producto.unidad} en stock` : 'sin stock'}` : 'no está vinculado: se pide por número de parte'}</Dato>
        </VistaPrevia>
      </div>
    </Modal>
  );
}
