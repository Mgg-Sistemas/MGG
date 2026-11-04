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
   · «Histórico de salidas» (02-11-2026): las salidas ya hechas del almacén, cada
     una con su PDF y su WhatsApp (con sus fotos), para sacarlos cuando haga falta.
   Cada botón termina en su aviso para WhatsApp; el de la salida lleva sus
   fotos adjuntas (02-11-2026, ver shared/ui/CompartirWhatsapp). El almacenista con sede SOLO ve
   (y mueve en) los almacenes de su sede (sectorización, 02-11-2026); los demás
   almacenes solo aparecen como destino de un traslado. Sin sede, ve todos. El
   stock que se muestra y se valida es el DEL ALMACÉN (`stock_almacen`), no el global.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { RUTA_TELEFONO } from '@/modules/auth/vistasTelefono';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { hoyVenezuela, rangoRapido } from '@/shared/lib/rangosFecha';
import type { Almacen, SolicitudSalida } from '@/shared/lib/types';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp, type FotosParaWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { adjuntaArchivos } from '@/shared/lib/fotosWhatsapp';
import { descargarOrdenSalidaPdf, verComprobanteMaterialPdf, type ComprobanteMaterial } from '@/modules/salidas/salidaPdf';
import { listAutorizadoresActivos } from '@/modules/combustible/combustible.repository';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { RecepcionesTelefono } from './RecepcionesTelefono';
import { NombreUsuario } from '@/shared/ui/NombreUsuario';
import { createProducto, findBySku, getUnidades, siguienteSkuLibre } from './inventario.repository';
import { listAlmacenes } from './almacenes.repository';
import { registrarMovimiento } from './movimientos.repository';
import { CategoriaProductoSelect, asegurarCategoria, esCategoriaReal } from './CategoriaProductoSelect';
import { SIN_SEDE, nombreAlmacenVisible } from './sectorizacion';
import { useSectorizacion } from './useSectorizacion';
import {
  DIAS_HISTORICO, MAX_FOTOS_SALIDA, errorFotos, errorRetorno, errorSalida, errorTraslado, fechaHoraVE,
  filtrarPorRetornar, leerCantidad,
  mensajeEntrada, mensajeProductoNuevo, mensajeRetorno, mensajeSalidaLote, mensajeStock, mensajeTraslado, mensajeTrasladoLote, num,
  pendienteRetorno, stockPorPeriodo, textoRetorno, ultimosDias, type FotoSalida, type MovimientoStock, type SalidaTelefono,
} from './inventarioTelefono';
import {
  archivosFotosSalida, enlacesFotosSalida, listPorRetornar, listSalidasAlmacen, listSolicitudesModulo, listTrasladosTelefono,
  movimientosAlmacenDesde, precioDeSalidaTelefono, productosDeAlmacen,
  registrarSalidaTelefonoLote, reservarCodigoTelefono, retornarSalidaTelefono, subirFotosSalidaLote, trasladarTelefono, urlFotoSalida, type ProductoEnAlmacen,
} from './inventarioTelefono.repository';
import {
  buscarFilasSalida, buscarFilasTraslado, mensajeFilaSalida, mensajeFilaTraslado, mezclarSalidas, mezclarTraslados,
  numeroDeSolicitud, numeroTraslado, ordenDeSalidaTelefonoLote, ordenDeTrasladoTelefono, ordenDeTrasladoTelefonoLote, trasladoDeMovimiento,
  vistaFilaSalida, vistaFilaTraslado, type FilaSalida, type FilaTraslado,
} from './historicosTelefono';

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

