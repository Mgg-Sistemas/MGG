import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { notify } from '@/shared/lib/notify';
import { dateTime, num, dosDecimales } from '@/shared/lib/format';
import { list as listProveedores, crearProveedorRapido } from '@/modules/proveedores/proveedores.repository';
import type { Proveedor } from '@/shared/lib/types';
import { listCatalogoPedido, crearCatalogoPedido, ensureUnidadSolicitante, type CatalogoPedido } from './pedidos.repository';
import { listEquipos, type MaquinariaEquipo } from '@/modules/maquinaria/maquinariaEquipos.repository';
import { listProductosConStock, type ProductoConStock } from '@/modules/inventario/inventario.repository';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import {
  crearServicioDirecto, montarServicioDirecto, listServiciosDirectos, eliminarServicioDirecto,
  urlAdjuntoServicio, gestionarFacturasServicio, editarServicioDirectoFinalizado, esRecargaAgua, esRecarga, type ServicioDirecto, type ServicioDirectoItem, type LineaServicioInput,
} from './serviciosDirectos.repository';
import { FacturasModal } from './FacturasModal';
import { EditarMontosModal } from './EditarMontosModal';
import { DetalleDirectoModal } from './DetalleDirectoModal';
import { previewFileUrl } from '@/shared/lib/reportPreview';

type Vista = 'kanban' | 'lista';

/** Lista curada de tipos de servicio (con íconos), igual que en Nuevo Servicio. */
const TIPOS_SERVICIO: { value: string; label: string }[] = [
  { value: 'CAMBIO DE ACEITE', label: '🛢️ Cambio de aceite' },
  { value: 'CAMBIO DE FILTRO', label: '🧯 Cambio de filtro' },
  { value: 'CAMBIO DE CAUCHOS / NEUMÁTICOS', label: '🛞 Cambio de cauchos / neumáticos' },
  { value: 'REPUESTOS', label: '🛠️ Repuestos' },
  { value: 'CAMBIO DE PIEZA', label: '⚙️ Cambio de pieza' },
  { value: 'PINTURA / LATONERÍA', label: '🎨 Pintura / latonería' },
  { value: 'FRENOS', label: '🛑 Frenos' },
  { value: 'BATERÍA', label: '🔋 Batería' },
  { value: 'SISTEMA ELÉCTRICO', label: '💡 Sistema eléctrico' },
  { value: 'SISTEMA HIDRÁULICO', label: '💧 Sistema hidráulico' },
  { value: 'SOLDADURA', label: '🔥 Soldadura' },
  { value: 'SERVICIO / PREVENTIVO', label: '🔧 Servicio / preventivo' },
  { value: 'REPARACIÓN', label: '🛠️ Reparación' },
  { value: 'OTRO', label: '• Otro' },
];

/** ¿La categoría es mantenimiento de electrodomésticos? → elige un artículo de la lista. */
function esMantenimientoElectrodomestico(cat: string): boolean {
  return /electrodom/i.test(cat);
}
/** ¿El equipo es una MOTO/motocicleta? (evita falsos positivos como motoniveladora/motobomba). */
function esMoto(e: MaquinariaEquipo): boolean {
  return /\bmotos?\b|motocicleta/i.test(`${e.tipo ?? ''} ${e.equipo ?? ''}`);
}
/** Un equipo es VEHÍCULO si su tipo es carro/camión/camioneta/vehículo y NO es una moto. */
function esVehiculo(e: MaquinariaEquipo): boolean {
  return /carro|cami[oó]n|camioneta|veh[ií]culo|auto/i.test(e.tipo ?? '') && !esMoto(e);
}
/** Qué lista de equipos aplica según la categoría: motos / vehículos / maquinaria / todos. */
function tipoMantenimiento(cat: string): 'maquinaria' | 'vehiculos' | 'motos' | null {
  if (/\bmotos?\b|motocicleta/i.test(cat)) return 'motos';
  if (/veh[ií]culo/i.test(cat)) return 'vehiculos';
  if (/maquinaria|planta/i.test(cat)) return 'maquinaria';
  return null;
}
/** Filtra los equipos por el tipo de mantenimiento (motos/vehículos/maquinaria); null = todos. */
function equiposDeTipo(equipos: MaquinariaEquipo[], tipo: 'maquinaria' | 'vehiculos' | 'motos' | null): MaquinariaEquipo[] {
  if (tipo === 'motos') return equipos.filter(esMoto);
  if (tipo === 'vehiculos') return equipos.filter(esVehiculo);
  if (tipo === 'maquinaria') return equipos.filter((e) => !esVehiculo(e) && !esMoto(e));
  return equipos;
}
/** Lista base de electrodomésticos (con íconos). El usuario puede escribir uno nuevo (allowCreate). */
const ELECTRODOMESTICOS: { value: string; label: string }[] = [
  { value: 'COCINA', label: '🍳 Cocina' },
  { value: 'NEVERA', label: '🧊 Nevera' },
  { value: 'CONGELADOR', label: '🧊 Congelador' },
  { value: 'LAVADORA', label: '🧺 Lavadora' },
  { value: 'SECADORA', label: '🌀 Secadora' },
  { value: 'MICROONDAS', label: '📡 Microondas' },
  { value: 'AIRE ACONDICIONADO', label: '❄️ Aire acondicionado' },
  { value: 'VENTILADOR', label: '💨 Ventilador' },
  { value: 'TELEVISOR', label: '📺 Televisor' },
  { value: 'LICUADORA', label: '🥤 Licuadora' },
  { value: 'CAFETERA', label: '☕ Cafetera' },
  { value: 'FREIDORA', label: '🍟 Freidora' },
  { value: 'CALENTADOR / TERMO', label: '🚿 Calentador / termo' },
  { value: 'CAMPANA EXTRACTORA', label: '🌫️ Campana extractora' },
  { value: 'LAVAPLATOS', label: '🍽️ Lavaplatos' },
  { value: 'PLANCHA', label: '👕 Plancha' },
  { value: 'OTRO', label: '• Otro electrodoméstico' },
];

