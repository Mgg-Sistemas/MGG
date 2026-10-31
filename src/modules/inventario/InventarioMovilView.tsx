/* ============================================================
   MGG · Inventario y Almacenes · Vista de teléfono (29-10-2026)

   Traída de Golden Touch (Depósito Mina) y adaptada a los VARIOS almacenes de
   MGG: arriba se elige el almacén y todo lo de abajo es de ese almacén.
   Botones grandes:
   · «Producto nuevo»: nombre, categoría, unidad, cuánto llegó y su costo. El
     SKU lo pone el sistema y el producto nace en ese almacén.
   · «Entrada»: le suma a un producto que ya está. Toda entrada lleva costo
     (regla de MGG: sin costo el almacén queda valorado en $0).
   · «Salida»: con «¿quién autorizó?», «¿retorna? SÍ / NO» y hasta 4 fotos.
   · «Por retornar»: lo que salió y vuelve; retorno total o parcial.
   · «Traslado entre almacenes»: pasa material directo a otro almacén.
   · «Reporte de stock»: lo que hay al cierre de un período.
   Cada botón termina en su aviso para WhatsApp. Se mueve solo en los almacenes
   de las sedes del usuario (sectorización); ver, ve todos. El stock que se
   muestra y se valida es el DEL ALMACÉN (`stock_almacen`), no el global.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { RUTA_TELEFONO } from '@/modules/auth/vistasTelefono';
import { useAutorizados } from '@/modules/usuarios/autorizados.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { hoyVenezuela, rangoRapido } from '@/shared/lib/rangosFecha';
import type { Almacen } from '@/shared/lib/types';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { verComprobanteMaterialPdf, type ComprobanteMaterial } from '@/modules/salidas/salidaPdf';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { NombreUsuario } from '@/shared/ui/NombreUsuario';
import { createProducto, findBySku, getUnidades, siguienteSkuLibre } from './inventario.repository';
import { listAlmacenes } from './almacenes.repository';
import { registrarMovimiento } from './movimientos.repository';
import { CategoriaProductoSelect, asegurarCategoria, esCategoriaReal } from './CategoriaProductoSelect';
import { SIN_SEDE, nombreAlmacenVisible } from './sectorizacion';
import { useSectorizacion } from './useSectorizacion';
import {
  MAX_FOTOS_SALIDA, errorFotos, errorRetorno, errorSalida, errorTraslado, fechaHoraVE, filtrarPorRetornar, leerCantidad,
  mensajeEntrada, mensajeProductoNuevo, mensajeRetorno, mensajeSalida, mensajeStock, mensajeTraslado, num,
  pendienteRetorno, stockPorPeriodo, type FotoSalida, type MovimientoStock, type SalidaTelefono,
} from './inventarioTelefono';
import {
  listPorRetornar, movimientosAlmacenDesde, productosDeAlmacen, registrarSalidaTelefono, retornarSalidaTelefono,
  subirFotosSalida, trasladarTelefono, urlFotoSalida, type ProductoEnAlmacen,
} from './inventarioTelefono.repository';

export const RUTA_INVENTARIO_TELEFONO = '/app/inventario/telefono';
/** Cuántos productos se listan sin buscar: en el teléfono no se recorre el almacén entero. */
const SIN_BUSCAR = 15;
const CLAVE_ALMACEN = 'mgg.inventarioMovil.almacen';
const MENSAJE_COSTO = 'Una entrada necesita el costo unitario (USD). Sin costo el producto entra valorado en $0 y descuadra el valor del almacén. Si de verdad no hay costo, regístralo desde la PC como «Ajuste» explicando el motivo.';

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const errMsg = (e: unknown, d: string) => {
  const m = String((e as { message?: string } | null)?.message ?? '').trim();
  return m || d;
};
const leerAlmacen = () => { try { return localStorage.getItem(CLAVE_ALMACEN) ?? ''; } catch { return ''; } };
const guardarAlmacen = (n: string) => { try { localStorage.setItem(CLAVE_ALMACEN, n); } catch { /* sin almacenamiento: se vuelve a elegir */ } };
const esImagen = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);

type Paso = 'inicio' | 'nuevo' | 'entrada' | 'salida' | 'retornos' | 'traslado' | 'reporte' | 'listo' | 'listoSalida';

/** Los almacenes agrupados por sede, para los `<select>`. */
function porSede(almacenes: Almacen[]): [string, Almacen[]][] {
  const m = new Map<string, Almacen[]>();
  for (const a of almacenes) {
    const s = (a.sede ?? '').trim() || SIN_SEDE;
    m.set(s, [...(m.get(s) ?? []), a]);
  }
  return [...m.entries()];
}

