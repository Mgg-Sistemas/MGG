import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { norm } from '@/shared/lib/texto';
import { num as fmtNum } from '@/shared/lib/format';
import { listProductosActivos } from '@/modules/pedidos/pedidos.repository';
import { buscarProductosParecidos, type ProductoParecido } from '@/modules/inventario/inventario.repository';
import { CategoriaProductoSelect } from '@/modules/inventario/CategoriaProductoSelect';
import type { Producto } from '@/shared/lib/types';
import {
  SERVICIOS, URGENCIAS, intervencionesDe, ajustarIntervenciones, ESTADOS_EQUIPO, ORDEN_ESTADOS, decidirRepuesto, efectoOrden, servicioPorId, sugerirServicio, trabajosDe, etiquetaServicio, CATEGORIA_REPUESTOS, categoriaFijaEnTelefono,
  repuestosEditables, type AvisoServicio, type TonoFlota,
} from './flota';
import {
  crearOrdenServicio, editarOrdenServicio, solicitarSalidaDeOrden, solicitarCompraDeOrden, notificarComprasPiezasNuevas, faltaSalida, faltaCompra,
  type OrdenServicio,
} from './flota.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { FotosNuevaOrden, FotosOrden } from './FotosOrdenServicio';
import { useFotosLocales } from './useFotosLocales';
import { subirFotosOrden } from './osFotos.repository';
import { tocaEnServicio, proximoServicioNominal, nombreRepuesto, type RepuestoEquipo } from './repuestosEquipo';
import { listRepuestosEquipo } from './repuestosEquipo.repository';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { mensajeSolicitudServicio } from './mensajeMaquinaria';

interface Linea {
  productoId: string | null; nombre: string; unidad: string; cantidad: number; stock: number; almacen: string | null;
  /** Pieza nueva: categoría con la que se da de alta en el inventario al pedir la compra. */
  categoria?: string;
}

const REPUESTOS_RAPIDOS = [
  { nombre: 'FILTRO DE ACEITE', unidad: 'und', icon: '🛢️' },
  { nombre: 'FILTRO DE AIRE', unidad: 'und', icon: '🌬️' },
  { nombre: 'FILTRO DE COMBUSTIBLE', unidad: 'und', icon: '⛽' },
  { nombre: 'ACEITE DE MOTOR 15W-40', unidad: 'L', icon: '💧' },
  { nombre: 'ACEITE HIDRÁULICO 68', unidad: 'L', icon: '⚙️' },
  { nombre: 'PASTILLAS DE FRENO', unidad: 'juego', icon: '🛑' },
  { nombre: 'BATERÍA', unidad: 'und', icon: '🔋' },
  { nombre: 'CORREA DE ALTERNADOR', unidad: 'und', icon: '➰' },
  { nombre: 'GRASA ROJA', unidad: 'kg', icon: '🧈' },
  { nombre: 'REFRIGERANTE', unidad: 'gal', icon: '🧊' },
];

/** Lo que importa para saber si los repuestos cambiaron al editar. */
const firmaRepuestos = (ls: { producto_id: string | null; nombre: string; cantidad: number }[]) =>
  JSON.stringify(ls.map((l) => [l.producto_id ?? null, l.producto_id ? '' : l.nombre, Number(l.cantidad)]));

const PASOS = ['Servicio', 'Repuestos', 'Confirmar'];

function Chip({ tono, children }: { tono: TonoFlota; children: React.ReactNode }) {
  return <span className={`flo-chip tone-${tono}`}>{children}</span>;
}

/** Lo que decide cada repuesto, en vivo: del inventario, parcial o a compra. */
function Decision({ l }: { l: Linea }) {
  const d = decidirRepuesto(l.cantidad, l.productoId ? l.stock : 0);
  const a = l.cantidad > 0 ? (d.desdeInventario / l.cantidad) * 100 : 0;
  return (
    <div className="flo-decision">
      <div className="bar" aria-hidden="true"><i className="a" style={{ width: `${a}%` }} /><i className="b" style={{ width: `${100 - a}%` }} /></div>
      {d.tipo === 'stock' && <Chip tono="success">📦 Sale del inventario · quedan {fmtNum(l.stock - d.desdeInventario)}</Chip>}
      {d.tipo === 'parcial' && <><Chip tono="success">📦 {fmtNum(d.desdeInventario)} del inventario</Chip><Chip tono="warning">🛒 {fmtNum(d.aComprar)} a compra</Chip></>}
      {d.tipo === 'compra' && <Chip tono="warning">🛒 {l.productoId ? 'Sin stock · va a compra' : 'Pieza nueva · va a compra'}</Chip>}
    </div>
  );
}