type Paso = 'inicio' | 'nuevo' | 'entrada' | 'salida' | 'retornos' | 'traslado' | 'reporte' | 'historico' | 'historicoTraslados' | 'recepciones' | 'listo' | 'listoSalida';

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
  const [listo, setListo] = useState<{ titulo: string; texto: string; pdf?: ComprobanteMaterial; abrirPdf?: () => Promise<void> } | null>(null);
  // Una salida puede llevar varios materiales (04-11-2026): todas sus filas, mismo N° SAT.
  const [salidaHecha, setSalidaHecha] = useState<SalidaTelefono[] | null>(null);

  const cargarAlmacenes = useCallback(async () => {
    const as = await listAlmacenes('principal');
    setAlmacenes(as.filter((a) => a.estado === 'activo')
      .sort((a, b) => (a.sede ?? SIN_SEDE).localeCompare(b.sede ?? SIN_SEDE, 'es') || a.nombre.localeCompare(b.nombre, 'es')));
  }, []);
  useEffect(() => {
    cargarAlmacenes().catch((e) => { setAlmacenes([]); setLoading(false); toast(errMsg(e, 'No se pudieron cargar los almacenes'), 'error'); });
  }, [cargarAlmacenes]);
  useRealtime(['almacenes'], () => { void cargarAlmacenes().catch(() => {}); });

  // Los almacenes que se eligen arriba: el almacenista con sede ve solo los suyos
  // (02-11-2026, regla de la administradora); hasta saber de qué sede es cada uno, ninguno.
  const visibles = useMemo<Almacen[] | null>(() => {
    if (!almacenes) return null;
    if (!sector.sectorizado) return almacenes;
    if (!sector.listo) return null;
    return almacenes.filter((a) => sector.puedeMover(a.nombre));
  }, [almacenes, sector]);

  // Almacén por defecto: el recordado si sigue visible; si no, el primero de los suyos.
  useEffect(() => {
    if (!visibles) return;
    if (sel && visibles.some((a) => a.nombre === sel)) return;
    const primero = visibles[0];
    setSel(primero?.nombre ?? '');
    if (!primero) setLoading(false);
  }, [visibles, sel]);

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
  // Histórico de salidas (03-11-2026): «solo las de Carlos en el perfil de Carlos». El
  // almacenista con sede ve las que él registró o ejecutó; sin sede (administración), todas.
  const soloDe = sector.sectorizado ? (user?.email ?? '') : null;
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
  function hecho(titulo: string, texto: string, pdf?: ComprobanteMaterial, abrirPdf?: () => Promise<void>) {
    setListo({ titulo, texto, pdf, abrirPdf }); setPaso('listo'); setElegido(null);
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
      {!!almacenes?.length && visibles !== null && !visibles.length && (
        <p className="muted">Tu sede no tiene almacenes activos. Se crean desde Inventario en la PC.</p>
      )}

      {!!visibles?.length && (
        <div className="surt-campo">
          <label htmlFor="inv-tel-almacen">Almacén</label>
          <select id="inv-tel-almacen" className="input surt-input" value={almacen}
            disabled={paso !== 'inicio'} onChange={(e) => elegirAlmacen(e.target.value)}>
            {!almacen && <option value="">Elegir…</option>}
            {porSede(visibles).map(([sede, as]) => (
              <optgroup key={sede} label={sede}>
                {as.map((a) => <option key={a.id} value={a.nombre}>{nombreAlmacenVisible(a.nombre)}</option>)}
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

      {/* 02-11-2026: las salidas ya hechas, para volver a sacar su PDF o su WhatsApp. 03-11: también los
          traslados, y los dos botones uno al lado del otro (pedido de la administradora). Lo ve quien ve el almacén. */}
      {/* 04-11-2026: 📥 Recepciones en el teléfono: lo que entrega el delivery (o llega) entra al almacén elegido. */}
      {!loading && paso === 'inicio' && almacen && (
        <button type="button" className="surt-btn entrada" style={{ width: '100%', minHeight: 84, marginTop: '.75rem' }} onClick={() => setPaso('recepciones')}>
          <span>📥 Recepciones</span>
          <small>Las OC por recibir y lo que trajo el delivery: entra a {nombreAlm}</small>
        </button>
      )}
      {paso === 'recepciones' && almacen && (
        <RecepcionesTelefono almacen={almacen} canWrite={puedeMoverAqui} actor={actor} actorName={actorName} quien={quien} onVolver={volver} />
      )}

      {!loading && paso === 'inicio' && almacen && (
        <div className="surt-historicos">
          <button type="button" className="surt-btn salida" onClick={() => setPaso('historico')}>
            <span>🧾 Histórico de salidas</span>
            <small>PDF y WhatsApp de cada salida</small>
          </button>
          <button type="button" className="surt-btn traslado" onClick={() => setPaso('historicoTraslados')}>
            <span>🔁 Histórico de traslados</span>
            <small>PDF y WhatsApp de cada traslado</small>
          </button>
        </div>
      )}

      {paso === 'historico' && <HistoricoSalidas almacen={almacen} soloDe={soloDe} onVolver={volver} />}
      {paso === 'historicoTraslados' && <HistoricoTraslados almacen={almacen} onVolver={volver} />}

      {paso === 'listo' && listo && <Listo titulo={listo.titulo} texto={listo.texto} pdf={listo.pdf} abrirPdf={listo.abrirPdf} onVolver={volver} />}

      {paso === 'listoSalida' && salidaHecha && (
        <ListoSalida salidas={salidaHecha} quien={quien} onCambio={setSalidaHecha} onVolver={volver} />
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
        <FormSalida almacen={almacen} producto={prodActual} productos={productos} actor={actor} actorName={actorName}
          onCancel={() => setElegido(null)}
          onHecho={(s) => { setSalidaHecha(s); setPaso('listoSalida'); setElegido(null); void reload().catch(() => {}); }} />
      )}

      {paso === 'traslado' && prodActual && (
        <FormTraslado origen={almacen} destinos={destinos} producto={prodActual} productos={productos} actor={actor} actorName={actorName} quien={quien}
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
/**
 * Lo guardado: el aviso para WhatsApp y la vuelta al inicio. `pdf` es el comprobante
 * sencillo (entrada, traslado recién hecho); `abrirPdf`, otro PDF ya armado (la ORDEN
 * DE SALIDA del módulo, 03-11-2026).
 */
function Listo({ titulo, texto, pdf, abrirPdf, fotos, onVolver, volverTexto = '← Volver al inicio', children }: {
  titulo: string; texto: string; pdf?: ComprobanteMaterial; abrirPdf?: () => Promise<void>; fotos?: FotosParaWhatsapp;
  onVolver: () => void; volverTexto?: string; children?: ReactNode;
}) {
  const abrir = abrirPdf ?? (pdf ? () => verComprobanteMaterialPdf(pdf) : null);
  return (
    <div className="surt-form">
      <div className="surt-form-titulo"><span className="icono" aria-hidden>✅</span><strong>{titulo}</strong></div>
      {children}
      <CompartirWhatsapp texto={texto} fotos={fotos} />
      {abrir && <BotonPdf abrir={abrir} className="btn btn-ghost surt-guardar" texto="📄 Ver PDF del comprobante" />}
      <button type="button" className="btn btn-primary surt-guardar" onClick={onVolver}>{volverTexto}</button>
    </div>
  );
}

/**
 * El PDF (30-10-2026), en vista previa y solo con el botón (nada se descarga solo). En
 * el teléfono el visor ofrece abrirlo en su pestaña, porque dentro de la página no se
 * pinta (02-11-2026, ver shared/lib/reportPreview · muestraPdfEnPagina).
 */
function BotonPdf({ abrir, className, texto }: { abrir: () => Promise<void>; className: string; texto: string }) {
  const [abriendo, setAbriendo] = useState(false);
  async function verPdf() {
    setAbriendo(true);
    try { await abrir(); }
    catch (e) { toast(errMsg(e, 'No se pudo armar el PDF'), 'error'); }
    finally { setAbriendo(false); }
  }
  return (
    <button type="button" className={className} disabled={abriendo} onClick={() => void verPdf()}>
      {abriendo ? 'Armando el PDF…' : texto}
    </button>
  );
}

/**
 * La ORDEN DE SALIDA del módulo de Salidas para una salida del teléfono (03-11-2026,
 * «que sea como ya se tiene en salidas»), con el costo del almacén de ese momento.
 */
async function verOrdenSalidaTelefono(ss: SalidaTelefono[], quien: string): Promise<void> {
  const precios = await Promise.all(ss.map((s) => precioDeSalidaTelefono(s).catch(() => null)));
  const o = ordenDeSalidaTelefonoLote(ss, quien, precios);
  await descargarOrdenSalidaPdf(o.sol, o.opciones);
}

/** La salida ya guardada: se le pueden sumar fotos (hasta 4) y el aviso se rehace con ellas. */
function ListoSalida({ salidas, quien, onCambio, onVolver }: {
  salidas: SalidaTelefono[]; quien: string; onCambio: (ss: SalidaTelefono[]) => void; onVolver: () => void;
}) {
  const salida = salidas[0];
  const [subiendo, setSubiendo] = useState(false);
  const faltan = MAX_FOTOS_SALIDA - salida.fotos.length;
  const fotosWhatsapp = useFotosParaWhatsapp(salida.fotos);

  async function agregar(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (!archivos.length) return;
    const mal = errorFotos(archivos, salida.fotos.length);
    if (mal) { toast(mal, 'error'); return; }
    setSubiendo(true);
    try {
      onCambio(await subirFotosSalidaLote(salidas, archivos));
      toast(archivos.length === 1 ? 'Foto agregada.' : `${archivos.length} fotos agregadas.`, 'success');
    } catch (e) {
      toast(errMsg(e, 'No se pudieron subir las fotos'), 'error');
    } finally { setSubiendo(false); }
  }

  return (
    <Listo titulo={`Salida ${salida.codigo} registrada${salidas.length > 1 ? ` · ${salidas.length} materiales` : ''}`} texto={mensajeSalidaLote(salidas, quien)} fotos={fotosWhatsapp} onVolver={onVolver}
      abrirPdf={() => verOrdenSalidaTelefono(salidas, quien)}>
      {/* Las fotos se ven debajo del aviso de WhatsApp, que es con lo que se mandan (02-11-2026). */}
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

/**
 * Las fotos de la salida listas para ir CON el aviso de WhatsApp (02-11-2026):
 * como archivos para la hoja de compartir y, si este navegador no los adjunta,
 * como enlaces firmados de 7 días que van dentro del texto. Las recién subidas
 * no se vuelven a bajar (las guarda el repositorio al subirlas).
 */
function useFotosParaWhatsapp(fotos: FotoSalida[]): FotosParaWhatsapp | undefined {
  const clave = fotos.map((f) => f.path).join('|');
  const [listas, setListas] = useState<{ clave: string; fotos: FotosParaWhatsapp } | null>(null);
  useEffect(() => {
    if (!clave) return;
    let vivo = true;
    void (async () => {
      const archivos = await archivosFotosSalida(fotos).catch(() => [] as File[]);
      const enlaces = adjuntaArchivos(navigator, archivos) ? [] : await enlacesFotosSalida(fotos).catch(() => [] as string[]);
      if (vivo) setListas({ clave, fotos: { archivos, enlaces } });
    })();
    return () => { vivo = false; };
  }, [clave, fotos]);
  return useMemo(() => {
    if (!clave) return undefined;
    if (listas?.clave === clave) return listas.fotos;
    // Mientras se preparan (o al sumar una foto) se siguen viendo las que ya estaban.
    return { archivos: listas?.fotos.archivos ?? [], cargando: true };
  }, [clave, listas]);
}

/** Cuántas salidas se pintan de una vez en el histórico (el resto con «Ver más»). */
const POR_TANDA = 40;

/**
 * Histórico de salidas del almacén (02-11-2026, pedido de la administradora): la
 * lista de las salidas ya hechas, de la más nueva a la más vieja, con su PDF y su
 * WhatsApp (con las fotos de ESA salida, igual que al registrarla). Abre con los
 * últimos 60 días; los atajos y el buscador acotan. Lo ve quien ve el almacén: el
 * almacenista con sede solo llega a los de su sede por el selector de arriba.
 */
/** Atajos de fechas de los históricos (hoy, este mes, mes pasado, 60 y 90 días). */
function AtajosHistorico({ hoy, onRango }: { hoy: string; onRango: (r: { desde: string; hasta: string }) => void }) {
  function atajo(r: 'hoy' | 'mes' | 'mesPasado' | 'ult60' | 'ult90') {
    onRango(r === 'hoy' ? { desde: hoy, hasta: hoy }
      : r === 'ult60' ? ultimosDias(DIAS_HISTORICO, hoy)
      : r === 'ult90' ? rangoRapido('ult90', hoy)
      : rangoRapido(r, hoy));
  }
  return (
    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-ghost" onClick={() => atajo('hoy')}>Hoy</button>
      <button type="button" className="btn btn-ghost" onClick={() => atajo('mes')}>Este mes</button>
      <button type="button" className="btn btn-ghost" onClick={() => atajo('mesPasado')}>Mes pasado</button>
      <button type="button" className="btn btn-ghost" onClick={() => atajo('ult60')}>60 días</button>
      <button type="button" className="btn btn-ghost" onClick={() => atajo('ult90')}>90 días</button>
    </div>
  );
}

/** Desde / hasta de los históricos. */
function RangoHistorico({ id, hoy, desde, hasta, setDesde, setHasta }: {
  id: string; hoy: string; desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void;
}) {
  return (
    <div className="surt-grid2">
      <div className="surt-campo">
        <label htmlFor={`${id}-desde`}>Desde</label>
        <input id={`${id}-desde`} type="date" className="input surt-input" value={desde} max={hoy} onChange={(e) => setDesde(e.target.value)} />
      </div>
      <div className="surt-campo">
        <label htmlFor={`${id}-hasta`}>Hasta</label>
        <input id={`${id}-hasta`} type="date" className="input surt-input" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} />
      </div>
    </div>
  );
}

/**
 * Histórico de salidas del almacén (02-11-2026; 03-11: también las del módulo de Salidas
 * que ya descontaron stock, y «solo las de Carlos en el perfil de Carlos»: con `soloDe`
 * se ven solo las que registró o ejecutó ese usuario). Cada una con su ORDEN DE SALIDA
 * en PDF y su WhatsApp.
 */
function HistoricoSalidas({ almacen, soloDe, onVolver }: { almacen: string; soloDe: string | null; onVolver: () => void }) {
  const quienDe = useQuien();
  const hoy = hoyVenezuela();
  const inicial = ultimosDias(DIAS_HISTORICO, hoy);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [filas, setFilas] = useState<FilaSalida[] | null>(null);
  const [busca, setBusca] = useState('');
  const [tope, setTope] = useState(POR_TANDA);
  const [elegidaId, setElegidaId] = useState<string | null>(null);

  const rangoMalo = !desde || !hasta || desde > hasta || hasta > hoy;
  // Solo la última consulta pinta (si se cambian las fechas a mitad, la vieja se descarta).
  const turno = useRef(0);
  const cargar = useCallback(async () => {
    if (rangoMalo) return;
    const mio = ++turno.current;
    try {
      const [tel, mod] = await Promise.all([
        listSalidasAlmacen(almacen, desde, hasta),
        listSolicitudesModulo('salida', desde, hasta).catch(() => [] as SolicitudSalida[]),
      ]);
      if (mio === turno.current) setFilas(mezclarSalidas(tel, mod, almacen, soloDe));
    } catch (e) {
      if (mio === turno.current) { setFilas([]); toast(errMsg(e, 'No se pudo leer el histórico de salidas'), 'error'); }
    }
  }, [almacen, desde, hasta, rangoMalo, soloDe]);
  useEffect(() => { setFilas(null); setTope(POR_TANDA); void cargar(); }, [cargar]);
  // Al día con lo que registran otros (una salida nueva, un retorno, fotos, una ejecución del módulo).
  useRealtime(['inventario_salidas_telefono', 'solicitudes_salida'], () => { void cargar(); });

  const registro = useCallback((f: FilaSalida) => {
    const r = f.origen === 'telefono' ? f.salida : f.sol;
    return quienDe(r.actor_name ?? null, r.actor ?? null) || r.actor_name || r.actor || '';
  }, [quienDe]);
  const lista = useMemo(() => buscarFilasSalida(filas ?? [], busca), [filas, busca]);
  const elegida = elegidaId ? (filas ?? []).find((f) => f.id === elegidaId) ?? null : null;

  if (elegida) {
    return elegida.origen === 'telefono'
      ? <SalidaDelHistorico grupo={elegida.grupo} quien={registro(elegida)} onVolver={() => setElegidaId(null)} />
      : (
        <Listo titulo={`Salida ${numeroDeSolicitud(elegida.sol)}`} texto={mensajeFilaSalida(elegida, registro(elegida))}
          abrirPdf={() => descargarOrdenSalidaPdf(elegida.sol)} onVolver={() => setElegidaId(null)} volverTexto="← Volver al histórico" />
      );
  }

  return (
    <section className="surt-lista">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
        <strong style={{ fontSize: '1.1rem' }}>🧾 Histórico de salidas · {nombreAlmacenVisible(almacen)}</strong>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>← Volver</button>
      </div>
      {soloDe !== null && <p className="muted" style={{ margin: '0 0 .4rem' }}>Solo las salidas que registraste o ejecutaste tú.</p>}
      <AtajosHistorico hoy={hoy} onRango={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />
      <RangoHistorico id="inv-tel-hist" hoy={hoy} desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <input className="input surt-input" type="search" name="inv-tel-hist-buscar" placeholder="🔍 Material, N° SAT / SAL o motivo…"
        value={busca} onChange={(e) => { setBusca(e.target.value); setTope(POR_TANDA); }} autoComplete="off" aria-label="Buscar en el histórico de salidas" />
      {rangoMalo ? (
        <div className="aviso warning sm"><span className="aviso-icono">⚠</span><div>Revisa las fechas: «desde» no puede ir después de «hasta» ni pasar de hoy.</div></div>
      ) : filas === null ? (
        <p className="muted">Cargando salidas…</p>
      ) : (
        <>
          <h2>
            {busca.trim()
              ? (lista.length ? `${lista.length} encontrada(s) de ${filas.length}` : 'Ninguna salida coincide')
              : `${filas.length} salida(s) en esas fechas`}
          </h2>
          {!filas.length && <p className="muted">No hay salidas de {nombreAlmacenVisible(almacen)} en esas fechas.</p>}
          {lista.slice(0, tope).map((f) => {
            const v = vistaFilaSalida(f, registro(f));
            return (
              <div key={f.id} className="surt-mov surt-hist">
                <span className="icono" aria-hidden>📤</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{v.titulo}</div>
                  {v.lineas.map((l) => <div key={l} className="sub">{l}</div>)}
                  <div className="sub"><strong>{v.estado}</strong> · {v.origen}{f.origen === 'telefono' && f.salida.fotos.length ? ` · 📷 ${f.salida.fotos.length}` : ''}</div>
                </span>
                <span className="litros">−{v.cantidad}</span>
                <div className="surt-hist-acciones">
                  <BotonPdf
                    abrir={() => (f.origen === 'telefono' ? verOrdenSalidaTelefono(f.grupo, registro(f)) : descargarOrdenSalidaPdf(f.sol))}
                    className="btn btn-ghost btn-grande" texto="📄 Ver PDF" />
                  <button type="button" className="btn btn-ghost btn-grande" onClick={() => { setElegidaId(f.id); window.scrollTo(0, 0); }}>
                    💬 WhatsApp
                  </button>
                </div>
              </div>
            );
          })}
          {lista.length > tope && (
            <button type="button" className="btn btn-ghost btn-grande" style={{ width: '100%' }} onClick={() => setTope((t) => t + POR_TANDA)}>
              Ver más ({lista.length - tope} restantes)
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Histórico de traslados (03-11-2026, «quiero que también haya un histórico de traslados»):
 * los del teléfono (kardex) y los del módulo de Traslados que tocan el almacén, con su
 * ORDEN en PDF y su WhatsApp.
 */
function HistoricoTraslados({ almacen, onVolver }: { almacen: string; onVolver: () => void }) {
  const quienDe = useQuien();
  const hoy = hoyVenezuela();
  const inicial = ultimosDias(DIAS_HISTORICO, hoy);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [filas, setFilas] = useState<FilaTraslado[] | null>(null);
  const [busca, setBusca] = useState('');
  const [tope, setTope] = useState(POR_TANDA);
  const [elegidoId, setElegidoId] = useState<string | null>(null);

  const rangoMalo = !desde || !hasta || desde > hasta || hasta > hoy;
  const turno = useRef(0);
  const cargar = useCallback(async () => {
    if (rangoMalo) return;
    const mio = ++turno.current;
    try {
      const [movs, mod] = await Promise.all([
        listTrasladosTelefono(almacen, desde, hasta),
        listSolicitudesModulo('traslado', desde, hasta).catch(() => [] as SolicitudSalida[]),
      ]);
      const tel = movs.map(trasladoDeMovimiento).filter((t): t is NonNullable<typeof t> => t !== null);
      if (mio === turno.current) setFilas(mezclarTraslados(tel, mod, almacen));
    } catch (e) {
      if (mio === turno.current) { setFilas([]); toast(errMsg(e, 'No se pudo leer el histórico de traslados'), 'error'); }
    }
  }, [almacen, desde, hasta, rangoMalo]);
  useEffect(() => { setFilas(null); setTope(POR_TANDA); void cargar(); }, [cargar]);
  useRealtime(['solicitudes_salida'], () => { void cargar(); });

  const registro = useCallback((f: FilaTraslado) => {
    const r = f.origen === 'telefono' ? f.traslado : f.sol;
    return quienDe(r.actor_name ?? null, r.actor ?? null) || r.actor_name || r.actor || '';
  }, [quienDe]);
  const lista = useMemo(() => buscarFilasTraslado(filas ?? [], busca), [filas, busca]);
  const elegido = elegidoId ? (filas ?? []).find((f) => f.id === elegidoId) ?? null : null;
  const pdfDe = (f: FilaTraslado) => (f.origen === 'telefono'
    ? (() => {
      const t = f.traslado;
      const o = f.grupo.length > 1
        ? ordenDeTrasladoTelefonoLote({
          origen: t.origen, destino: t.destino, motivo: t.motivo, quien: registro(f), actor: t.actor ?? '', actorName: t.actor_name, at: t.at, codigo: t.codigo,
          lineas: f.grupo.map((x) => ({ producto_id: x.producto_id, nombre: x.producto_nombre, unidad: x.unidad, cantidad: x.cantidad, precio: x.precio })),
        })
        : ordenDeTrasladoTelefono(t, registro(f));
      return descargarOrdenSalidaPdf(o.sol, o.opciones);
    })()
    : descargarOrdenSalidaPdf(f.sol));

  if (elegido) {
    return (
      <Listo titulo={`Traslado ${elegido.origen === 'telefono' ? numeroTraslado(elegido.traslado) : numeroDeSolicitud(elegido.sol)}`}
        texto={mensajeFilaTraslado(elegido, registro(elegido))} abrirPdf={() => pdfDe(elegido)}
        onVolver={() => setElegidoId(null)} volverTexto="← Volver al histórico" />
    );
  }

  return (
    <section className="surt-lista">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', margin: '.5rem 0' }}>
        <strong style={{ fontSize: '1.1rem' }}>🔁 Histórico de traslados · {nombreAlmacenVisible(almacen)}</strong>
        <button type="button" className="btn btn-ghost" onClick={onVolver}>← Volver</button>
      </div>
      <AtajosHistorico hoy={hoy} onRango={(r) => { setDesde(r.desde); setHasta(r.hasta); }} />
      <RangoHistorico id="inv-tel-histt" hoy={hoy} desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <input className="input surt-input" type="search" name="inv-tel-histt-buscar" placeholder="🔍 Material, N°, motivo o almacén…"
        value={busca} onChange={(e) => { setBusca(e.target.value); setTope(POR_TANDA); }} autoComplete="off" aria-label="Buscar en el histórico de traslados" />
      {rangoMalo ? (
        <div className="aviso warning sm"><span className="aviso-icono">⚠</span><div>Revisa las fechas: «desde» no puede ir después de «hasta» ni pasar de hoy.</div></div>
      ) : filas === null ? (
        <p className="muted">Cargando traslados…</p>
      ) : (
        <>
          <h2>
            {busca.trim()
              ? (lista.length ? `${lista.length} encontrado(s) de ${filas.length}` : 'Ningún traslado coincide')
              : `${filas.length} traslado(s) en esas fechas`}
          </h2>
          {!filas.length && <p className="muted">No hay traslados de {nombreAlmacenVisible(almacen)} en esas fechas.</p>}
          {lista.slice(0, tope).map((f) => {
            const v = vistaFilaTraslado(f, registro(f));
            return (
              <div key={f.id} className="surt-mov surt-hist">
                <span className="icono" aria-hidden>🔁</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{v.titulo}</div>
                  {v.lineas.map((l) => <div key={l} className="sub">{l}</div>)}
                  <div className="sub"><strong>{v.estado}</strong> · {v.origen}</div>
                </span>
                <span className="litros">{v.cantidad}</span>
                <div className="surt-hist-acciones">
                  <BotonPdf abrir={() => pdfDe(f)} className="btn btn-ghost btn-grande" texto="📄 Ver PDF" />
                  <button type="button" className="btn btn-ghost btn-grande" onClick={() => { setElegidoId(f.id); window.scrollTo(0, 0); }}>
                    💬 WhatsApp
                  </button>
                </div>
              </div>
            );
          })}
          {lista.length > tope && (
            <button type="button" className="btn btn-ghost btn-grande" style={{ width: '100%' }} onClick={() => setTope((t) => t + POR_TANDA)}>
              Ver más ({lista.length - tope} restantes)
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Una salida del histórico: su WhatsApp (con sus fotos), su PDF y la vuelta a la lista. */
function SalidaDelHistorico({ grupo, quien, onVolver }: { grupo: SalidaTelefono[]; quien: string; onVolver: () => void }) {
  const salida = grupo[0];
  const fotosWhatsapp = useFotosParaWhatsapp(salida.fotos);
  return (
    <Listo titulo={`Salida ${salida.codigo}`} texto={mensajeSalidaLote(grupo, quien)} fotos={fotosWhatsapp}
      abrirPdf={() => verOrdenSalidaTelefono(grupo, quien)} onVolver={onVolver} volverTexto="← Volver al histórico">
      <div className="surt-detalle">
        {grupo.map((x) => (
          <div key={x.id} className="surt-fila"><span>{x.producto_nombre}</span><span>{num(x.cantidad)} {x.unidad ?? ''}</span></div>
        ))}
        <div className="surt-fila"><span>Fecha</span><span>{fechaHoraVE(salida.created_at)}</span></div>
        <div className="surt-fila"><span>Motivo</span><span>{salida.motivo}</span></div>
        {salida.autorizado_por && <div className="surt-fila"><span>Autorizó</span><span>{salida.autorizado_por}</span></div>}
        <div className="surt-fila"><span>Retorno</span><span>{textoRetorno(salida)}</span></div>
        {quien && <div className="surt-fila"><span>Registró</span><span>{quien}</span></div>}
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

/** Un material de una salida o traslado con varios (04-11-2026). */
interface LineaMaterial { producto: ProductoEnAlmacen; cantidad: string }

/**
 * La lista de materiales de una salida o un traslado (04-11-2026, pedido de la
 * administradora: «permite poder cargar varios productos en una sola salida o en un
 * solo traslado»). Cada uno con su cantidad; se agregan más buscando en el almacén.
 */
function LineasMateriales({ id, productos, lineas, setLineas }: {
  id: string; productos: ProductoEnAlmacen[]; lineas: LineaMaterial[]; setLineas: (fn: (ls: LineaMaterial[]) => LineaMaterial[]) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [q, setQ] = useState('');
  const yaEstan = new Set(lineas.map((l) => l.producto.id));
  const candidatos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return productos
      .filter((p) => p.stock_almacen > 0 && !yaEstan.has(p.id) && (!t || `${p.nombre} ${p.sku}`.toLowerCase().includes(t)))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productos, q, lineas]);
  // Siempre con el stock al día (el realtime puede cambiarlo mientras se llena).
  const actual = (p: ProductoEnAlmacen) => productos.find((x) => x.id === p.id) ?? p;

  return (
    <div className="surt-campo">
      <span className="surt-rotulo">Materiales ({lineas.length})</span>
      <div style={{ display: 'grid', gap: '.5rem' }}>
        {lineas.map((l, i) => {
          const p = actual(l.producto);
          const cant = leerCantidad(l.cantidad);
          return (
            <div key={p.id} className="card" style={{ margin: 0, padding: '.55rem .65rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.4rem', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{p.nombre}</strong>
                  <small className="muted">{p.sku} · hay {num(p.stock_almacen)} {p.unidad}</small>
                </div>
                {lineas.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Quitar ${p.nombre}`}
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
              <input id={`${id}-cant-${i}`} className="input surt-litros" inputMode="decimal" value={l.cantidad} placeholder="0"
                aria-label={`Cantidad de ${p.nombre} (${p.unidad})`} autoFocus={i === lineas.length - 1}
                onChange={(e) => { const v = e.target.value; setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: v } : x))); }} />
              {cant > 0 && (cant > p.stock_almacen
                ? <small className="surt-alerta">No alcanza: hay {num(p.stock_almacen)} {p.unidad}.</small>
                : <small className="muted">Quedan {num(p.stock_almacen - cant)} {p.unidad}.</small>)}
            </div>
          );
        })}
      </div>
      {!buscando ? (
        <button type="button" className="btn btn-ghost btn-grande" style={{ marginTop: '.5rem' }} onClick={() => { setBuscando(true); setQ(''); }}>
          ＋ Agregar otro material
        </button>
      ) : (
        <div style={{ marginTop: '.5rem', display: 'grid', gap: '.35rem' }}>
          <input className="input surt-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            placeholder="🔍 Buscar el material…" aria-label="Buscar material para agregar" autoComplete="off" />
          {candidatos.map((p) => (
            <button key={p.id} type="button" className="surt-mov" onClick={() => { setLineas((ls) => [...ls, { producto: p, cantidad: '' }]); setBuscando(false); }}>
              <span className="icono" aria-hidden>📦</span>
              <span style={{ minWidth: 0 }}><div className="titulo">{p.nombre}</div><div className="sub">{p.sku} · {p.categoria}</div></span>
              <span className="litros">{num(p.stock_almacen)} <small style={{ fontWeight: 600 }}>{p.unidad}</small></span>
            </button>
          ))}
          {!candidatos.length && <small className="muted">No hay más materiales con existencia que coincidan.</small>}
          <button type="button" className="btn btn-ghost" onClick={() => setBuscando(false)}>Cerrar búsqueda</button>
        </div>
      )}
    </div>
  );
}

/** Qué está mal en la lista (null si todo bien). */
function errorLineas(lineas: LineaMaterial[], productos: ProductoEnAlmacen[]): string | null {
  if (!lineas.length) return 'Agrega al menos un material.';
  for (const l of lineas) {
    const p = productos.find((x) => x.id === l.producto.id) ?? l.producto;
    const c = leerCantidad(l.cantidad);
    if (!(c > 0)) return `Escribe cuánto de ${p.nombre}.`;
    if (c > p.stock_almacen) return `No alcanza ${p.nombre}: hay ${num(p.stock_almacen)} ${p.unidad}.`;
  }
  return null;
}

function FormSalida({ almacen, producto, productos, actor, actorName, onCancel, onHecho }: {
  almacen: string; producto: ProductoEnAlmacen; productos: ProductoEnAlmacen[]; actor: string; actorName: string | null;
  onCancel: () => void; onHecho: (ss: SalidaTelefono[]) => void;
}) {
  const [lineas, setLineas] = useState<LineaMaterial[]>([{ producto, cantidad: '' }]);
  const [motivo, setMotivo] = useState('');
  const [autorizado, setAutorizado] = useState('');
  const [retorna, setRetorna] = useState<boolean | null>(null);
  const [fotos, setFotos] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const malLineas = errorLineas(lineas, productos);

  // Quién autoriza (03-11-2026): la MISMA lista que Combustible (catálogo «Autorizados»
  // del surtidor), pedido de la administradora: «te traigas al de combustible». Antes
  // salía de los usuarios con «aprobar salidas» en Roles y Permisos.
  const [autorizadores, setAutorizadores] = useState<string[] | null>(null);
  const cargarAutorizadores = useCallback(() => {
    listAutorizadoresActivos().then(setAutorizadores).catch(() => setAutorizadores((xs) => xs ?? []));
  }, []);
  useEffect(() => { cargarAutorizadores(); }, [cargarAutorizadores]);
  useRealtime(['combustible_autorizados'], cargarAutorizadores);

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
    if (malLineas) return toast(malLineas, 'error');
    for (const l of lineas) {
      const pr = productos.find((x) => x.id === l.producto.id) ?? l.producto;
      const problema = errorSalida({ productoId: pr.id, cantidad: leerCantidad(l.cantidad), stock: pr.stock_almacen, motivo, autorizado, retorna });
      if (problema) return toast(problema, 'error');
    }
    setGuardando(true);
    try {
      let ss = await registrarSalidaTelefonoLote({
        lineas: lineas.map((l) => ({ producto: l.producto, cantidad: leerCantidad(l.cantidad) })),
        almacen, motivo, autorizadoPor: autorizado, retorna: !!retorna, actor, actorName,
      });
      if (fotos.length) {
        try { ss = await subirFotosSalidaLote(ss, fotos); }
        catch (err) { toast(`La salida quedó registrada, pero las fotos no subieron: ${errMsg(err, 'error')}. Puedes volver a agregarlas.`, 'warning'); }
      }
      toast(ss.length > 1 ? `Salida ${ss[0].codigo}: ${ss.length} materiales` : `Salida ${ss[0].codigo}: −${num(ss[0].cantidad)} ${producto.unidad} de ${producto.nombre}`, 'success');
      onHecho(ss);
    } catch (err) {
      toast(errMsg(err, 'No se pudo registrar la salida'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>⬆</span><strong>Salida · {nombreAlmacenVisible(almacen)}</strong></div>
      <LineasMateriales id="inv-tel-salida" productos={productos} lineas={lineas} setLineas={setLineas} />
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-motivo">Motivo</label>
        <input id="inv-tel-salida-motivo" className="input surt-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Para qué sale, a quién, a qué equipo…" autoComplete="off" />
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-tel-salida-autorizado">¿Quién autorizó?</label>
        <select id="inv-tel-salida-autorizado" className="input surt-input" value={autorizado} onChange={(e) => setAutorizado(e.target.value)}>
          <option value="">{autorizadores === null ? 'Cargando…' : 'Elegir…'}</option>
          {(autorizadores ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {autorizadores !== null && !autorizadores.length && (
          <small className="surt-alerta">No hay autorizados activos en el catálogo de Combustible (Combustible › Catálogo › Autorizados).</small>
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
        disabled={guardando || !!malLineas || retorna === null || !autorizado.trim()}>
        {guardando ? 'Guardando…' : lineas.length > 1 ? `✓ Guardar salida (${lineas.length} materiales)` : '✓ Guardar salida'}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Otro material</button>
    </form>
  );
}

function FormTraslado({ origen, destinos, producto, productos, actor, actorName, quien, onCancel, onHecho }: {
  origen: string; destinos: Almacen[]; producto: ProductoEnAlmacen; productos: ProductoEnAlmacen[]; actor: string; actorName: string | null; quien: string;
  onCancel: () => void; onHecho: (titulo: string, texto: string, pdf?: ComprobanteMaterial, abrirPdf?: () => Promise<void>) => void;
}) {
  const [destino, setDestino] = useState('');
  const [lineas, setLineas] = useState<LineaMaterial[]>([{ producto, cantidad: '' }]);
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const deNombre = nombreAlmacenVisible(origen);
  const aNombre = destino ? nombreAlmacenVisible(destino) : '';
  const malLineas = errorLineas(lineas, productos);
  const actual = (x: ProductoEnAlmacen) => productos.find((y) => y.id === x.id) ?? x;
  const problemaDe = () => {
    if (malLineas) return malLineas;
    for (const l of lineas) {
      const pr = actual(l.producto);
      const pb = errorTraslado({ productoId: pr.id, origen, destino, cantidad: leerCantidad(l.cantidad), stock: pr.stock_almacen, motivo });
      if (pb) return pb;
    }
    return null;
  };

  function revisar(e: FormEvent) {
    e.preventDefault();
    const problema = problemaDe();
    if (problema) return toast(problema, 'error');
    setConfirmando(true);
  }

  async function trasladar() {
    const problema = problemaDe();
    if (problema) { setConfirmando(false); return toast(problema, 'error'); }
    setGuardando(true);
    const hechos: LineaMaterial[] = [];
    try {
      // Un N° por traslado, el del almacenista (TRA-ISNER-0001), para todos sus materiales.
      const codigo = await reservarCodigoTelefono('traslado');
      for (const l of lineas) {
        await trasladarTelefono({ producto: l.producto, origen, destino, cantidad: leerCantidad(l.cantidad), motivo, actor, actorName, codigo });
        hechos.push(l);
      }
      const at = new Date().toISOString();
      const ls = lineas.map((l) => ({ producto_id: l.producto.id, nombre: l.producto.nombre, sku: l.producto.sku, unidad: l.producto.unidad, cantidad: leerCantidad(l.cantidad), precio: Number(l.producto.precio) || null }));
      toast(lineas.length > 1 ? `Traslado a ${aNombre}: ${lineas.length} materiales` : `Traslado: ${num(ls[0].cantidad)} ${producto.unidad} de ${producto.nombre} a ${aNombre}`, 'success');
      const texto = lineas.length > 1
        ? mensajeTrasladoLote({ origen, destino, lineas: ls, motivo, quien, cuando: at, codigo })
        : mensajeTraslado({ origen, destino, nombre: producto.nombre, sku: producto.sku, unidad: producto.unidad, cantidad: ls[0].cantidad, motivo, quedaOrigen: Math.max(0, actual(producto).stock_almacen - ls[0].cantidad), quien, codigo });
      const orden = ordenDeTrasladoTelefonoLote({ origen, destino, motivo, quien, actor, actorName, at, lineas: ls, codigo });
      onHecho(`Traslado ${codigo} a ${aNombre} registrado${lineas.length > 1 ? ` · ${lineas.length} materiales` : ''}`, texto, undefined,
        () => descargarOrdenSalidaPdf(orden.sol, orden.opciones));
    } catch (err) {
      if (hechos.length) toast(`Se trasladaron ${hechos.length} material(es); el resto no: revisa y vuelve a intentar.`, 'warning');
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
          {lineas.map((l) => (
            <div key={l.producto.id} className="surt-fila"><span>{l.producto.nombre}</span><span>{num(leerCantidad(l.cantidad))} {l.producto.unidad}</span></div>
          ))}
          <div className="surt-fila"><span>De</span><span>{deNombre}</span></div>
          <div className="surt-fila"><span>A</span><span>{aNombre}</span></div>
          <div className="surt-fila"><span>Motivo</span><span>{motivo.trim()}</span></div>
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
      <div className="surt-form-titulo"><span className="icono" aria-hidden>🔁</span><strong>Traslado · desde {deNombre}</strong></div>
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
      <LineasMateriales id="inv-tel-traslado" productos={productos} lineas={lineas} setLineas={setLineas} />
      <div className="surt-campo">
        <label htmlFor="inv-tel-traslado-motivo">Motivo</label>
        <input id="inv-tel-traslado-motivo" className="input surt-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="Para qué se lleva, quién lo lleva…" autoComplete="off" />
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={!destino || !!malLineas}>
        🔁 Revisar traslado{lineas.length > 1 ? ` (${lineas.length} materiales)` : ''}
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