export function InventarioMovilView() {
  const { user } = useSession();
  const { can, appUser, soloTelefono, vistasTelefono } = usePermissions();
  const sector = useSectorizacion();
  const quienDe = useQuien();
  const canWrite = can('inventario', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;
  const quien = quienDe(actorName, actor) || actorName || actor;

  const [almacenes, setAlmacenes] = useState<Almacen[] | null>(null);
  const [sel, setSel] = useState(leerAlmacen);
  const [productos, setProductos] = useState<ProductoEnAlmacen[]>([]);
  const [porRetornar, setPorRetornar] = useState<SalidaTelefono[]>([]);
  const [loading, setLoading] = useState(true);
  const [paso, setPaso] = useState<Paso>('inicio');
  const [elegido, setElegido] = useState<ProductoEnAlmacen | null>(null);
  const [busca, setBusca] = useState('');
  const [listo, setListo] = useState<{ titulo: string; texto: string; pdf?: ComprobanteMaterial } | null>(null);
  const [salidaHecha, setSalidaHecha] = useState<SalidaTelefono | null>(null);

  const cargarAlmacenes = useCallback(async () => {
    const as = await listAlmacenes('principal');
    setAlmacenes(as.filter((a) => a.estado === 'activo')
      .sort((a, b) => (a.sede ?? SIN_SEDE).localeCompare(b.sede ?? SIN_SEDE, 'es') || a.nombre.localeCompare(b.nombre, 'es')));
  }, []);
  useEffect(() => {
    cargarAlmacenes().catch((e) => { setAlmacenes([]); setLoading(false); toast(errMsg(e, 'No se pudieron cargar los almacenes'), 'error'); });
  }, [cargarAlmacenes]);
  useRealtime(['almacenes'], () => { void cargarAlmacenes().catch(() => {}); });

  // Almacén por defecto: el recordado si sigue activo; si no, el primero donde puede mover.
  useEffect(() => {
    if (!almacenes || !sector.listo) return;
    if (sel && almacenes.some((a) => a.nombre === sel)) return;
    const primero = almacenes.find((a) => sector.puedeMover(a.nombre)) ?? almacenes[0];
    setSel(primero?.nombre ?? '');
    if (!primero) setLoading(false);
  }, [almacenes, sector, sel]);

  // Solo la última carga pinta: si se cambia de almacén a mitad, la anterior se descarta.
  const turno = useRef(0);
  const reload = useCallback(async () => {
    if (!sel) return;
    const mio = ++turno.current;
    const [ps, pr] = await Promise.all([
      productosDeAlmacen(sel),
      listPorRetornar(sel).catch(() => [] as SalidaTelefono[]),
    ]);
    if (mio !== turno.current) return;
    setProductos(ps);
    setPorRetornar(pr);
  }, [sel]);

  useEffect(() => {
    if (!sel) return;
    let cancel = false;
    setLoading(true);
    reload().catch((e) => { if (!cancel) toast(errMsg(e, 'No se pudo cargar el almacén'), 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload, sel]);
  useRealtime(['existencias', 'productos', 'movimientos', 'inventario_salidas_telefono'], () => { void reload().catch(() => {}); });

  const almacen = sel;
  const puedeMoverAqui = canWrite && !!almacen && sector.puedeMover(almacen);
  const motivoAjeno = almacen ? sector.motivo(almacen) : null;
  const destinos = useMemo(() => (almacenes ?? []).filter((a) => a.nombre !== almacen), [almacenes, almacen]);

  const lista = useMemo(() => {
    const q = sinAcentos(busca.trim());
    if (!q) return productos.slice(0, SIN_BUSCAR);
    return productos.filter((p) => sinAcentos(`${p.nombre} ${p.sku} ${p.categoria}`).includes(q));
  }, [productos, busca]);

  // El producto elegido, con su stock al día (el realtime puede cambiarlo mientras se llena el formulario).
  const prodActual = elegido ? productos.find((p) => p.id === elegido.id) ?? elegido : null;

  function elegirAlmacen(n: string) {
    setSel(n); guardarAlmacen(n);
    setPaso('inicio'); setElegido(null); setBusca('');
  }
  function volver() { setPaso('inicio'); setElegido(null); setListo(null); setSalidaHecha(null); }
  function hecho(titulo: string, texto: string, pdf?: ComprobanteMaterial) {
    setListo({ titulo, texto, pdf }); setPaso('listo'); setElegido(null);
    void reload().catch(() => {});
  }
  const eligiendo = (paso === 'entrada' || paso === 'salida' || paso === 'traslado') && !elegido;
  const pideStock = paso === 'salida' || paso === 'traslado';
  const nombreAlm = nombreAlmacenVisible(almacen);

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>📦 Inventario y Almacenes</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}><NombreUsuario nombre={actorName} correo={actor} /></div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {!soloTelefono && <Link to="/app/inventario" className="btn btn-ghost">🖥 Módulo completo</Link>}
          {soloTelefono && vistasTelefono.length > 1 && <Link to={RUTA_TELEFONO} className="btn btn-ghost">📱 Mis pantallas</Link>}
        </div>
      </header>
      <AtajosTelefono actual={RUTA_INVENTARIO_TELEFONO} />

      {almacenes !== null && !almacenes.length && <p className="muted">No hay almacenes activos. Se crean desde Inventario en la PC.</p>}

      {!!almacenes?.length && (
        <div className="surt-campo">
          <label htmlFor="inv-tel-almacen">Almacén</label>
          <select id="inv-tel-almacen" className="input surt-input" value={almacen}
            disabled={paso !== 'inicio'} onChange={(e) => elegirAlmacen(e.target.value)}>
            {!almacen && <option value="">Elegir…</option>}
            {porSede(almacenes).map(([sede, as]) => (
              <optgroup key={sede} label={sede}>
                {as.map((a) => (
                  <option key={a.id} value={a.nombre}>
                    {nombreAlmacenVisible(a.nombre)}{sector.sectorizado && !sector.puedeMover(a.nombre) ? ' · solo ver' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {paso !== 'inicio' && <small className="muted">Para cambiar de almacén, vuelve al inicio.</small>}
        </div>
      )}

      {loading && <p className="muted">Cargando…</p>}
      {!loading && !canWrite && (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para mover inventario hace falta escritura en Inventario.</div>
        </div>
      )}
      {!loading && canWrite && almacen && !puedeMoverAqui && (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">🔒</span>
          <div>{motivoAjeno ?? `No puedes mover inventario en ${nombreAlm}.`} Puedes ver su stock y sacar el reporte.</div>
        </div>
      )}

      {!loading && paso === 'inicio' && puedeMoverAqui && (
        <div className="surt-acciones">
          <button type="button" className="surt-btn primario" onClick={() => setPaso('nuevo')}>
            <span className="icono" aria-hidden>＋</span>
            <span>Producto nuevo</span>
            <small>Algo que todavía no está en {nombreAlm}</small>
          </button>
          <button type="button" className="surt-btn entrada" onClick={() => { setElegido(null); setPaso('entrada'); }}>
            <span className="icono" aria-hidden>⬇</span>
            <span>Entrada</span>
            <small>Llegó más de un producto que ya está</small>
          </button>
          <button type="button" className="surt-btn salida" onClick={() => { setElegido(null); setPaso('salida'); }}>
            <span className="icono" aria-hidden>⬆</span>
            <span>Salida</span>
            <small>Sale material del almacén</small>
          </button>
          <button type="button" className="surt-btn traslado" disabled={!destinos.length}
            onClick={() => { setElegido(null); setPaso('traslado'); }}>
            <span className="icono" aria-hidden>🔁</span>
            <span>Traslado</span>
            <small>Directo a otro almacén</small>
          </button>
          <button type="button" className="surt-btn retorno" onClick={() => setPaso('retornos')}>
            <span className="icono" aria-hidden>🔄</span>
            <span>Por retornar ({porRetornar.length})</span>
            <small>{porRetornar.length ? 'Dar retorno a lo que salió' : 'Sin pendientes por retornar'}</small>
          </button>
        </div>
      )}

      {!loading && paso === 'inicio' && almacen && (
        <button type="button" className="surt-btn" style={{ width: '100%', minHeight: 84, marginTop: '.75rem', borderColor: 'var(--success)' }}
          onClick={() => setPaso('reporte')}>
          <span>📲 Reporte de stock (WhatsApp)</span>
          <small>Lo que hay en {nombreAlm}, filtrado por fechas</small>
        </button>
      )}

      {paso === 'listo' && listo && <Listo titulo={listo.titulo} texto={listo.texto} pdf={listo.pdf} onVolver={volver} />}

      {paso === 'listoSalida' && salidaHecha && (
        <ListoSalida salida={salidaHecha} quien={quien} onCambio={setSalidaHecha} onVolver={volver} />
      )}

      {paso === 'reporte' && (
        <ReporteStock almacen={almacen} productos={productos} quien={quien} onVolver={volver} />
      )}

      {paso === 'nuevo' && (
        <FormNuevo almacen={almacen} productos={productos} actor={actor} actorName={actorName} quien={quien}
          onCancel={volver} onHecho={hecho} />
      )}

      {paso === 'entrada' && prodActual && (
        <FormEntrada almacen={almacen} producto={prodActual} actor={actor} actorName={actorName} quien={quien}
          onCancel={() => setElegido(null)} onHecho={hecho} />
      )}

      {paso === 'salida' && prodActual && (
        <FormSalida almacen={almacen} producto={prodActual} actor={actor} actorName={actorName}
          onCancel={() => setElegido(null)}
          onHecho={(s) => { setSalidaHecha(s); setPaso('listoSalida'); setElegido(null); void reload().catch(() => {}); }} />
      )}

      {paso === 'traslado' && prodActual && (
        <FormTraslado origen={almacen} destinos={destinos} producto={prodActual} actor={actor} actorName={actorName} quien={quien}
          onCancel={() => setElegido(null)} onHecho={hecho} />
      )}

      {paso === 'retornos' && (
        <PorRetornar salidas={porRetornar} almacen={almacen} canWrite={puedeMoverAqui} actor={actor} actorName={actorName} quien={quien}
          onVolver={volver} onHecho={hecho} />
      )}

      {(paso === 'inicio' || eligiendo) && almacen && (
        <section className="surt-lista">
          {eligiendo && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
              <strong style={{ fontSize: '1.1rem' }}>
                {paso === 'salida' ? '⬆ ¿Qué material sale?'
                  : paso === 'traslado' ? '🔁 ¿Qué material se traslada?'
                  : '⬇ ¿A qué producto le llegó?'}
              </strong>
              <button type="button" className="btn btn-ghost" onClick={volver}>Cancelar</button>
            </div>
          )}
          <input className="input surt-input" type="search" name="inv-movil-buscar" placeholder="🔍 Buscar producto…"
            value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" aria-label="Buscar producto" />
          <h2>
            {busca.trim()
              ? `${lista.length} encontrado(s)`
              : `Productos de ${nombreAlm} (${productos.length})${productos.length > SIN_BUSCAR ? ` · se ven ${SIN_BUSCAR}, busca para ver el resto` : ''}`}
          </h2>
          {!loading && !productos.length && (
            <p className="muted">{nombreAlm} no tiene productos todavía.{puedeMoverAqui ? ' Carga el primero con «Producto nuevo».' : ''}</p>
          )}
          {lista.map((p) => (
            <button key={p.id} type="button" className="surt-mov"
              onClick={() => { if (puedeMoverAqui) { setElegido(p); if (paso === 'inicio') setPaso('entrada'); } }}
              disabled={!puedeMoverAqui || (pideStock && !(p.stock_almacen > 0))}>
              <span className="icono" aria-hidden>📦</span>
              <span style={{ minWidth: 0 }}>
                <div className="titulo">{p.nombre}</div>
                <div className="sub">{p.sku} · {p.categoria}</div>
              </span>
              <span className="litros">{num(p.stock_almacen)} <small style={{ fontWeight: 600 }}>{p.unidad}</small></span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

/** Lo guardado: el aviso para WhatsApp y la vuelta al inicio. */
function Listo({ titulo, texto, pdf, onVolver, children }: {
  titulo: string; texto: string; pdf?: ComprobanteMaterial; onVolver: () => void; children?: ReactNode;
}) {
  const [abriendo, setAbriendo] = useState(false);
  // El comprobante en PDF (30-10-2026): mismo formato que Salidas y Traslados, en vista
  // previa y solo con el botón (nada se descarga solo).
  async function verPdf() {
    if (!pdf) return;
    setAbriendo(true);
    try { await verComprobanteMaterialPdf(pdf); }
    catch (e) { toast(errMsg(e, 'No se pudo armar el PDF'), 'error'); }
    finally { setAbriendo(false); }
  }
  return (
    <div className="surt-form">
      <div className="surt-form-titulo"><span className="icono" aria-hidden>✅</span><strong>{titulo}</strong></div>
      {children}
      <CompartirWhatsapp texto={texto} />
      {pdf && (
        <button type="button" className="btn btn-ghost surt-guardar" disabled={abriendo} onClick={() => void verPdf()}>
          {abriendo ? 'Armando el PDF…' : '📄 Ver PDF del comprobante'}
        </button>
      )}
      <button type="button" className="btn btn-primary surt-guardar" onClick={onVolver}>← Volver al inicio</button>
    </div>
  );
}

/** La salida ya guardada: se le pueden sumar fotos (hasta 4) y el aviso se rehace con ellas. */
function ListoSalida({ salida, quien, onCambio, onVolver }: {
  salida: SalidaTelefono; quien: string; onCambio: (s: SalidaTelefono) => void; onVolver: () => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const faltan = MAX_FOTOS_SALIDA - salida.fotos.length;

  async function agregar(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (!archivos.length) return;
    const mal = errorFotos(archivos, salida.fotos.length);
    if (mal) { toast(mal, 'error'); return; }
    setSubiendo(true);
    try {
      onCambio(await subirFotosSalida(salida, archivos));
      toast(archivos.length === 1 ? 'Foto agregada.' : `${archivos.length} fotos agregadas.`, 'success');
    } catch (e) {
      toast(errMsg(e, 'No se pudieron subir las fotos'), 'error');
    } finally { setSubiendo(false); }
  }

  return (
    <Listo titulo={`Salida ${salida.codigo} registrada`} texto={mensajeSalida(salida, quien)} onVolver={onVolver}
      pdf={{
        tipo: 'salida', codigo: salida.codigo, producto: { nombre: salida.producto_nombre, unidad: salida.unidad },
        almacen: nombreAlmacenVisible(salida.almacen), cantidad: salida.cantidad, detalle: salida.motivo,
        autorizadoPor: salida.autorizado_por, retorna: salida.retorna, fotos: salida.fotos.length,
        actor: salida.actor ?? quien, actorName: salida.actor_name ?? quien, at: salida.created_at,
      }}>
      <FotosSalida fotos={salida.fotos} />
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-fotos-mas">Fotos ({salida.fotos.length}/{MAX_FOTOS_SALIDA})</label>
        {faltan > 0 ? (
          <input id="inv-tel-salida-fotos-mas" className="input surt-input" type="file" accept="image/*" multiple disabled={subiendo}
            onChange={(e) => { void agregar(e.target.files); e.target.value = ''; }} />
        ) : <small className="muted">Ya tiene las {MAX_FOTOS_SALIDA} fotos.</small>}
        {subiendo && <small className="muted">Subiendo…</small>}
      </div>
    </Listo>
  );
}

function ReporteStock({ almacen, productos, quien, onVolver }: {
  almacen: string; productos: ProductoEnAlmacen[]; quien: string; onVolver: () => void;
}) {
  const hoy = hoyVenezuela();
  const [desde, setDesde] = useState(() => rangoRapido('mes', hoy).desde);
  const [hasta, setHasta] = useState(hoy);
  const [movs, setMovs] = useState<MovimientoStock[] | null>(null);

  const rangoMalo = !desde || !hasta || desde > hasta || hasta > hoy;
  const cargar = useCallback(async () => {
    if (!desde || desde > hoy) return;
    try { setMovs(await movimientosAlmacenDesde(almacen, desde)); }
    catch (e) { setMovs([]); toast(errMsg(e, 'No se pudieron cargar los movimientos'), 'error'); }
  }, [desde, hoy, almacen]);
  useEffect(() => { setMovs(null); void cargar(); }, [cargar]);
  useRealtime(['movimientos'], () => { void cargar(); });

  const filas = useMemo(
    () => (movs && !rangoMalo
      ? stockPorPeriodo(productos.map((p) => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, unidad: p.unidad, stock: p.stock_almacen })), movs, desde, hasta)
      : []),
    [movs, productos, desde, hasta, rangoMalo],
  );
  const texto = useMemo(() => mensajeStock(almacen, filas, desde, hasta, { quien }), [almacen, filas, desde, hasta, quien]);

  function atajo(r: 'hoy' | 'mes' | 'mesPasado') {
    const x = r === 'hoy' ? { desde: hoy, hasta: hoy } : rangoRapido(r, hoy);
    setDesde(x.desde); setHasta(x.hasta);
  }

  return (
    <div className="surt-form">
      <div className="surt-form-titulo"><span className="icono" aria-hidden>📲</span><strong>Reporte de stock · {nombreAlmacenVisible(almacen)}</strong></div>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" onClick={() => atajo('hoy')}>Hoy</button>
        <button type="button" className="btn btn-ghost" onClick={() => atajo('mes')}>Este mes</button>
        <button type="button" className="btn btn-ghost" onClick={() => atajo('mesPasado')}>Mes pasado</button>
      </div>
      <div className="surt-grid2">
        <div className="surt-campo">
          <label htmlFor="inv-tel-rep-desde">Desde</label>
          <input id="inv-tel-rep-desde" type="date" className="input surt-input" value={desde} max={hoy}
            onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="surt-campo">
          <label htmlFor="inv-tel-rep-hasta">Hasta</label>
          <input id="inv-tel-rep-hasta" type="date" className="input surt-input" value={hasta} max={hoy}
            onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>
      <small className="muted">Muestra lo que había al cierre del «hasta» y lo que entró (📥) y salió (📤) en esas fechas.</small>
      {rangoMalo ? (
        <div className="aviso warning sm"><span className="aviso-icono">⚠</span><div>Revisa las fechas: «desde» no puede ir después de «hasta» ni pasar de hoy.</div></div>
      ) : movs === null ? (
        <p className="muted">Armando el reporte…</p>
      ) : (
        <CompartirWhatsapp texto={texto} />
      )}
      <button type="button" className="btn btn-ghost btn-grande" onClick={onVolver}>← Volver</button>
    </div>
  );
}

function FormNuevo({ almacen, productos, actor, actorName, quien, onCancel, onHecho }: {
  almacen: string; productos: ProductoEnAlmacen[]; actor: string; actorName: string | null; quien: string;
  onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [unidad, setUnidad] = useState('');
  const [unidades, setUnidades] = useState<string[]>([]);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cant = leerCantidad(cantidad);
  const precio = Math.max(0, leerCantidad(costo));

  useEffect(() => {
    let vivo = true;
    getUnidades().then((u) => { if (vivo) setUnidades(u); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = nombre.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!n) return toast('Escribe el nombre del producto.', 'error');
    if (!esCategoriaReal(categoria)) return toast('Elige la categoría del producto (no puede ser «GENERAL»).', 'error');
    if (!unidad) return toast('Elige la unidad (kg, und, saco…).', 'error');
    if (cant < 0) return toast('La cantidad no puede ser negativa.', 'error');
    if (cant > 0 && !(precio > 0)) return toast(MENSAJE_COSTO, 'error');
    if (productos.some((p) => sinAcentos(p.nombre.trim()) === sinAcentos(n))) {
      return toast(`«${n}» ya está en ${nombreAlmacenVisible(almacen)}: cárgale lo que llegó con «Entrada».`, 'error');
    }
    setGuardando(true);
    try {
      const cat = await asegurarCategoria(categoria, actor);
      const sku = await siguienteSkuLibre(cat, productos);
      if (await findBySku(sku)) throw new Error('El código del producto chocó con otro. Toca «Guardar» de nuevo.');
      const ubic = ubicacion.trim().toUpperCase() || null;
      const creado = await createProducto({
        sku, nombre: n, categoria: cat, unidad, stock: 0, stock_min: 0, precio,
        almacen, estado: 'activo', ubicacion_fisica: ubic,
      });
      let cuando: string | null = null;
      if (cant > 0) {
        try {
          const mov = await registrarMovimiento({
            producto_id: creado.id, tipo: 'creacion', delta: cant, almacen,
            actor, actor_name: actorName,
            detalle: `Stock inicial al dar de alta el producto · ${almacen} (teléfono)`,
            precio_unitario: precio,
          });
          cuando = mov.at;
        } catch (err) {
          throw new Error(`El producto ${sku} quedó creado pero sin stock (${errMsg(err, 'error')}). Cárgale la cantidad con «Entrada».`);
        }
      }
      toast(`Producto ${sku} cargado en ${nombreAlmacenVisible(almacen)}`, 'success');
      onHecho(`Cargado en ${nombreAlmacenVisible(almacen)}: ${sku}`, mensajeProductoNuevo({
        almacen, sku, nombre: n, categoria: cat, unidad, cantidad: cant, costo: precio, ubicacion: ubic, quien, cuando,
      }));
    } catch (err) {
      toast(errMsg(err, 'No se pudo guardar'), 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>＋</span><strong>Producto nuevo · {nombreAlmacenVisible(almacen)}</strong></div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-nombre">Nombre</label>
        <input id="inv-tel-nombre" className="input surt-input" value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej.: MANGUERA 2 PULGADAS" autoComplete="off" autoFocus />
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-categoria">Categoría</label>
        <div className="surt-buscable">
          <CategoriaProductoSelect id="inv-tel-categoria" value={categoria} onChange={setCategoria} />
        </div>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-unidad">Unidad</label>
        <select id="inv-tel-unidad" className="input surt-input" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
          <option value="">Elegir…</option>
          {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-cantidad">¿Cuánto hay?</label>
        <input id="inv-tel-cantidad" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
        <small className="muted">Lo que entra hoy. Si no llegó nada todavía, déjalo en 0.</small>
      </div>
      <div className="surt-grid2">
        <div className="surt-campo">
          <label htmlFor="inv-tel-costo">Costo c/u (USD){cant > 0 ? ' *' : ''}</label>
          <input id="inv-tel-costo" className="input surt-input" inputMode="decimal" value={costo}
            onChange={(e) => setCosto(e.target.value)} placeholder={cant > 0 ? 'Obligatorio' : 'Opcional'} />
          {cant > 0 && !(precio > 0) && <small className="surt-alerta">Si entra cantidad, el costo es obligatorio.</small>}
        </div>
        <div className="surt-campo">
          <label htmlFor="inv-tel-ubicacion">Ubicación</label>
          <input id="inv-tel-ubicacion" className="input surt-input" value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)} placeholder="Opcional" autoComplete="off" />
        </div>
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando}>{guardando ? 'Guardando…' : '✓ Guardar producto'}</button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>Cancelar</button>
    </form>
  );
}

function FormEntrada({ almacen, producto, actor, actorName, quien, onCancel, onHecho }: {
  almacen: string; producto: ProductoEnAlmacen; actor: string; actorName: string | null; quien: string;
  onCancel: () => void; onHecho: (titulo: string, texto: string, pdf?: ComprobanteMaterial) => void;
}) {
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cant = leerCantidad(cantidad);
  const precio = leerCantidad(costo);
  const hay = producto.stock_almacen;
  const costoActual = Number(producto.precio) || 0;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!(cant > 0)) return toast('Escribe cuánto llegó.', 'error');
    if (!(precio > 0)) return toast(MENSAJE_COSTO, 'error');
    setGuardando(true);
    try {
      const mov = await registrarMovimiento({
        producto_id: producto.id, tipo: 'entrada', delta: cant, almacen,
        actor, actor_name: actorName,
        detalle: nota.trim() ? `${nota.trim()} · ${almacen} (teléfono)` : `Entrada en ${almacen} (teléfono)`,
        precio_unitario: precio,
      });
      toast(`Entrada: +${num(cant)} ${producto.unidad} de ${producto.nombre}`, 'success');
      onHecho(`Entrada: +${num(cant)} ${producto.unidad} de ${producto.nombre}`, mensajeEntrada({
        almacen, nombre: producto.nombre, sku: producto.sku, unidad: producto.unidad, cantidad: cant,
        stockDespues: Number(mov.stock_despues) || hay + cant, costo: precio, nota, quien, cuando: mov.at,
      }), {
        tipo: 'entrada', producto: { sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad },
        almacen: nombreAlmacenVisible(almacen), cantidad: cant, precioUnitario: precio, detalle: mov.detalle,
        actor, actorName, at: mov.at,
      });
    } catch (err) {
      toast(errMsg(err, 'No se pudo guardar'), 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>⬇</span><strong>Entrada · {producto.nombre}</strong></div>
      <div className="muted">{producto.sku} · hay {num(hay)} {producto.unidad} en {nombreAlmacenVisible(almacen)}</div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-entrada-cant">¿Cuánto llegó? ({producto.unidad})</label>
        <input id="inv-tel-entrada-cant" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" autoFocus />
        {cant > 0 && <small className="muted">Queda en {num(hay + cant)} {producto.unidad}.</small>}
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-entrada-costo">Costo c/u (USD) *</label>
        <input id="inv-tel-entrada-costo" className="input surt-input" inputMode="decimal" value={costo}
          onChange={(e) => setCosto(e.target.value)} placeholder="Obligatorio" />
        <small className="muted">
          {costoActual > 0 ? `Costo promedio actual: $${num(costoActual)}. ` : ''}Lo que costó cada {producto.unidad || 'unidad'} que llegó.
        </small>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-entrada-nota">Nota</label>
        <input id="inv-tel-entrada-nota" className="input surt-input" value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Opcional: de dónde vino, quién lo trajo…" autoComplete="off" />
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando || !(cant > 0) || !(precio > 0)}>
        {guardando ? 'Guardando…' : '✓ Guardar entrada'}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Otro producto</button>
    </form>
  );
}

function FormSalida({ almacen, producto, actor, actorName, onCancel, onHecho }: {
  almacen: string; producto: ProductoEnAlmacen; actor: string; actorName: string | null;
  onCancel: () => void; onHecho: (s: SalidaTelefono) => void;
}) {
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [autorizado, setAutorizado] = useState('');
  const [retorna, setRetorna] = useState<boolean | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const cant = leerCantidad(cantidad);
  const stock = producto.stock_almacen;

  // Quién autoriza: los usuarios autorizados a aprobar salidas (Roles y Permisos), por nombre.
  const autorizados = useAutorizados();
  const quienDe = useQuien();
  const autorizadores = useMemo(() => [...new Set((autorizados ?? [])
    .filter((a) => a.aprobar_salidas)
    .map((a) => quienDe(null, a.email))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [autorizados, quienDe]);

  const previas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => { previas.forEach((u) => URL.revokeObjectURL(u)); }, [previas]);

  function agregarFotos(lista: FileList | null) {
    const nuevas = Array.from(lista ?? []);
    const mal = errorFotos(nuevas, fotos.length);
    if (mal) toast(mal, 'warning');
    setFotos((xs) => [...xs, ...nuevas.filter(esImagen)].slice(0, MAX_FOTOS_SALIDA));
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const problema = errorSalida({ productoId: producto.id, cantidad: cant, stock, motivo, autorizado, retorna });
    if (problema) return toast(problema, 'error');
    setGuardando(true);
    try {
      let s = await registrarSalidaTelefono({
        producto, almacen, cantidad: cant, motivo, autorizadoPor: autorizado, retorna: !!retorna, actor, actorName,
      });
      if (fotos.length) {
        try { s = await subirFotosSalida(s, fotos); }
        catch (err) { toast(`La salida quedó registrada, pero las fotos no subieron: ${errMsg(err, 'error')}. Puedes volver a agregarlas.`, 'warning'); }
      }
      toast(`Salida ${s.codigo}: −${num(cant)} ${producto.unidad} de ${producto.nombre}`, 'success');
      onHecho(s);
    } catch (err) {
      toast(errMsg(err, 'No se pudo registrar la salida'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>⬆</span><strong>Salida · {producto.nombre}</strong></div>
      <div className="muted">{producto.sku} · hay {num(stock)} {producto.unidad} en {nombreAlmacenVisible(almacen)}</div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-cant">Cantidad ({producto.unidad})</label>
        <input id="inv-tel-salida-cant" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" autoFocus />
        {cant > 0 && (cant > stock
          ? <small className="surt-alerta">No alcanza: hay {num(stock)} {producto.unidad}.</small>
          : <small className="muted">Quedan {num(stock - cant)} {producto.unidad}.</small>)}
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-motivo">Motivo</label>
        <input id="inv-tel-salida-motivo" className="input surt-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Para qué sale, a quién, a qué equipo…" autoComplete="off" />
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-autorizado">¿Quién autorizó?</label>
        <select id="inv-tel-salida-autorizado" className="input surt-input" value={autorizado} onChange={(e) => setAutorizado(e.target.value)}>
          <option value="">{autorizados === null ? 'Cargando…' : 'Elegir…'}</option>
          {autorizadores.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {autorizados !== null && !autorizadores.length && (
          <small className="surt-alerta">No hay usuarios autorizados para aprobar salidas (Usuarios › Roles y Permisos).</small>
        )}
      </div>
      <div className="surt-campo">
        <span className="surt-rotulo" id="inv-tel-salida-retorna">¿Retorna?</span>
        <div className="surt-sino" role="group" aria-labelledby="inv-tel-salida-retorna">
          <button type="button" className={`surt-btn si${retorna === true ? ' sel' : ''}`} aria-pressed={retorna === true} onClick={() => setRetorna(true)}>
            <span className="icono" aria-hidden>🔄</span><span>SÍ</span><small>Vuelve al almacén</small>
          </button>
          <button type="button" className={`surt-btn no${retorna === false ? ' sel' : ''}`} aria-pressed={retorna === false} onClick={() => setRetorna(false)}>
            <span className="icono" aria-hidden>❌</span><span>NO</span><small>Se consume / se queda</small>
          </button>
        </div>
        {retorna && <small className="muted">Queda en «Por retornar» y desde ahí se le da retorno al inventario (todo o una parte).</small>}
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-fotos">Fotos ({fotos.length}/{MAX_FOTOS_SALIDA}) · opcional</label>
        {fotos.length < MAX_FOTOS_SALIDA && (
          <input id="inv-tel-salida-fotos" className="input surt-input" type="file" accept="image/*" multiple
            onChange={(e) => { agregarFotos(e.target.files); e.target.value = ''; }} />
        )}
        {!!fotos.length && (
          <div className="rep-fotos">
            {fotos.map((f, i) => (
              <div key={`${f.name}-${i}`} className="rep-foto surt-foto-quitar">
                <img src={previas[i]} alt={f.name} />
                <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFotos((xs) => xs.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="submit" className="btn btn-primary surt-guardar"
        disabled={guardando || !(cant > 0) || cant > stock || retorna === null || !autorizado.trim()}>
        {guardando ? 'Guardando…' : '✓ Guardar salida'}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Otro material</button>
    </form>
  );
}

function FormTraslado({ origen, destinos, producto, actor, actorName, quien, onCancel, onHecho }: {
  origen: string; destinos: Almacen[]; producto: ProductoEnAlmacen; actor: string; actorName: string | null; quien: string;
  onCancel: () => void; onHecho: (titulo: string, texto: string, pdf?: ComprobanteMaterial) => void;
}) {
  const [destino, setDestino] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const cant = leerCantidad(cantidad);
  const hay = producto.stock_almacen;
  const deNombre = nombreAlmacenVisible(origen);
  const aNombre = destino ? nombreAlmacenVisible(destino) : '';
  const datos = { productoId: producto.id, origen, destino, cantidad: cant, stock: hay, motivo };

  function revisar(e: FormEvent) {
    e.preventDefault();
    const problema = errorTraslado(datos);
    if (problema) return toast(problema, 'error');
    setConfirmando(true);
  }

  async function trasladar() {
    const problema = errorTraslado(datos);
    if (problema) { setConfirmando(false); return toast(problema, 'error'); }
    setGuardando(true);
    try {
      await trasladarTelefono({ producto, origen, destino, cantidad: cant, motivo, actor, actorName });
      toast(`Traslado: ${num(cant)} ${producto.unidad} de ${producto.nombre} a ${aNombre}`, 'success');
      onHecho(`Traslado a ${aNombre} registrado`, mensajeTraslado({
        origen, destino, nombre: producto.nombre, sku: producto.sku, unidad: producto.unidad, cantidad: cant,
        motivo, quedaOrigen: Math.max(0, hay - cant), quien,
      }), {
        tipo: 'traslado', producto: { sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad },
        almacen: deNombre, destino: aNombre, cantidad: cant, precioUnitario: Number(producto.precio) || null,
        detalle: motivo, actor, actorName, at: new Date().toISOString(),
      });
    } catch (err) {
      toast(errMsg(err, 'No se pudo trasladar'), 'error');
      setConfirmando(false);
    } finally {
      setGuardando(false);
    }
  }

  if (confirmando) {
    return (
      <div className="surt-form">
        <div className="surt-form-titulo"><span className="icono" aria-hidden>🔁</span><strong>¿Confirmas el traslado?</strong></div>
        <div className="surt-detalle">
          <div className="surt-fila"><span>Material</span><span>{producto.nombre}</span></div>
          <div className="surt-fila"><span>Cantidad</span><span>{num(cant)} {producto.unidad}</span></div>
          <div className="surt-fila"><span>De</span><span>{deNombre}</span></div>
          <div className="surt-fila"><span>A</span><span>{aNombre}</span></div>
          <div className="surt-fila"><span>Motivo</span><span>{motivo.trim()}</span></div>
          <div className="surt-fila"><span>Queda en {deNombre}</span><span>{num(Math.max(0, hay - cant))} {producto.unidad}</span></div>
        </div>
        <button type="button" className="btn btn-primary surt-guardar" disabled={guardando} onClick={() => void trasladar()}>
          {guardando ? 'Trasladando…' : `✓ Sí, trasladar a ${aNombre}`}
        </button>
        <button type="button" className="btn btn-ghost btn-grande" disabled={guardando} onClick={() => setConfirmando(false)}>← Corregir</button>
      </div>
    );
  }

  return (
    <form className="surt-form" onSubmit={revisar}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>🔁</span><strong>Traslado · {producto.nombre}</strong></div>
      <div className="muted">{producto.sku} · hay {num(hay)} {producto.unidad} en {deNombre}</div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-traslado-destino">¿A qué almacén va?</label>
        <select id="inv-tel-traslado-destino" className="input surt-input" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Elegir…</option>
          {porSede(destinos).map(([sede, as]) => (
            <optgroup key={sede} label={sede}>
              {as.map((a) => <option key={a.id} value={a.nombre}>{nombreAlmacenVisible(a.nombre)}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-traslado-cant">¿Cuánto se traslada? ({producto.unidad})</label>
        <input id="inv-tel-traslado-cant" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
        {cant > 0 && cant <= hay && <small className="muted">En {deNombre} quedan {num(hay - cant)} {producto.unidad}.</small>}
        {cant > hay && <small className="surt-alerta">No alcanza: hay {num(hay)} {producto.unidad}.</small>}
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-traslado-motivo">Motivo</label>
        <input id="inv-tel-traslado-motivo" className="input surt-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Para qué se lleva, quién lo lleva…" autoComplete="off" />
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={!destino || !(cant > 0) || cant > hay}>
        🔁 Revisar traslado
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel}>← Otro material</button>
    </form>
  );
}

/** Las fotos de una salida (se abren en otra pestaña). */
function FotosSalida({ fotos }: { fotos: FotoSalida[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    void Promise.all(fotos.map(async (f) => [f.path, await urlFotoSalida(f.path).catch(() => '')] as const))
      .then((xs) => { if (vivo) setUrls(Object.fromEntries(xs)); });
    return () => { vivo = false; };
  }, [fotos]);
  if (!fotos.length) return null;
  return (
    <div className="rep-fotos">
      {fotos.map((f) => (
        <a key={f.path} className="rep-foto" href={urls[f.path] || undefined} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${f.filename}`}>
          {urls[f.path] ? <img src={urls[f.path]} alt={f.filename} /> : <span className="rep-foto-doc">📷</span>}
        </a>
      ))}
    </div>
  );
}

function PorRetornar({ salidas, almacen, canWrite, actor, actorName, quien, onVolver, onHecho }: {
  salidas: SalidaTelefono[]; almacen: string; canWrite: boolean; actor: string; actorName: string | null; quien: string;
  onVolver: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [elegidaId, setElegidaId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [busca, setBusca] = useState('');
  const lista = useMemo(() => filtrarPorRetornar(salidas, busca), [salidas, busca]);
  // Al día con el realtime: si otro le dio retorno mientras tanto, se ve lo que falta de verdad.
  const elegida = elegidaId ? salidas.find((s) => s.id === elegidaId) ?? null : null;

  function elegir(s: SalidaTelefono) { setElegidaId(s.id); setCantidad(String(pendienteRetorno(s)).replace('.', ',')); setNota(''); }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!elegida) return;
    const cant = leerCantidad(cantidad);
    const problema = errorRetorno(elegida, cant);
    if (problema) return toast(problema, 'error');
    setGuardando(true);
    try {
      const s = await retornarSalidaTelefono(elegida, cant, nota, actor, actorName);
      toast(`Retorno: +${num(cant)} ${s.unidad ?? ''} de ${s.producto_nombre}`, 'success');
      onHecho(`Retorno de ${s.codigo} registrado`, mensajeRetorno(s, cant, nota, quien));
    } catch (err) {
      toast(errMsg(err, 'No se pudo registrar el retorno'), 'error');
    } finally { setGuardando(false); }
  }

  if (elegida) {
    const falta = pendienteRetorno(elegida);
    const cant = leerCantidad(cantidad);
    const u = elegida.unidad ?? '';
    return (
      <form className="surt-form" onSubmit={(e) => void guardar(e)}>
        <div className="surt-form-titulo"><span className="icono" aria-hidden>📥</span><strong>Retorno · {elegida.producto_nombre}</strong></div>
        <div className="surt-detalle">
          <div className="surt-fila"><span>Salida</span><span className="mono">{elegida.codigo}</span></div>
          <div className="surt-fila"><span>Salió</span><span>{num(elegida.cantidad)} {u} · {fechaHoraVE(elegida.created_at)}</span></div>
          <div className="surt-fila"><span>Motivo</span><span>{elegida.motivo}</span></div>
          {elegida.autorizado_por && <div className="surt-fila"><span>Autorizó</span><span>{elegida.autorizado_por}</span></div>}
          {elegida.retornado > 0 && <div className="surt-fila"><span>Ya retornó</span><span>{num(elegida.retornado)} {u}</span></div>}
          <div className="surt-fila"><span>Falta</span><span>{num(falta)} {u}</span></div>
        </div>
        <FotosSalida fotos={elegida.fotos} />
        <div className="surt-campo">
          <label htmlFor="inv-tel-retorno-cant">¿Cuánto retorna? ({u})</label>
          <input id="inv-tel-retorno-cant" className="input surt-litros" inputMode="decimal" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)} placeholder="0" autoFocus />
          {cant > falta
            ? <small className="surt-alerta">Solo faltan {num(falta)} {u}.</small>
            : cant > 0 && cant < falta && <small className="muted">Retorno parcial: quedarán {num(falta - cant)} {u} por retornar.</small>}
        </div>
        <div className="surt-campo">
          <label htmlFor="inv-tel-retorno-nota">Nota</label>
          <input id="inv-tel-retorno-nota" className="input surt-input" value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Opcional: en qué estado volvió, quién lo trajo…" autoComplete="off" />
        </div>
        <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando || !(cant > 0) || cant > falta}>
          {guardando ? 'Guardando…' : '✓ Dar retorno al inventario'}
        </button>
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => setElegidaId(null)} disabled={guardando}>← Otra salida</button>
      </form>
    );
  }

  return (
    <section className="surt-lista">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
        <strong style={{ fontSize: '1.1rem' }}>🔄 Por retornar · {nombreAlmacenVisible(almacen)} ({salidas.length})</strong>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>← Volver</button>
      </div>
      {salidas.length > 0 && (
        <>
          <input className="input surt-input" type="search" name="inv-tel-retornar-buscar" placeholder="🔍 Buscar salida pendiente…"
            value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" aria-label="Buscar en Por retornar" />
          {busca.trim() && <h2>{lista.length ? `${lista.length} encontrada(s)` : 'Ninguna salida pendiente coincide'}</h2>}
        </>
      )}
      {!salidas.length && <p className="muted">No hay nada pendiente por retornar en este almacén.</p>}
      {lista.map((s) => (
        <button key={s.id} type="button" className="surt-mov" disabled={!canWrite} onClick={() => elegir(s)}>
          <span className="icono" aria-hidden>📦</span>
          <span style={{ minWidth: 0 }}>
            <div className="titulo">{s.producto_nombre}</div>
            <div className="sub">{s.codigo} · {fechaHoraVE(s.created_at)} · {s.motivo}</div>
            {s.retornado > 0 && <div className="sub">Ya retornó {num(s.retornado)} de {num(s.cantidad)}</div>}
          </span>
          <span className="litros">{num(pendienteRetorno(s))} <small>{s.unidad}</small></span>
        </button>
      ))}
    </section>
  );
}