/**
 * Asistente de la orden de servicio (3 pasos). Al crear:
 *  1. la base guarda la orden y decide el origen de cada repuesto con el stock real;
 *  2. si el usuario tiene permiso de Salidas, se pide la salida de inventario (por aprobar);
 *  3. lo que falta entra a Pedidos como solicitud de pedido (la crea la base con el permiso
 *     de Maquinaria); las piezas que no están en el inventario se dan de alta con stock 0
 *     en la categoría elegida (12/10/2026).
 * Lo que no se pueda pedir queda «por solicitar» en la orden.
 *
 * Con `orden` es el mismo asistente para EDITARLA: los repuestos solo se cambian mientras
 * no empezó el trabajo y no tiene salida ni pedido (después se corrigen allá); las fotos
 * se cambian en la misma ventana y lo que haya que pedir se genera desde la orden.
 */
export function OrdenServicioModal({
  equipo, horometro, kilometraje, aviso, puedeSalidas, actor, orden, onClose, onCreated,
}: {
  equipo: MaquinariaEquipo; horometro: number | null; kilometraje: number | null; aviso: AvisoServicio | null;
  /** Ya no decide nada: la solicitud de pedido la crea la base con el permiso de Maquinaria. */
  puedeSalidas: boolean; puedePedidos?: boolean; actor: { email: string; nombre: string | null };
  /** La orden a editar (si no viene, se crea una nueva). */
  orden?: OrdenServicio | null;
  onClose: () => void; onCreated: () => void;
}) {
  const editando = !!orden;
  const editables = !orden || repuestosEditables(orden);
  const cerrada = !!orden && (orden.estado === 'realizada' || orden.estado === 'anulada');
  const averiado = ['averiada', 'parada'].includes(equipo.estado_operativo ?? '') || equipo.status === 'FUERA DE SERVICIO';
  const [paso, setPaso] = useState(0);
  const [tipo, setTipo] = useState<string | null>(() => orden?.tipo ?? sugerirServicio(averiado ? equipo.estado_nota : null, aviso));
  const [urgencia, setUrgencia] = useState<'normal' | 'alta' | 'urgente'>(orden?.urgencia ?? (averiado ? 'alta' : 'normal'));
  const [intervenciones, setIntervenciones] = useState<string[]>(() => (orden?.intervenciones?.length ? orden.intervenciones : ajustarIntervenciones(tipo, [])));
  // «¿Qué se hace?»: opciones propias del tipo de servicio (cauchos → cambio, espichado…).
  const [trabajos, setTrabajos] = useState<string[]>(orden?.trabajos ?? []);
  const [origen, setOrigen] = useState<'interno' | 'externo'>(orden?.origen ?? 'interno');
  const [responsable, setResponsable] = useState(orden?.responsable ?? '');
  const [descripcion, setDescripcion] = useState(orden ? (orden.descripcion ?? '') : averiado ? (equipo.estado_nota ?? '') : '');
  const [notaCierre, setNotaCierre] = useState(orden?.nota_cierre ?? '');
  const [lineas, setLineas] = useState<Linea[]>(() => (orden?.repuestos ?? []).map((r) => ({
    productoId: r.producto_id, nombre: r.nombre, unidad: r.unidad || 'und', cantidad: Number(r.cantidad) || 1,
    stock: Math.max(0, Number(r.stock_al_crear) || 0), almacen: r.almacen ?? null,
  })));
  const [productos, setProductos] = useState<Producto[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [saving, setSaving] = useState(false);
  const [wsTexto, setWsTexto] = useState<string | null>(null);
  // «¿Es alguno de estos?»: productos de nombre parecido antes de agregar una pieza nueva.
  const [sugeridos, setSugeridos] = useState<{ nombre: string; lista: ProductoParecido[] } | null>(null);
  const [buscandoParecidos, setBuscandoParecidos] = useState(false);
  // Ficha de repuestos del equipo (14/10/2026): se carga con un botón lo que toca en este servicio.
  const [fichaRep, setFichaRep] = useState<RepuestoEquipo[]>([]);
  // En el teléfono las piezas nuevas van siempre a REPUESTOS; en la computadora se puede cambiar.
  const [categoriaFija] = useState(categoriaFijaEnTelefono);
  // Fotos (hasta 4): se comprimen al elegirlas y se suben al crear la orden.
  const fotosOS = useFotosLocales();

  useEffect(() => {
    listProductosActivos().then((ps) => {
      setProductos(ps);
      // Al editar, la decisión inventario / compra se hace con el stock de HOY.
      const porId = new Map(ps.map((p) => [p.id, p]));
      setLineas((prev) => prev.map((l) => {
        const p = l.productoId ? porId.get(l.productoId) : null;
        return p ? { ...l, stock: Math.max(0, Number(p.stock) || 0), almacen: p.almacen || l.almacen } : l;
      }));
    }).catch(() => setProductos([]));
  }, []);

  useEffect(() => {
    if (!editables) return;
    listRepuestosEquipo(equipo.id).then(setFichaRep).catch(() => setFichaRep([]));
  }, [equipo.id, editables]);
  const proximo = {
    horas: proximoServicioNominal(equipo.mantenimiento_cada_hrs, horometro, equipo.mantenimiento_base_hrs),
    km: proximoServicioNominal(equipo.mantenimiento_cada_km, kilometraje, equipo.mantenimiento_base_km),
  };
  const deFicha = fichaRep.map((r) => ({ r, toca: tocaEnServicio(r, proximo) }));
  const tocan = deFicha.filter((x) => x.toca).length;
  /** Agrega a la orden los renglones de la ficha (los que tocan, o todos), sin repetir los que ya están. */
  function cargarDeFicha(todos: boolean) {
    const porId = new Map(productos.map((p) => [p.id, p]));
    const out = [...lineas];
    let agregados = 0;
    for (const { r, toca } of deFicha) {
      if (!todos && !toca) continue;
      const p = r.producto_id ? porId.get(r.producto_id) : null;
      const nombre = p ? p.nombre : nombreRepuesto(r);
      if (out.some((l) => (p ? l.productoId === p.id : !l.productoId && l.nombre === nombre))) continue;
      out.push(p
        ? { productoId: p.id, nombre: p.nombre, unidad: p.unidad || 'und', cantidad: r.cantidad, stock: Math.max(0, Number(p.stock) || 0), almacen: p.almacen || null }
        : { productoId: null, nombre, unidad: r.unidad || 'und', cantidad: r.cantidad, stock: 0, almacen: null, categoria: CATEGORIA_REPUESTOS });
      agregados += 1;
    }
    setLineas(out);
    toast(agregados ? `📋 ${agregados} repuesto(s) de la ficha agregados a la orden` : 'Todo lo de la ficha ya estaba en la orden.', agregados ? 'success' : 'info');
  }

  const resultados = useMemo(() => {
    const q = norm(busqueda);
    const usados = new Set(lineas.map((l) => l.productoId).filter(Boolean));
    return productos
      .filter((p) => !usados.has(p.id) && (!q || q.split(/\s+/).every((t) => norm(`${p.nombre} ${p.sku} ${p.categoria} ${p.nombre_busqueda ?? ''}`).includes(t))))
      .slice(0, q ? 12 : 5);
  }, [productos, busqueda, lineas]);

  const decididas = lineas.map((l) => {
    const d = decidirRepuesto(l.cantidad, l.productoId ? l.stock : 0);
    return { ...l, producto_id: l.productoId, desde_inventario: d.desdeInventario, a_comprar: d.aComprar };
  });
  const efecto = efectoOrden(decididas);
  const servicio = servicioPorId(tipo);

  function agregar(p: Producto) {
    setLineas((prev) => [...prev, { productoId: p.id, nombre: p.nombre, unidad: p.unidad || 'und', cantidad: 1, stock: Math.max(0, Number(p.stock) || 0), almacen: p.almacen || null }]);
    setBusqueda('');
  }
  function agregarComoNueva(nombre: string) {
    setLineas((prev) => [...prev, { productoId: null, nombre, unidad: 'und', cantidad: 1, stock: 0, almacen: null, categoria: CATEGORIA_REPUESTOS }]);
    setBusqueda('');
    setSugeridos(null);
  }
  /** Antes de agregar una pieza nueva se miran los productos de nombre parecido, para no duplicar. */
  async function agregarNueva() {
    const nombre = busqueda.trim().toUpperCase();
    if (nombre.length < 2) { toast('Escribe el nombre de la pieza en el buscador.', 'warning'); return; }
    if (lineas.some((l) => !l.productoId && l.nombre === nombre)) { toast('Esa pieza ya está en la orden.', 'warning'); return; }
    setBuscandoParecidos(true);
    try {
      const lista = (await buscarProductosParecidos(nombre)).filter((p) => !lineas.some((l) => l.productoId === p.id));
      if (lista.length) { setSugeridos({ nombre, lista }); return; }
    } finally { setBuscandoParecidos(false); }
    agregarComoNueva(nombre);
  }
  function usarParecido(id: string) {
    const p = productos.find((x) => x.id === id);
    if (p) agregar(p);
    else toast('Ese producto no se pudo cargar. Búscalo por su nombre en el buscador.', 'warning');
    setSugeridos(null);
  }
  const setCant = (i: number, v: number) => setLineas((prev) => prev.map((l, k) => (k === i ? { ...l, cantidad: Math.max(1, Math.round((Number(v) || 1) * 100) / 100) } : l)));


  async function guardarEdicion() {
    if (!tipo || !orden) return;
    setSaving(true);
    try {
      const nuevos = lineas.map((l) => ({ producto_id: l.productoId, nombre: l.nombre, unidad: l.unidad, cantidad: l.cantidad }));
      const cambiaron = editables && firmaRepuestos(nuevos) !== firmaRepuestos(orden.repuestos);
      const r = await editarOrdenServicio(orden.id, {
        tipo, urgencia, intervenciones, trabajos, origen,
        responsable: responsable.trim(), descripcion: descripcion.trim() || etiquetaServicio(tipo, trabajos),
        horometro: orden.horometro, kilometraje: orden.kilometraje,
        ...(cerrada ? { nota_cierre: notaCierre.trim() || null } : {}),
        ...(cambiaron ? { repuestos: nuevos } : {}),
      });
      toast(`${orden.codigo} actualizada`, 'success');
      const o2 = { ...orden, estado: r.estado, repuestos: r.repuestos };
      if (cambiaron && (faltaSalida(o2) || faltaCompra(o2))) toast('Los repuestos cambiaron: pide la salida o la compra desde la orden.', 'info');
      onCreated();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo guardar la orden', 'error');
    } finally { setSaving(false); }
  }

  async function crear() {
    if (!tipo) return;
    setSaving(true);
    try {
      const r = await crearOrdenServicio({
        equipo_id: equipo.id, tipo, urgencia, intervenciones, trabajos, origen,
        responsable: responsable.trim(), descripcion: descripcion.trim() || etiquetaServicio(tipo, trabajos),
        horometro, kilometraje,
        repuestos: lineas.map((l) => ({ producto_id: l.productoId, nombre: l.nombre, unidad: l.unidad, cantidad: l.cantidad })),
      });
      const orden = {
        id: r.id, codigo: r.codigo, estado: r.estado, repuestos: r.repuestos, tipo, urgencia,
        solicitud_salida_id: null, orden_compra_id: null,
      } as unknown as OrdenServicio;
      const partes: string[] = [`${r.codigo} creada`];
      const pendientes: string[] = [];
      // Fotos: la orden ya existe (su carpeta lleva el id). Si alguna falla, se agrega luego desde la orden.
      if (fotosOS.fotos.length) {
        const { subidas, fallos } = await subirFotosOrden(r.id, fotosOS.fotos.map((f) => f.file), actor.email, actor.nombre);
        if (subidas) partes.push(subidas === 1 ? '1 foto' : `${subidas} fotos`);
        if (fallos.length) toast(`No se pudieron subir ${fallos.length} foto(s): ${fallos.join('; ')}. Agrégalas desde la orden.`, 'warning');
      }
      if (faltaSalida(orden)) {
        if (puedeSalidas) {
          try { partes.push(`salida ${await solicitarSalidaDeOrden(orden, equipo.equipo, actor)} por aprobar`); }
          catch (e) { pendientes.push(`la salida de inventario (${e instanceof Error ? e.message : 'error'})`); }
        } else pendientes.push('la salida de inventario (no tienes permiso de Salidas)');
      }
      // Lo que falta entra a Pedidos como solicitud de pedido. Los productos no se guardan en el
      // inventario: el analista de compras colocará el nombre comercial exacto en Pedidos.
      if (faltaCompra(orden)) {
        try { partes.push(`solicitud de pedido ${await solicitarCompraDeOrden(orden, actor)}`); }
        catch (e) {
          pendientes.push(`la solicitud de pedido (${e instanceof Error ? e.message : (e as { message?: string })?.message || 'error'})`);
        }
      }
      notify(`🔧 ${partes.join(' · ')} — ${equipo.equipo}`, 'success', {
        link: `#/app/maquinaria/equipo/${equipo.id}?tab=servicios`,
        detail: servicio?.label ?? tipo,
      });
      if (pendientes.length) toast(`Queda por solicitar: ${pendientes.join('; ')}. Se puede generar después desde la orden.`, 'warning');
      onCreated();
      if (conWs) {
        const txt = mensajeSolicitudServicio({
          codigo: r.codigo,
          tipo,
          urgencia,
          equipoNombre: equipo.equipo,
          placaOSerial: equipo.placa || equipo.serial,
          horometro,
          kilometraje,
          repuestos: lineas.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, unidad: l.unidad })),
          nota: descripcion || null,
          solicitante: actor.nombre || actor.email,
        });
        setWsTexto(txt);
        return;
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo crear la orden', 'error');
    } finally { setSaving(false); }
  }

  const listo = paso === 0 ? !!tipo : true;

  return (
    <>
    <Modal title={editando ? `✎ Editar ${orden?.codigo} · ${equipo.equipo}` : `🔧 Orden de servicio · ${equipo.equipo}`} size="lg" onClose={onClose}
      footer={<>
        {paso > 0
          ? <button className="btn btn-ghost" onClick={() => setPaso(paso - 1)} disabled={saving}>Atrás</button>
          : <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>}
        {paso < 2
          ? <button className="btn btn-primary" disabled={!listo} onClick={() => setPaso(paso + 1)}>{paso === 0 ? (editables ? 'Elegir repuestos' : 'Ver repuestos') : editando ? 'Revisar cambios' : 'Revisar orden'}</button>
          : editando
            ? <button className="btn btn-primary" disabled={saving} onClick={() => void guardarEdicion()}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
            : (
              <>
                <button className="btn btn-ghost" disabled={saving || fotosOS.preparando > 0} onClick={() => void crear(true)} title="Crear orden y abrir WhatsApp para compartir la solicitud">
                  💬 Crear y avisar WhatsApp
                </button>
                <button className="btn btn-primary" disabled={saving || fotosOS.preparando > 0} onClick={() => void crear(false)}>
                  {saving ? 'Creando…' : fotosOS.preparando > 0 ? 'Preparando fotos…' : 'Crear orden de servicio'}
                </button>
              </>
            )}
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.8rem' }}>
        <ol className="flo-wizard-steps" aria-label="Pasos">
          {PASOS.map((p, i) => <li key={p} className={i < paso ? 'done' : i === paso ? 'current' : ''} aria-current={i === paso ? 'step' : undefined}>{i + 1}. {p}</li>)}
        </ol>

        {paso === 0 && (
          <>
            {editando && orden && (
              <div className="aviso info sm"><span className="aviso-icono">✎</span><div>
                Editando <strong>{orden.codigo}</strong> · {ORDEN_ESTADOS[orden.estado]?.label ?? orden.estado}. Los cambios quedan en la auditoría.
              </div></div>
            )}
            {!editando && tipo && (averiado || aviso?.nivel !== 'ok') && (
              <div className="aviso info"><span className="aviso-icono">💡</span><div><strong>Sugerido por el estado del equipo</strong> — {averiado ? (equipo.estado_nota || 'equipo averiado') : 'servicio por horas/km próximo'}. Puedes elegir otro.</div></div>
            )}
            <div className="flo-svc-grid" role="group" aria-label="Tipo de servicio">
              {SERVICIOS.map((s) => (
                <button key={s.id} type="button" className="flo-svc" aria-pressed={tipo === s.id}
                  onClick={() => { setTipo(s.id); setTrabajos((t) => t.filter((x) => trabajosDe(s.id).includes(x))); setIntervenciones((i) => ajustarIntervenciones(s.id, i)); }}>
                  <span className="ico">{s.icon}</span><strong>{s.label}</strong><span>{s.hint}</span>
                </button>
              ))}
            </div>
            {trabajosDe(tipo).length > 0 && (
              <div className="form-row"><label>¿Qué se hace? <span className="muted" style={{ fontWeight: 400 }}>· {servicio?.label} (marca una o varias)</span></label>
                <div className="flo-opt" role="group" aria-label="Qué se hace">{trabajosDe(tipo).map((t) => (
                  <button key={t} type="button" className="flo-pill" aria-pressed={trabajos.includes(t)}
                    onClick={() => setTrabajos((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}>{t}</button>
                ))}</div>
              </div>
            )}
            <div className="form-row"><label>Urgencia</label>
              <div className="flo-opt">{URGENCIAS.map((u) => <button key={u.id} type="button" className="flo-pill" aria-pressed={urgencia === u.id} onClick={() => setUrgencia(u.id)}>{u.label}</button>)}</div>
            </div>
            <div className="form-row"><label>Tipo de intervención{servicio && <span className="muted" style={{ fontWeight: 400 }}> · {servicio.label}</span>}</label>
              {/* Las del servicio elegido; si la orden ya traía otra (de antes), también se muestra. */}
              <div className="flo-opt">{[...intervencionesDe(tipo), ...intervenciones.filter((i) => !intervencionesDe(tipo).includes(i))].map((i) => (
                <button key={i} type="button" className="flo-pill" aria-pressed={intervenciones.includes(i)}
                  onClick={() => setIntervenciones((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}>{i}</button>
              ))}</div>
            </div>
            <div className="form-row"><label>Lo realiza</label>
              <div className="flo-seg" role="group" aria-label="Lo realiza">
                <button type="button" aria-pressed={origen === 'interno'} onClick={() => setOrigen('interno')}>🏭 Taller propio</button>
                <button type="button" aria-pressed={origen === 'externo'} onClick={() => setOrigen('externo')}>🤝 Proveedor externo</button>
              </div>
            </div>
            <div className="form-row"><label htmlFor="os-resp">{origen === 'interno' ? 'Mecánico responsable' : 'Proveedor del servicio'}</label>
              <input id="os-resp" className="input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder={origen === 'interno' ? 'Nombre del mecánico' : 'Nombre del proveedor'} />
            </div>
            <div className="form-row"><label htmlFor="os-desc">Descripción del problema o trabajo</label>
              <textarea id="os-desc" className="textarea" rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué se observa y qué hay que hacer" />
            </div>
            {cerrada && (
              <div className="form-row"><label htmlFor="os-cierre">{orden?.estado === 'anulada' ? 'Motivo de la anulación' : 'Nota de cierre'}</label>
                <textarea id="os-cierre" className="textarea" rows={2} value={notaCierre} onChange={(e) => setNotaCierre(e.target.value)} />
              </div>
            )}
            {editando && orden ? <FotosOrden ordenId={orden.id} canWrite /> : <FotosNuevaOrden estado={fotosOS} />}
            {origen === 'externo' && <p className="muted" style={{ fontSize: '.8rem', margin: 0 }}>Si el proveedor cobra el servicio, pídelo también en <strong>Pedidos → 🔧 Servicios</strong> casado a este equipo: aparecerá en la pestaña Compras.</p>}
          </>
        )}

        {paso === 1 && !editables && (
          <>
            <div className="aviso warning sm"><span className="aviso-icono">🔒</span><div>
              {orden?.solicitud_salida_id || orden?.orden_compra_id
                ? 'Esta orden ya tiene su salida o su pedido: sus repuestos se corrigen allá (Salidas / Pedidos).'
                : 'El trabajo ya empezó o la orden está cerrada: sus repuestos ya no se cambian.'}
            </div></div>
            {orden?.repuestos.length ? (
              <ul className="flo-parts">
                {orden.repuestos.map((r, i) => <li key={i}><span>{r.nombre}</span><strong className="mono">{fmtNum(r.cantidad)} {r.unidad}</strong></li>)}
              </ul>
            ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin repuestos.</p>}
          </>
        )}

        {paso === 1 && editables && (
          <>
            {fichaRep.length > 0 && (
              <div className="aviso info sm"><span className="aviso-icono">📋</span><div style={{ display: 'grid', gap: '.4rem', minWidth: 0 }}>
                <strong>Ficha de repuestos de {equipo.equipo}: {fichaRep.length} renglón(es) · {tocan} {tocan === 1 ? 'toca' : 'tocan'} en este servicio{proximo.horas != null ? ` (el de ${fmtNum(proximo.horas)} h)` : proximo.km != null ? ` (el de ${fmtNum(proximo.km)} km)` : ''}.</strong>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={!tocan} onClick={() => cargarDeFicha(false)}>📋 Cargar los que tocan ({tocan})</button>
                  {tocan < fichaRep.length && <button type="button" className="btn btn-sm" onClick={() => cargarDeFicha(true)}>Cargar toda la ficha ({fichaRep.length})</button>}
                </div>
              </div></div>
            )}

            <div style={{ marginBottom: '.75rem' }}>
              <label style={{ fontSize: '.78rem', fontWeight: 600, display: 'block', marginBottom: '.35rem' }}>⚡ Repuestos rápidos (un toque para agregar):</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '.4rem' }}>
                {REPUESTOS_RAPIDOS.map((rr) => {
                  const idx = lineas.findIndex((l) => l.nombre === rr.nombre);
                  const ya = idx >= 0 ? lineas[idx] : null;
                  return (
                    <button key={rr.nombre} type="button" className={`btn btn-sm ${ya ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: '.76rem', padding: '.4rem .5rem', textAlign: 'center', justifyContent: 'center' }}
                      onClick={() => {
                        if (ya) {
                          setCant(idx, ya.cantidad + 1);
                        } else {
                          setLineas((p) => [...p, { productoId: null, nombre: rr.nombre, cantidad: 1, unidad: rr.unidad, stock: 0, almacen: null }]);
                        }
                      }}>
                      <span aria-hidden="true">{rr.icon}</span> {rr.nombre} {ya ? `(${ya.cantidad})` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="form-row"><label htmlFor="os-inv">Buscar en inventario o escribir otro repuesto</label>
              <input id="os-inv" className="input" type="search" autoComplete="off" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="🔍 Filtro, caucho, aceite, manguera…" />
            </div>
            <div style={{ display: 'grid', gap: '.35rem', maxHeight: 260, overflowY: 'auto' }}>
              {resultados.map((p) => (
                <button key={p.id} type="button" className="flo-linea" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => agregar(p)}>
                  <div className="flo-linea-top">
                    <div><strong>{p.nombre}</strong><small>{p.sku} · {p.categoria} · {p.almacen}</small></div>
                    <span style={{ fontSize: '.76rem', fontWeight: 700, color: Number(p.stock) > 0 ? '#5fdca9' : '#ff8a96', whiteSpace: 'nowrap' }}>
                      {Number(p.stock) > 0 ? `${fmtNum(p.stock)} ${p.unidad} en stock` : 'Sin stock'}
                    </span>
                  </div>
                </button>
              ))}
              {!resultados.length && <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>No está en el inventario. Agrégala como pieza nueva: al crear la orden se da de alta en el inventario y entra a Pedidos.</p>}
            </div>
            {sugeridos ? (
              <div className="aviso warning sm"><span className="aviso-icono">🔎</span><div style={{ display: 'grid', gap: '.4rem', minWidth: 0 }}>
                <strong>¿«{sugeridos.nombre}» es alguno de estos?</strong>
                <span>Ya hay productos con un nombre parecido. Si es el mismo, úsalo y no se crea otro.</span>
                {sugeridos.lista.map((p) => (
                  <button key={p.id} type="button" className="btn btn-sm" style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => usarParecido(p.id)}>
                    <span>{p.nombre} <small className="muted">· {p.sku} · {p.categoria}</small></span>
                    <span>{p.stock > 0 ? `${fmtNum(p.stock)} ${p.unidad} en stock` : 'Sin stock'} · Usar este</span>
                  </button>
                ))}
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => agregarComoNueva(sugeridos.nombre)}>No, es una pieza nueva</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSugeridos(null)}>Cancelar</button>
                </div>
              </div></div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} disabled={buscandoParecidos} onClick={() => void agregarNueva()}>
                {buscandoParecidos ? 'Buscando parecidos…' : '➕ Agregar como pieza que no está en inventario'}
              </button>
            )}

            <div className="form-row" style={{ marginBottom: 0 }}><label>Repuestos de esta orden ({lineas.length})</label>
              {lineas.length ? lineas.map((l, i) => (
                <div key={`${l.productoId ?? l.nombre}-${i}`} className="flo-linea">
                  <div className="flo-linea-top">
                    <div style={{ minWidth: 0 }}><strong>{l.nombre}</strong><small>{l.productoId ? `${fmtNum(l.stock)} ${l.unidad} en stock${l.almacen ? ` · ${l.almacen}` : ''}` : editando ? 'Pieza nueva · se da de alta al pedir la compra' : 'Pieza nueva · se da de alta en el inventario al crear la orden'}</small></div>
                    <div style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
                      <div className="flo-qty">
                        <button type="button" aria-label="Menos" onClick={() => setCant(i, l.cantidad - 1)}>−</button>
                        <input inputMode="decimal" value={l.cantidad} aria-label={`Cantidad de ${l.nombre}`} onChange={(e) => setCant(i, Number(e.target.value.replace(',', '.')))} />
                        <button type="button" aria-label="Más" onClick={() => setCant(i, l.cantidad + 1)}>+</button>
                      </div>
                      <button type="button" className="btn btn-icon btn-ghost" aria-label={`Quitar ${l.nombre}`} onClick={() => setLineas((p) => p.filter((_, k) => k !== i))}>✕</button>
                    </div>
                  </div>
                  <Decision l={l} />
                  {!l.productoId && (
                    <small className="muted" style={{ display: 'block', marginTop: '.2rem' }}>🛒 Para compras · El analista colocará el nombre comercial exacto</small>
                  )}
                </div>
              )) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin repuestos. Puedes seguir si el servicio es solo mano de obra.</p>}
            </div>
          </>
        )}

        {paso === 2 && editando && orden && (
          <VistaPrevia titulo="Se guarda la orden así">
            <Dato label="Orden">{orden.codigo}</Dato>
            <Dato label="Servicio">{tipo ? etiquetaServicio(tipo, trabajos) : undefined}</Dato>
            <Dato label="Urgencia">{URGENCIAS.find((u) => u.id === urgencia)?.label}</Dato>
            <Dato label="Intervención">{intervenciones.join(', ') || undefined}</Dato>
            <Dato label={origen === 'interno' ? 'Mecánico' : 'Proveedor'}>{responsable.trim() || undefined}</Dato>
            <Dato label="Descripción">{descripcion.trim() || undefined}</Dato>
            {cerrada && <Dato label="Nota de cierre">{notaCierre.trim() || undefined}</Dato>}
            <Dato label="Repuestos">{lineas.length ? decididas.map((l) => `${fmtNum(l.cantidad)} ${l.unidad} ${l.nombre}${editables && l.a_comprar > 0 ? ` (${fmtNum(l.a_comprar)} a compra)` : ''}`).join(' · ') : 'Sin repuestos'}</Dato>
            {editables && <Dato label="La orden queda">{efecto.compran ? 'Esperando repuestos (la compra se pide desde la orden)' : 'Abierta: todo sale del inventario'}</Dato>}
          </VistaPrevia>
        )}

        {paso === 2 && !editando && (
          <div className="flo-flow">
            <div className="flo-flow-node principal"><span className="ico">🧾</span><div>
              <strong>Orden de servicio · {servicio?.label}</strong>
              {trabajos.length > 0 && <p>{trabajos.join(' · ')}</p>}
              <p>{equipo.equipo} · urgencia {urgencia} · {responsable.trim() || 'responsable por asignar'}</p>
              <p>{descripcion.trim() || 'Sin descripción'}</p>
              {fotosOS.fotos.length > 0 && <p>📷 {fotosOS.fotos.length === 1 ? '1 foto' : `${fotosOS.fotos.length} fotos`} · se suben al crear la orden</p>}
            </div></div>
            <div className="flo-flow-link" />
            <div className="flo-flow-split">
              <div className="flo-flow-node"><span className="ico">📦</span><div>
                <strong>Solicitud de salida de inventario</strong>
                {efecto.salen ? <ul className="flo-mini">{decididas.filter((l) => l.producto_id && l.desde_inventario > 0).map((l, i) => <li key={i}>{fmtNum(l.desde_inventario)} {l.unidad} · {l.nombre}{l.almacen ? <em> · almacén {l.almacen}</em> : null}</li>)}</ul> : <p>No se toma nada del inventario.</p>}
                {efecto.salen > 0 && <p>{puedeSalidas ? 'Va a Salidas «por aprobar»: descuenta stock cuando se ejecute.' : '⚠️ No tienes permiso de Salidas: quedará por solicitar.'}</p>}
              </div></div>
              <div className="flo-flow-node"><span className="ico">🛒</span><div>
                <strong>{efecto.compran ? 'Solicitud de pedido' : 'Sin compras'}</strong>
                {efecto.compran ? <ul className="flo-mini">{decididas.filter((l) => l.a_comprar > 0).map((l, i) => <li key={i}>{fmtNum(l.a_comprar)} {l.unidad} · {l.nombre}{l.producto_id ? null : <em> · pieza nueva</em>}</li>)}</ul> : <p>Todo está en inventario.</p>}
                {efecto.compran > 0 && <p>Entra a Pedidos como solicitud de pedido (SP): Compras la cotiza y pasa a OC cuando el Gerente General la aprueba.</p>}
                {efecto.nuevos > 0 && <p>🆕 {efecto.nuevos === 1 ? 'La pieza nueva se da' : `Las ${efecto.nuevos} piezas nuevas se dan`} de alta en el inventario (stock 0) en la categoría elegida.</p>}
              </div></div>
            </div>
            <div className="flo-flow-link" />
            <div className="flo-flow-node"><span className="ico">🚜</span><div>
              <strong>El equipo pasa a</strong>
              <p style={{ margin: '.35rem 0' }}><span className={`flo-chip tone-${ESTADOS_EQUIPO[efecto.estadoEquipo].tono}`}>{ESTADOS_EQUIPO[efecto.estadoEquipo].icon} {ESTADOS_EQUIPO[efecto.estadoEquipo].label}</span></p>
              <p>{efecto.compran ? 'Cuando Pedidos reciba la compra, la orden pasa sola a «en proceso».' : 'El taller puede empezar el trabajo de inmediato.'}</p>
              <p className="muted" style={{ fontSize: '.74rem' }}>El stock se vuelve a revisar al crear: si cambió, la orden toma lo que haya en ese momento.</p>
            </div></div>
          </div>
        )}
      </div>
    </Modal>
    {wsTexto && (
      <MensajeWhatsappModal
        titulo={`Servicio · ${equipo.equipo}`}
        texto={wsTexto}
        onClose={() => { setWsTexto(null); onClose(); }}
      />
    )}
    </>
  );
}