const COLS: { key: ServicioDirecto['estado']; label: string }[] = [
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'por_pagar', label: 'Por pagar' },
  { key: 'finalizada', label: 'Finalizada' },
];
const ESTADO_LABEL: Record<string, string> = { en_proceso: '⏳ En proceso', por_pagar: '💸 Por pagar', finalizada: '🏁 Finalizada' };

function montoCaja(n: number | null | undefined, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

export function ServicioDirectoView({ actor, actorName }: { actor: string; actorName?: string | null }) {
  const [servicios, setServicios] = useState<ServicioDirecto[]>([]);
  const [categorias, setCategorias] = useState<CatalogoPedido[]>([]);
  const [tipos, setTipos] = useState<CatalogoPedido[]>([]);
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [vista, setVista] = useState<Vista>('kanban');
  const [crear, setCrear] = useState(false);
  const [finalizar, setFinalizar] = useState<ServicioDirecto | null>(null);
  const [eliminar, setEliminar] = useState<ServicioDirecto | null>(null);
  const [facturas, setFacturas] = useState<ServicioDirecto | null>(null);
  const [editarMontos, setEditarMontos] = useState<ServicioDirecto | null>(null);
  const [detalle, setDetalle] = useState<ServicioDirecto | null>(null);

  // Solo la lista (los datos del equipo/proveedor van denormalizados en la fila):
  // una mutación o un evento realtime de servicios_directos pide UNA consulta.
  const reloadLista = useCallback(async () => {
    setServicios(await listServiciosDirectos().catch(() => [] as ServicioDirecto[]));
  }, []);

  // Catálogos del formulario (categorías, tipos, equipos, cajas, proveedores): casi
  // estáticos; se cargan al entrar y solo se refrescan si cambian en su origen.
  const reloadCatalogos = useCallback(async () => {
    const [cats, tps, eqs, provs] = await Promise.all([
      listCatalogoPedido('servicio_categoria', true).catch(() => [] as CatalogoPedido[]),
      listCatalogoPedido('servicio_tipo', true).catch(() => [] as CatalogoPedido[]),
      listEquipos().catch(() => [] as MaquinariaEquipo[]),
      listProveedores().catch(() => [] as Proveedor[]),
    ]);
    setCategorias(cats); setTipos(tps);
    setEquipos(eqs.filter((e) => e.activo));
    setProveedores(provs.filter((p) => p.estado === 'activo'));
  }, []);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    Promise.all([reloadLista(), reloadCatalogos()]).catch(() => { /* RLS/red */ }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reloadLista, reloadCatalogos]);

  // Realtime: la lista solo depende de servicios_directos; proveedores/equipos solo
  // alimentan el formulario de alta.
  useRealtime(['servicios_directos'], () => { void reloadLista(); });
  useRealtime(['proveedores', 'maquinaria_equipos'], () => { void reloadCatalogos(); });

  const porEstado = useMemo(() => {
    const m: Record<string, ServicioDirecto[]> = { en_proceso: [], finalizada: [] };
    servicios.forEach((s) => { (m[s.estado] ??= []).push(s); });
    return m;
  }, [servicios]);

  async function handlePdf(s: ServicioDirecto) {
    try { const { descargarServicioDirectoPdf } = await import('./servicioDirectoPdf'); await descargarServicioDirectoPdf(s); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmarEliminar() {
    const s = eliminar;
    if (!s) return;
    setEliminar(null);
    try { await eliminarServicioDirecto(s); toast('Servicio directo eliminado', 'success'); await reloadLista(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="filterbar" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" onClick={() => setCrear(true)}>+ Nuevo servicio directo</button>
        <div className="view-toggle" role="tablist" aria-label="Modo de vista">
          <button className={vista === 'kanban' ? 'active' : ''} onClick={() => setVista('kanban')}>▦ Kanban</button>
          <button className={vista === 'lista' ? 'active' : ''} onClick={() => setVista('lista')}>☰ Lista</button>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando servicios directos..." icon="◔" />
      ) : !servicios.length ? (
        <EmptyState message="Sin servicios directos. Creá el primero con “+ Nuevo servicio directo”." icon="🛠" />
      ) : vista === 'kanban' ? (
        <div className="kanban">
          {COLS.map((col) => (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-head"><strong>{col.label}</strong><span className="badge">{porEstado[col.key]?.length ?? 0}</span></div>
              <div className="kanban-col-body">
                {(porEstado[col.key] ?? []).map((s) => (
                  <ServicioCard key={s.id} servicio={s} onVer={() => setDetalle(s)} onFinalizar={() => setFinalizar(s)} onPdf={() => handlePdf(s)} onFacturas={() => setFacturas(s)} onEditarMontos={() => setEditarMontos(s)} onEliminar={() => setEliminar(s)} />
                ))}
                {!(porEstado[col.key] ?? []).length && <div className="muted" style={{ padding: '.5rem' }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Código</th><th>Servicio(s)</th><th>Equipo</th><th>Proveedor</th><th>Estado</th><th>Monto</th><th>Generó</th><th>Creado</th><th>Pagado</th><th></th></tr></thead>
            <tbody>
              {servicios.map((s) => (
                <tr key={s.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => setDetalle(s)} title="Ver el detalle">
                  <td className="mono">{s.codigo ?? '—'}</td>
                  <td>{s.descripcion}{s.items.length > 1 ? <span className="muted"> · {s.items.length} ítems</span> : null}</td>
                  <td>{s.equipo_nombre || '—'}</td>
                  <td>{s.proveedor_nombre || '—'}</td>
                  <td>{ESTADO_LABEL[s.estado] ?? s.estado}</td>
                  <td className="mono">{s.gasto != null ? montoCaja(s.gasto, s.moneda) : '—'}</td>
                  <td>{s.actor_name || s.actor || '—'}</td>
                  <td className="muted">{dateTime(s.created_at)}</td>
                  <td className="muted">{s.finalizada_at ? dateTime(s.finalizada_at) : '—'}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-ghost" onClick={() => handlePdf(s)} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
                    {s.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setEditarMontos(s)} title="Editar montos (sincroniza Tesorería)">✎ Editar</button>}
                    {s.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={() => setFacturas(s)} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
                    {s.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={() => setFinalizar(s)}>Cargar factura y monto</button>}
                    {s.estado === 'por_pagar' && <button className="btn btn-sm btn-ghost" onClick={() => setFinalizar(s)} title="Editar factura/monto (en Tesorería para pagar)">✎ Factura/monto</button>}
                    {/* Un servicio directo FINALIZADO no se puede eliminar (registro definitivo). */}
                    {s.estado !== 'finalizada' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setEliminar(s)} title="Eliminar servicio directo">🗑</button>}
                    {(s.estado === 'finalizada' || s.estado === 'por_pagar') && <AdjuntoLink servicio={s} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crear && (
        <CrearServicioModal categorias={categorias} tipos={tipos} equipos={equipos} proveedores={proveedores}
          actor={actor} actorName={actorName} onClose={() => setCrear(false)} onSaved={async () => { setCrear(false); await Promise.all([reloadLista(), reloadCatalogos()]); }} />
      )}
      {finalizar && (
        <MontarServicioModal servicio={finalizar} actor={actor} actorName={actorName}
          onClose={() => setFinalizar(null)} onSaved={async () => { setFinalizar(null); await reloadLista(); }} />
      )}
      {eliminar && (
        <ConfirmDialog title="Eliminar servicio directo"
          message={`¿Eliminar el servicio directo ${eliminar.codigo ? `${eliminar.codigo} · ` : ''}"${eliminar.descripcion}"? Los repuestos tomados del inventario se devuelven. Esta acción no se puede deshacer.`}
          confirmText="Eliminar" danger onConfirm={confirmarEliminar} onCancel={() => setEliminar(null)} />
      )}
      {facturas && (
        <FacturasModal
          title={`Facturas · ${facturas.codigo ?? 'Servicio directo'}`}
          facturas={facturas.facturas}
          urlFor={urlAdjuntoServicio}
          onSave={async (nuevos, quitar) => { await gestionarFacturasServicio(facturas, nuevos, quitar); await reloadLista(); }}
          onClose={() => setFacturas(null)}
        />
      )}

      {editarMontos && (
        <EditarMontosModal
          title={`Editar montos · ${editarMontos.codigo ?? 'Servicio directo'}`}
          moneda={editarMontos.moneda}
          editarMoneda
          rows={editarMontos.items.map((it) => ({ nombre: it.descripcion, cantidad: it.cantidad, gasto: Number(it.gasto) || 0 }))}
          pagoExterno={editarMontos.pago_externo}
          pagoExternoDatos={editarMontos.pago_externo_datos}
          nota={editarMontos.nota ?? ''}
          onSave={async (gastos, extra) => {
            const items = editarMontos.items.map((it, i) => ({ ...it, gasto: gastos[i] ?? 0 }));
            await editarServicioDirectoFinalizado({ servicio: editarMontos, items, actor, actorName, pagoExterno: extra.pagoExterno, pagoExternoDatos: extra.pagoExternoDatos, nota: extra.nota, moneda: extra.moneda });
            await reloadLista();
          }}
          onClose={() => setEditarMontos(null)}
        />
      )}

      {detalle && (
        <DetalleDirectoModal
          title={`Servicio directo · ${detalle.codigo ?? ''}`}
          estadoLabel={ESTADO_LABEL[detalle.estado] ?? detalle.estado}
          ficha={[
            ['Equipo', detalle.equipo_nombre || '—'],
            ['Proveedor / taller', detalle.proveedor_nombre || '—'],
            ...(detalle.solicitante ? [['Unidad solicitante', detalle.solicitante] as [string, string]] : []),
            ...(detalle.solicitante_persona ? [['Quién lo solicita', detalle.solicitante_persona] as [string, string]] : []),
            ['Generó', detalle.actor_name || detalle.actor || '—'],
            ['Creado', dateTime(detalle.created_at)],
            ['Pagado', detalle.finalizada_at ? dateTime(detalle.finalizada_at) : '—'],
          ]}
          itemsTitle="Servicios"
          items={detalle.items.map((it) => ({ nombre: it.descripcion, cantidad: it.cantidad, gasto: it.gasto }))}
          moneda={detalle.moneda}
          total={detalle.gasto}
          nota={detalle.nota}
          pagoExterno={detalle.pago_externo ? (detalle.pago_externo_datos ?? '') : null}
          facturas={detalle.facturas}
          urlFor={urlAdjuntoServicio}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDetalle(null)}>Cerrar</button>
              <button className="btn btn-ghost" onClick={() => handlePdf(detalle)}>↓ PDF</button>
              {detalle.estado === 'finalizada' && <button className="btn btn-ghost" onClick={() => { setFacturas(detalle); setDetalle(null); }}>🧾 Facturas</button>}
              {detalle.estado === 'finalizada' && <button className="btn btn-primary" onClick={() => { setEditarMontos(detalle); setDetalle(null); }}>✎ Editar montos</button>}
              {detalle.estado === 'en_proceso' && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>Cargar factura y monto</button>}
              {detalle.estado === 'por_pagar' && <button className="btn btn-primary" onClick={() => { setFinalizar(detalle); setDetalle(null); }}>✎ Editar factura/monto</button>}
            </>
          }
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}

function ServicioCard({ servicio, onVer, onFinalizar, onPdf, onFacturas, onEditarMontos, onEliminar }: { servicio: ServicioDirecto; onVer: () => void; onFinalizar: () => void; onPdf: () => void; onFacturas: () => void; onEditarMontos: () => void; onEliminar: () => void }) {
  return (
    <div className="card" style={{ margin: 0, cursor: 'pointer' }} onClick={onVer} title="Ver el detalle">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
        <strong>{servicio.descripcion}</strong>
        <span className="badge">{num(servicio.cantidad)}</span>
      </div>
      {servicio.codigo && <div className="muted mono" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>{servicio.codigo}</div>}
      {servicio.equipo_nombre && <div className="muted" style={{ fontSize: '.78rem', marginTop: '.25rem' }}>🚜 {servicio.equipo_nombre}</div>}
      {servicio.proveedor_nombre && <div className="muted" style={{ fontSize: '.74rem' }}>🏭 {servicio.proveedor_nombre}</div>}
      {servicio.items.length > 1 && (
        <ul className="muted" style={{ fontSize: '.72rem', margin: '.35rem 0 0', paddingLeft: '1rem' }}>
          {servicio.items.map((it, i) => <li key={i}>{it.descripcion} · {num(it.cantidad)}</li>)}
        </ul>
      )}
      <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem', lineHeight: 1.5 }}>
        <div>Generó: <strong style={{ color: 'var(--text)' }}>{servicio.actor_name || servicio.actor || '—'}</strong></div>
        <div>Creado: {dateTime(servicio.created_at)}</div>
        {servicio.estado === 'finalizada' && <div>Pagado: {servicio.finalizada_at ? dateTime(servicio.finalizada_at) : '—'}</div>}
      </div>
      {servicio.estado === 'por_pagar' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Por pagar: <strong className="mono">{servicio.gasto != null ? montoCaja(servicio.gasto, servicio.moneda) : '—'}</strong></div>
          <div className="muted" style={{ fontSize: '.72rem' }}>💸 En Tesorería para pagar</div>
          <div className="muted"><AdjuntoLink servicio={servicio} /></div>
        </div>
      )}
      {servicio.estado === 'finalizada' && (
        <div style={{ fontSize: '.8rem', marginTop: '.4rem' }}>
          <div>Monto: <strong className="mono">{servicio.gasto != null ? montoCaja(servicio.gasto, servicio.moneda) : '—'}</strong></div>
          {servicio.pagada_por && <div className="muted" style={{ fontSize: '.72rem' }}>Pagó: {servicio.pagada_por}</div>}
          <div className="muted"><AdjuntoLink servicio={servicio} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-ghost" onClick={onPdf} title="Ver detalle en PDF (vista previa)">↓ PDF</button>
        {servicio.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onEditarMontos} title="Editar montos (sincroniza Tesorería)">✎ Editar</button>}
        {servicio.estado === 'finalizada' && <button className="btn btn-sm btn-ghost" onClick={onFacturas} title="Cargar nuevas facturas / quitar anteriores">🧾 Facturas</button>}
        {servicio.estado === 'en_proceso' && <button className="btn btn-sm btn-primary" onClick={onFinalizar}>Cargar factura y monto</button>}
        {servicio.estado === 'por_pagar' && <button className="btn btn-sm btn-ghost" onClick={onFinalizar} title="Editar factura/monto (en Tesorería para pagar)">✎ Factura/monto</button>}
        {/* Un servicio directo FINALIZADO no se puede eliminar (registro definitivo). */}
        {servicio.estado !== 'finalizada' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onEliminar} title="Eliminar">🗑 Eliminar</button>}
      </div>
    </div>
  );
}

function AdjuntoLink({ servicio }: { servicio: ServicioDirecto }) {
  if (!servicio.adjunto_path) return <span className="muted">— sin factura</span>;
  async function abrir() {
    try { await previewFileUrl(await urlAdjuntoServicio(servicio.adjunto_path as string), servicio.adjunto_nombre ?? 'factura'); }
    catch { toast('No se pudo abrir la factura', 'error'); }
  }
  return <button className="btn btn-sm btn-ghost" onClick={abrir} title={servicio.adjunto_nombre ?? 'Factura'}>📎 Factura</button>;
}

/* ───────── Modal: nuevo servicio directo (varios servicios) ───────── */

interface LineaUI { id: number; categoria: string; tipo: string; equipoId: string; electro: string; cantidad: string; bombonas: string; kg: string; productoId: string; productoCant: string }

function CrearServicioModal({ categorias, tipos, equipos, proveedores, actor, actorName, onClose, onSaved }: {
  categorias: CatalogoPedido[]; tipos: CatalogoPedido[]; equipos: MaquinariaEquipo[]; proveedores: Proveedor[];
  actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const nuevaLinea = (id: number): LineaUI => ({ id, categoria: '', tipo: '', equipoId: '', electro: '', cantidad: '1', bombonas: '', kg: '', productoId: '', productoCant: '1' });
  const [lineas, setLineas] = useState<LineaUI[]>([nuevaLinea(1)]);
  const [productos, setProductos] = useState<ProductoConStock[]>([]);
  useEffect(() => { listProductosConStock().then(setProductos).catch(() => setProductos([])); }, []);
  const [provModo, setProvModo] = useState<'existente' | 'nuevo'>('existente');
  const [proveedorId, setProveedorId] = useState('');
  const [provNombre, setProvNombre] = useState('');
  const [provRif, setProvRif] = useState('');
  const [solicitante, setSolicitante] = useState('');
  const [solicitantePersona, setSolicitantePersona] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(2);

  // Unidad solicitante: desplegable desde el catálogo + alta al vuelo (igual que en Servicio/OP).
  const [unidadesSol, setUnidadesSol] = useState<string[]>([]);
  const [nuevaUnidad, setNuevaUnidad] = useState('');
  const [addingUnidad, setAddingUnidad] = useState(false);
  useEffect(() => {
    listCatalogoPedido('unidad_solicitante', true)
      .then((rows) => setUnidadesSol(rows.map((r) => r.nombre)))
      .catch(() => setUnidadesSol([]));
  }, []);
  async function handleAddUnidad() {
    const n = nuevaUnidad.trim();
    if (!n) { toast('Escribí el nombre de la unidad', 'error'); return; }
    const existente = unidadesSol.find((u) => u.toLowerCase() === n.toLowerCase());
    if (existente) { setSolicitante(existente); setNuevaUnidad(''); toast(`La unidad "${existente}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingUnidad(true);
    try {
      await crearCatalogoPedido('unidad_solicitante', n, actor);
      setUnidadesSol((prev) => [...prev, n].sort((a, b) => a.localeCompare(b, 'es')));
      setSolicitante(n);
      setNuevaUnidad('');
      toast(`Unidad "${n}" agregada al catálogo`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar la unidad', 'error'); }
    finally { setAddingUnidad(false); }
  }

  const tipoOptions = useMemo(() => [
    ...TIPOS_SERVICIO,
    ...tipos.filter((t) => !TIPOS_SERVICIO.some((x) => x.value === t.nombre.trim().toUpperCase())).map((t) => ({ value: t.nombre.toUpperCase(), label: t.nombre })),
  ], [tipos]);

  function set(id: number, patch: Partial<LineaUI>) { setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l))); }
  function add() { setLineas((ls) => [...ls, nuevaLinea(seq)]); setSeq((s) => s + 1); }
  function quitar(id: number) { setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls)); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const payload: LineaServicioInput[] = [];
    for (const l of lineas) {
      if (!l.categoria.trim()) { setError('Indicá la categoría del servicio en cada renglón.'); return; }
      const aguaCat = esRecargaAgua(l.categoria);
      const recargaCat = esRecarga(l.categoria);
      const bombonas = recargaCat ? (Number(l.bombonas) || 0) : 0;
      const kgTotal = recargaCat ? Math.round(bombonas * (Number(l.kg) || 0) * 100) / 100 : null;
      const cant = recargaCat ? bombonas : (Number(l.cantidad) || 0);
      if (cant <= 0) { setError(recargaCat ? (aguaCat ? 'Indicá la cantidad (botellones o cisternas; 1 si es una cisterna).' : 'Indicá la cantidad de bombonas.') : 'Cada servicio debe tener cantidad mayor que 0.'); return; }
      const esElectro = esMantenimientoElectrodomestico(l.categoria);
      const eq = !esElectro ? (equipos.find((x) => x.id === l.equipoId) ?? null) : null;
      // Electrodoméstico: se guarda como nombre del "equipo" servido, sin equipoId (no es del Control de Maquinaria).
      const electroNombre = esElectro ? l.electro.trim() : '';
      if (esElectro && !electroNombre) { setError('Elegí el electrodoméstico al que se le hace el mantenimiento.'); return; }
      // Repuesto del inventario (solo mantenimiento): si eligió producto, se valida y descuenta.
      const prod = !recargaCat && l.productoId ? productos.find((p) => p.id === l.productoId) ?? null : null;
      const prodCant = prod ? (Number(l.productoCant) || 0) : 0;
      if (prod && prodCant <= 0) { setError(`Indicá cuántas unidades de "${prod.nombre}" se toman del inventario.`); return; }
      if (prod && prodCant > prod.stock) { setError(`Solo hay ${prod.stock} ${prod.unidad} de "${prod.nombre}" en el inventario.`); return; }
      payload.push({
        servicioCategoria: l.categoria, servicioTipo: l.tipo || null, equipoId: esElectro ? null : (l.equipoId || null), equipoNombre: esElectro ? electroNombre : (eq?.equipo ?? null),
        cantidad: cant, bombonas: recargaCat ? bombonas : null, kgRecarga: kgTotal,
        productoId: prod?.id ?? null, productoNombre: prod?.nombre ?? null,
        productoCantidad: prod ? prodCant : null, productoAlmacen: prod?.almacen ?? null,
      });
    }
    setSaving(true);
    try {
      let proveedorId2: string | null = null;
      let proveedorNombre: string | null = null;
      if (provModo === 'nuevo' && provNombre.trim()) {
        const prov = await crearProveedorRapido(provNombre, provRif);
        proveedorId2 = prov.id; proveedorNombre = prov.razon_social;
      } else if (provModo === 'existente' && proveedorId) {
        proveedorId2 = proveedorId; proveedorNombre = proveedores.find((p) => p.id === proveedorId)?.razon_social ?? null;
      }
      if (solicitante.trim()) { try { await ensureUnidadSolicitante(solicitante, actor); } catch { /* ya existe */ } }
      await crearServicioDirecto({ lineas: payload, proveedorId: proveedorId2, proveedorNombre, solicitante: solicitante || null, solicitantePersona: solicitantePersona || null, actor, actorName });
      notify(`Servicio directo creado · ${payload.length} servicio(s)${proveedorNombre ? ` · ${proveedorNombre}` : ''}`, 'success', { link: '#/app/pedidos' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo crear el servicio directo.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="sd-form" className="btn btn-primary" disabled={saving}>{saving ? 'Creando…' : 'Crear servicio directo'}</button>
    </>
  );

  return (
    <Modal title="Nuevo servicio directo" size="lg" onClose={onClose} footer={footer}>
      <form id="sd-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Proveedor / taller */}
        <div className="form-row">
          <label>Proveedor / taller (opcional)</label>
          <div className="view-toggle" role="tablist" style={{ margin: '0 0 .4rem' }}>
            <button type="button" className={provModo === 'existente' ? 'active' : ''} onClick={() => setProvModo('existente')}>🔎 Existente</button>
            <button type="button" className={provModo === 'nuevo' ? 'active' : ''} onClick={() => setProvModo('nuevo')}>＋ Nuevo</button>
          </div>
          {provModo === 'existente' ? (
            <SearchSelect value={proveedorId} onChange={setProveedorId}
              options={proveedores.map((p) => ({ value: p.id, label: `${p.razon_social}${p.rif ? ` · ${p.rif}` : ''}` }))}
              placeholder="🔎 Buscá el proveedor / taller…" emptyText="Sin proveedores. Usá ＋ Nuevo." style={{ maxWidth: 420 }} />
          ) : (
            <div className="form-grid">
              <div className="form-row" style={{ margin: 0 }}><label>Razón social</label><input className="input" value={provNombre} onChange={(e) => setProvNombre(e.target.value)} placeholder="Taller / razón social" /></div>
              <div className="form-row" style={{ margin: 0 }}><label>RIF</label><input className="input" value={provRif} onChange={(e) => setProvRif(e.target.value.toUpperCase())} placeholder="J-12345678-9" /></div>
            </div>
          )}
        </div>

        {/* Quién solicita */}
        <div className="form-grid">
          <div className="form-row">
            <label>Unidad solicitante (opcional)</label>
            <SearchSelect
              value={solicitante}
              onChange={setSolicitante}
              options={unidadesSol.map((u) => ({ value: u, label: u }))}
              placeholder="Departamento / unidad que solicita"
              emptyText="Sin unidades en el catálogo. Agregá una abajo."
            />
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="¿No está? Escribí la unidad nueva…"
                value={nuevaUnidad}
                onChange={(e) => setNuevaUnidad(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddUnidad(); } }}
                maxLength={60}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleAddUnidad()} disabled={addingUnidad}>
                {addingUnidad ? 'Añadiendo…' : '+ Añadir'}
              </button>
            </div>
            <small className="muted" style={{ fontSize: '.72rem' }}>La unidad nueva queda guardada en el catálogo (Categorías → Unidad solicitante).</small>
          </div>
          <div className="form-row"><label>Quién lo solicita (opcional)</label><input className="input" value={solicitantePersona} onChange={(e) => setSolicitantePersona(e.target.value)} placeholder="Nombre de la persona" /></div>
        </div>

        <div className="form-row"><label>Servicios</label><small className="muted">Podés agregar <strong>varios servicios de distinto tipo</strong> (mantenimiento, recarga de gas/agua, electrodoméstico…). Categoría + tipo + equipo. Los montos se cargan al finalizar (con la factura).</small></div>

        {lineas.map((l, idx) => (
          <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.5rem' }}>
              {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitar(l.id)} title="Quitar servicio">✕ Quitar servicio #{idx + 1}</button>}
            </div>
            <div className="form-grid">
              <div className="form-row">
                <label>Categoría del servicio #{idx + 1} <span style={{ color: 'var(--danger)' }}>*</span></label>
                <SearchSelect allowCreate value={l.categoria} onChange={(v) => set(l.id, { categoria: v.toUpperCase() })}
                  options={categorias.map((c) => ({ value: c.nombre.toUpperCase(), label: c.nombre }))}
                  placeholder="🔎 Buscá o escribí (mantenimiento de vehículos…)" emptyText="Escribí una nueva." />
              </div>
              {/* En recarga (gas/oxígeno/extintores/AGUA) solo se pide cantidad y medida: sin tipo ni equipo. */}
              {esRecarga(l.categoria) ? (
                <div className="form-row">
                  <label>{esRecargaAgua(l.categoria) ? '🚰 Botellones / cisternas (cantidad)' : '🛢️ Cantidad de bombonas'}</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.bombonas} onChange={(e) => set(l.id, { bombonas: e.target.value })} placeholder={esRecargaAgua(l.categoria) ? 'N° de botellones/cisternas (1 = cisterna)' : 'N° de bombonas'} required />
                </div>
              ) : (
                <div className="form-row">
                  <label>Tipo de servicio</label>
                  <SearchSelect allowCreate value={l.tipo} onChange={(v) => set(l.id, { tipo: v.toUpperCase() })}
                    options={tipoOptions}
                    placeholder="🔎 Elegí el tipo (caucho, aceite, pintura…)" emptyText="Escribí uno nuevo." />
                </div>
              )}
            </div>
            {esRecarga(l.categoria) ? (
              <div className="form-grid">
                <div className="form-row">
                  <label>{esRecargaAgua(l.categoria) ? '💧 Litros por unidad' : '⚖️ KG por bombona'}</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.kg} onChange={(e) => set(l.id, { kg: e.target.value })} placeholder={esRecargaAgua(l.categoria) ? 'Litros de cada uno' : 'Kg de cada una'} />
                </div>
                <div className="form-row">
                  <label>Total recarga</label>
                  <div className="card mono" style={{ margin: 0, padding: '.45rem .7rem', fontWeight: 700 }}>
                    {esRecargaAgua(l.categoria)
                      ? <>{Math.round((Number(l.bombonas) || 0) * (Number(l.kg) || 0) * 100) / 100} L de agua{(Number(l.bombonas) || 0) > 1 ? ` · ${(Number(l.bombonas) || 0)} und` : ''}</>
                      : <>{(Number(l.bombonas) || 0)} bombona(s) · {Math.round((Number(l.bombonas) || 0) * (Number(l.kg) || 0) * 100) / 100} KG</>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                {esMantenimientoElectrodomestico(l.categoria) ? (
                  <div className="form-row">
                    <label>Electrodoméstico</label>
                    <SearchSelect allowCreate value={l.electro} onChange={(v) => set(l.id, { electro: v.toUpperCase() })}
                      options={ELECTRODOMESTICOS}
                      placeholder="🔎 Elegí (cocina, nevera, lavadora, microondas…)" emptyText="Escribí uno nuevo." />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Artículo electrodoméstico al que se le hace el mantenimiento.</small>
                  </div>
                ) : (
                  (() => {
                    const mantTipo = tipoMantenimiento(l.categoria);
                    const equiposLista = equiposDeTipo(equipos, mantTipo);
                    const lbl = mantTipo === 'motos' ? 'Moto (Control de Motos)' : mantTipo === 'vehiculos' ? 'Vehículo (Control de Vehículos)' : 'Equipo (Control de Maquinaria)';
                    const ph = mantTipo === 'motos' ? '🔎 Buscá la moto…' : mantTipo === 'vehiculos' ? '🔎 Buscá el vehículo…' : '🔎 Buscá el equipo / vehículo…';
                    const empty = mantTipo === 'motos' ? 'Sin motos registradas.' : mantTipo === 'vehiculos' ? 'Sin vehículos.' : 'Sin equipos.';
                    return (
                  <div className="form-row">
                    <label>{lbl}</label>
                    <SearchSelect value={l.equipoId} onChange={(v) => set(l.id, { equipoId: v })}
                      options={equiposLista.map((e) => ({ value: e.id, label: `${e.equipo}${e.placa ? ` · ${e.placa}` : ''}` }))}
                      placeholder={ph} emptyText={empty} />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Vincula el servicio al equipo (aparece en Control de Mantenimiento).</small>
                  </div>
                    );
                  })()
                )}
                <div className="form-row"><label>Cantidad</label><input className="input mono" type="number" min={1} step="any" value={l.cantidad} onChange={(e) => set(l.id, { cantidad: e.target.value })} required /></div>
              </div>
            )}
            {/* Repuesto del inventario (mantenimiento): si el repuesto está en stock, se toma de ahí.
               No aplica a recargas (gas/agua). */}
            {!esRecarga(l.categoria) && (() => {
              const prod = l.productoId ? productos.find((p) => p.id === l.productoId) ?? null : null;
              return (
                <div className="form-grid">
                  <div className="form-row">
                    <label>Repuesto del inventario</label>
                    <SearchSelect value={l.productoId} onChange={(v) => set(l.id, { productoId: v })}
                      options={productos.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku} · stock ${num(p.stock)} ${p.unidad}${p.almacen ? ` · ${p.almacen}` : ''}` }))}
                      placeholder="🔎 Buscá el repuesto (caucho, filtro…) si sale del inventario" emptyText="Sin productos con stock." />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Si el repuesto está en el inventario, se descuenta del stock al crear el servicio. Dejalo en blanco si no aplica.</small>
                  </div>
                  {prod && (() => {
                    const enTope = (Number(l.productoCant) || 0) >= prod.stock;
                    return (
                    <div className="form-row">
                      <label>Cantidad a tomar del inventario</label>
                      <input className="input mono" type="number" min={1} step="any" max={prod.stock}
                        value={l.productoCant}
                        onChange={(e) => {
                          const v = e.target.value;
                          set(l.id, { productoCant: (Number(v) || 0) > prod.stock ? String(prod.stock) : v });
                        }} />
                      <small className="muted" style={{ fontSize: '.72rem', color: enTope ? 'var(--warning)' : undefined }}>
                        Disponible: {num(prod.stock)} {prod.unidad}{prod.almacen ? ` · ${prod.almacen}` : ''}{enTope ? ' · tope alcanzado' : ''}.
                      </small>
                    </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        ))}

        <button type="button" className="btn btn-ghost" style={{ width: '100%', borderStyle: 'dashed' }} onClick={add}>＋ Agregar otro servicio (puede ser de otro tipo)</button>
        <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>En este método no se cargan montos al crear. La factura, el monto y la caja se indican al finalizar.</p>
      </form>
    </Modal>
  );
}

/* ───────── Modal: montar (analista carga factura + montos → POR PAGAR) ───────── */

function MontarServicioModal({ servicio, actor, actorName, onClose, onSaved }: {
  servicio: ServicioDirecto; actor: string; actorName?: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [gastos, setGastos] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    servicio.items.forEach((it, i) => { if (it.gasto != null && Number(it.gasto) > 0) init[i] = String(it.gasto); });
    return init;
  });
  const [file, setFile] = useState<File | null>(null);
  const [nota, setNota] = useState(servicio.nota ?? '');
  // Moneda del servicio ($ o Bs): el monto está en esta moneda.
  const [moneda, setModeda] = useState<'USD' | 'Bs'>(servicio.moneda === 'Bs' ? 'Bs' : 'USD');
  // Conversión de moneda a la tasa (BCV del día o la que ponga el usuario).
  const [tasaConv, setTasaConv] = useState('');
  const [tasaBcv, setTasaBcv] = useState(0);
  useEffect(() => { getTasaHoy().then((t) => { const v = Number(t.usd) || 0; if (v > 0) { setTasaBcv(v); setTasaConv((p) => p || String(v)); } }).catch(() => { /* sin tasa */ }); }, []);
  // Pago a externo: una persona externa YA pagó el servicio; Tesorería le reintegra al pagar.
  const [pagoExterno, setPagoExterno] = useState(!!servicio.pago_externo);
  const [pagoExternoDatos, setPagoExternoDatos] = useState(servicio.pago_externo_datos ?? '');
  // Con abonos (a crédito): Tesorería lo salda con abonos (cuenta por pagar) en vez de pago completo.
  const [conAbonos, setConAbonos] = useState(!!servicio.con_abonos);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => Math.round(servicio.items.reduce((a, _it, i) => a + (Number(gastos[i]) || 0), 0) * 100) / 100, [gastos, servicio.items]);

  // Convierte los montos cargados a la otra moneda ($↔Bs) a la tasa y cambia la moneda.
  function convertirMoneda() {
    const r = Number(tasaConv) || 0;
    if (r <= 0) { setError('Colocá la tasa (Bs por $) para convertir.'); return; }
    const toBs = moneda === 'USD';
    const conv = (n: number) => Math.round((toBs ? n * r : n / r) * 100) / 100;
    setGastos((m) => {
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(m)) { const n = Number(v) || 0; out[Number(k)] = n > 0 ? String(conv(n)) : v; }
      return out;
    });
    setModeda(toBs ? 'Bs' : 'USD');
    setError(null);
    toast(`Montos convertidos a ${toBs ? 'Bs' : '$'} a la tasa ${r.toLocaleString('es-VE')}`, 'success');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (total <= 0) { setError('Indicá cuánto costó cada servicio.'); return; }
    if (file && file.type && file.type !== 'application/pdf' && !file.type.startsWith('image/')) { setError('La factura debe ser un PDF o una imagen.'); return; }
    if (pagoExterno && !pagoExternoDatos.trim()) { setError('Ingresá los datos de la persona externa que pagó (para reintegrarle).'); return; }
    const items: ServicioDirectoItem[] = servicio.items.map((it, i) => ({ ...it, gasto: Number(gastos[i]) || 0 }));
    setSaving(true);
    try {
      await montarServicioDirecto({ servicio, items, file, actor, actorName, pagoExterno, pagoExternoDatos, nota, moneda, conAbonos });
      notify(`Servicio enviado a Tesorería · ${montoCaja(total, moneda)} por pagar`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo enviar el servicio a Tesorería.'); setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="sd-fin-form" className="btn btn-primary" disabled={saving}>{saving ? 'Enviando…' : `Enviar a Tesorería · ${montoCaja(total, moneda)}`}</button>
    </>
  );

  return (
    <Modal title="Cargar factura y monto del servicio" size="lg" onClose={onClose} footer={footer}>
      <form id="sd-fin-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
          Cargá los <strong>montos por servicio</strong> y la <strong>factura</strong>. El servicio queda <strong>Por pagar</strong> y aparece en <strong>Tesorería</strong>; cuando ahí se pague, el monto sale de la caja y se finaliza (queda casado al equipo en Control de Mantenimiento). La <strong>categoría de gasto la elige Tesorería al pagar</strong>.
        </p>

        {/* Moneda del servicio: los montos se cargan en esta moneda ($ o Bs). */}
        <div className="form-row">
          <label>Moneda del servicio</label>
          <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
            <button type="button" className={moneda === 'USD' ? 'active' : ''} onClick={() => setModeda('USD')}>$ Dólares</button>
            <button type="button" className={moneda === 'Bs' ? 'active' : ''} onClick={() => setModeda('Bs')}>Bs Bolívares</button>
          </div>
          <small className="muted">Los montos se cargan en esta moneda. Tesorería la ve al pagar.</small>
          {/* Convertir los montos a la otra moneda a la tasa (del día o la que ponga el usuario). */}
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.45rem' }}>
            <span className="muted" style={{ fontSize: '.78rem' }}>Tasa (Bs/$)</span>
            <input className="input mono" type="number" min={0} step="any" style={{ maxWidth: 140 }} value={tasaConv} onChange={(e) => setTasaConv(e.target.value)} placeholder="0,00" />
            {tasaBcv > 0 && Number(tasaConv) !== tasaBcv && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTasaConv(String(tasaBcv))}>↻ Hoy ({tasaBcv.toLocaleString('es-VE')})</button>}
            <button type="button" className="btn btn-sm btn-primary" onClick={convertirMoneda}>⇄ Convertir a {moneda === 'USD' ? 'Bs' : '$'}</button>
          </div>
          <small className="muted">Convierte los montos cargados a {moneda === 'USD' ? 'Bs' : '$'} a esa tasa. El total convertido es el que va a Tesorería.</small>
        </div>

        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Servicio</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ width: 160 }}>Monto</th><th style={{ textAlign: 'right' }}>Costo unit.</th></tr></thead>
            <tbody>
              {servicio.items.map((it, i) => {
                const g = Number(gastos[i]) || 0;
                const cu = it.cantidad > 0 && g > 0 ? g / it.cantidad : 0;
                return (
                  <tr key={i}>
                    <td>{it.descripcion}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td>
                    <td><input className="input mono" type="number" min={0} step="any" value={gastos[i] ?? ''} onChange={(e) => setGastos((m) => ({ ...m, [i]: dosDecimales(e.target.value) }))} placeholder="0,00" /></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ margin: '.5rem 0' }}>Total por pagar: <strong className="mono">{montoCaja(total, moneda)}</strong></div>

        <div className="form-row">
          <label>Adjuntar FACTURA del servicio · PDF o imagen</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? <small className="muted">{file.name}</small> : (servicio.facturas?.length ? <small className="muted">Ya hay {servicio.facturas.length} factura(s) cargada(s).</small> : null)}
        </div>

        <div className="form-row">
          <label>Nota / motivo <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo o detalle del servicio (aparece en el detalle, en Tesorería y en el PDF)." />
          <small className="muted">Tesorería la lee al momento de pagar.</small>
        </div>

        {/* Pago a externo: una persona externa YA pagó; MGG debe reintegrarle. Lo ve Tesorería al pagar. */}
        <div className="form-row" style={{ borderTop: '1px solid var(--border,#3a3a3a)', paddingTop: '.8rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={pagoExterno} onChange={(e) => setPagoExterno(e.target.checked)} />
            <span>💳 Pago a externo <span className="muted" style={{ fontWeight: 400 }}>(lo pagó otra persona; hay que reintegrarle)</span></span>
          </label>
          {pagoExterno && (
            <div style={{ marginTop: '.5rem' }}>
              <label>Datos de la persona externa que pagó <span style={{ color: 'var(--danger)' }}>*</span></label>
              <textarea className="input" rows={2} value={pagoExternoDatos} onChange={(e) => setPagoExternoDatos(e.target.value)}
                placeholder="Nombre, C.I. / RIF, teléfono, y cómo reintegrarle (cuenta / pago móvil)…" />
              <small className="muted">Aparece en el detalle y en Tesorería: al pagar, el egreso reintegra el dinero a esta persona.</small>
            </div>
          )}
        </div>

        {/* Con abonos (a crédito): Tesorería lo salda con abonos (cuenta por pagar) en vez de pago completo. */}
        <div className="form-row" style={{ borderTop: '1px solid var(--border,#3a3a3a)', paddingTop: '.8rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={conAbonos} onChange={(e) => setConAbonos(e.target.checked)} />
            <span>🧾 Pagar con abonos (a crédito) <span className="muted" style={{ fontWeight: 400 }}>(genera una Cuenta por Pagar que Tesorería salda por partes)</span></span>
          </label>
          {conAbonos && (
            <small className="muted" style={{ marginTop: '.3rem' }}>Al recibirlo, Tesorería no lo paga completo: crea una <strong>Cuenta por Pagar</strong> por el total y la va <strong>abonando</strong>. Tesorería también puede marcarlo/desmarcarlo al momento.</small>
          )}
        </div>
      </form>
    </Modal>
  );
}
