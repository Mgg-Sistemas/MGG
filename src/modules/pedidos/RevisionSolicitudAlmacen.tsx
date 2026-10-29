/* ============================================================
   MGG · Compras · Almacén revisa una Solicitud de Pedido (29-10-2026)

   Una SP en `revision_almacen`: renglón por renglón (o por lote) almacén dice
   si lo tiene y cuánto. Cada cambio se guarda en la base al rato (sin cerrar
   la revisión) para que otro usuario, o el teléfono, vea el avance en vivo:
   `ordenes` está en realtime. Solo se mandan los renglones tocados, así dos
   personas revisando renglones distintos no se pisan.

   «Marcar como revisada» lo cierra la base (`almacen_revisar_solicitud`): lo
   que falta pasa a Compras y, si almacén lo tiene todo, la SP queda
   «Atendida por almacén». El mensaje de WhatsApp de la revisión lo muestra el
   padre (`onRevisada`), porque al cerrarse la SP sale de la lista.

   La misma pantalla sirve en la PC y en el teléfono (`variante`).
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { dateTime, relTime, statusBadge } from '@/shared/lib/format';
import { parseMontoEs } from '@/shared/lib/montoEs';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { quienSolicita } from './quienSolicita';
import {
  cantidadSolicitada,
  disponibleAcotado,
  fmtCant,
  marcarLote,
  marcasIniciales,
  mensajeSolicitudPedido,
  resumenRevision,
  seRevisa,
  todoRevisado,
  type MarcaAlmacen,
} from './revisionAlmacen';
import { guardarMarcasAlmacen, marcarSolicitudRevisada, stockDeRenglones, type StockRenglon } from './revisionAlmacen.repository';

/** Lo que se espera antes de mandar a la base lo marcado (se juntan varios toques en una sola escritura). */
const ESPERA_GUARDAR_MS = 700;
/** Un renglón recién tocado acá no se pisa con lo que llega de la base durante este rato. */
const PROTEGER_LOCAL_MS = 4000;

interface Props {
  orden: Orden;
  variante?: 'pc' | 'telefono';
  /** La SP quedó revisada: el padre muestra el mensaje de WhatsApp y la saca de la lista. */
  onRevisada: (actualizada: Orden, revisor: string) => void;
}

type Lote = 'todo' | 'nada' | 'stock';

const LOTE_TEXTO: Record<Lote, string> = {
  todo: '✓ Hay todo',
  stock: 'Según stock del inventario',
  nada: '✗ No hay nada',
};

function mensajeError(e: unknown, respaldo: string): string {
  return e instanceof Error && e.message ? e.message : respaldo;
}

function sinClave<T>(obj: Record<string, T>, clave: string): Record<string, T> {
  if (!(clave in obj)) return obj;
  const out = { ...obj };
  delete out[clave];
  return out;
}

/** El número para el campo: coma decimal y sin separador de miles (0,5 · 1250). */
function paraCampo(n: number): string {
  return String(Math.round((Number(n) || 0) * 10000) / 10000).replace('.', ',');
}

export function RevisionSolicitudAlmacen({ orden, variante = 'pc', onRevisada }: Props) {
  const telefono = variante === 'telefono';
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('inventario', 'escritura');
  const revisor = appUser?.nombre?.trim() || user?.email || 'Almacén';

  const items = useMemo(() => orden.items ?? [], [orden.items]);
  const aRevisar = useMemo(() => items.filter(seRevisa), [items]);

  // ── Marcas: el estado local manda; la base se actualiza al rato ──
  const marcasRef = useRef<Record<string, MarcaAlmacen>>(marcasIniciales(items));
  const [marcas, setMarcas] = useState<Record<string, MarcaAlmacen>>(marcasRef.current);
  const sucias = useRef(new Set<string>());
  const tocadoEn = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cerrada = useRef(false);
  /** Mientras se cierra la revisión, un guardado que falle (la SP ya cambió de estado) no se avisa. */
  const cerrandoRef = useRef(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // Lo que otro usuario (o el teléfono) guardó llega por realtime: se toma, salvo los
  // renglones que se están tocando acá y todavía no llegaron (o acaban de llegar) a la base.
  useEffect(() => {
    const remotas = marcasIniciales(items);
    const ahora = Date.now();
    const next: Record<string, MarcaAlmacen> = { ...remotas };
    for (const [sku, m] of Object.entries(marcasRef.current)) {
      const reciente = ahora - (tocadoEn.current.get(sku) ?? 0) < PROTEGER_LOCAL_MS;
      if (sku in remotas && (sucias.current.has(sku) || reciente)) next[sku] = m;
    }
    marcasRef.current = next;
    setMarcas(next);
  }, [items]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (cerrada.current) return;
    const skus = [...sucias.current];
    if (!skus.length) return;
    sucias.current.clear();
    const parcial: Record<string, MarcaAlmacen> = {};
    for (const s of skus) if (marcasRef.current[s]) parcial[s] = marcasRef.current[s];
    // Mientras viaja (y un rato después) lo local no se pisa con una lectura vieja de la base.
    const protegerAhora = () => { const t = Date.now(); for (const s of skus) tocadoEn.current.set(s, t); };
    protegerAhora();
    setGuardando(true);
    try {
      await guardarMarcasAlmacen(orden.id, parcial);
      protegerAhora();
      setErrorGuardar(null);
    } catch (e) {
      // Se reintenta con el próximo cambio: lo marcado no se pierde de la pantalla.
      for (const s of skus) sucias.current.add(s);
      if (cerrandoRef.current || cerrada.current) return;
      const msg = mensajeError(e, 'No se pudo guardar la revisión');
      setErrorGuardar(msg);
      toast(msg, 'error');
    } finally {
      setGuardando(false);
    }
  }, [orden.id]);

  // Al salir de la SP (otra SP, volver a la lista) se guarda lo pendiente.
  useEffect(() => () => { void flush(); }, [flush]);

  const aplicar = useCallback((cambios: Record<string, MarcaAlmacen>) => {
    const next = { ...marcasRef.current, ...cambios };
    marcasRef.current = next;
    setMarcas(next);
    const ahora = Date.now();
    for (const sku of Object.keys(cambios)) {
      sucias.current.add(sku);
      tocadoEn.current.set(sku, ahora);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, ESPERA_GUARDAR_MS);
  }, [flush]);

  // ── Stock del inventario de cada renglón (una vez por SP) ──
  const [stock, setStock] = useState<Map<string, StockRenglon> | null>(null);
  useEffect(() => {
    let vivo = true;
    setStock(null);
    stockDeRenglones(orden.items ?? [])
      .then((m) => { if (vivo) setStock(m); })
      .catch(() => { if (vivo) setStock(new Map()); });
    return () => { vivo = false; };
    // Solo al cambiar de SP: los renglones no cambian mientras está en revisión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orden.id]);

  // ── Campo «Disponible» mientras se escribe (texto, para aceptar «0,5») ──
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [nota, setNota] = useState(orden.nota_almacen ?? '');
  const [lotePendiente, setLotePendiente] = useState<Lote | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [verMensajeSP, setVerMensajeSP] = useState(false);

  const resumen = useMemo(() => resumenRevision(items, marcas), [items, marcas]);
  const nRevisados = aRevisar.filter((it) => marcas[it.sku]?.revisado).length;
  const listo = todoRevisado(items, marcas);
  const bloqueado = !canWrite || cerrando;

  function marcarHay(it: ItemOrden) {
    const pedido = cantidadSolicitada(it);
    const prev = marcasRef.current[it.sku];
    const st = stock?.get(it.sku);
    // Si ya tenía una cantidad, se respeta; si el inventario dice que hay menos de lo
    // pedido (pero algo hay), se propone eso; si no, todo lo pedido.
    const disp = prev?.revisado && prev.disponible > 0
      ? prev.disponible
      : st?.productoId && st.stock > 0 && st.stock < pedido ? st.stock : pedido;
    aplicar({ [it.sku]: { disponible: disponibleAcotado(it, disp), revisado: true } });
  }

  function marcarNoHay(it: ItemOrden) {
    aplicar({ [it.sku]: { disponible: 0, revisado: true } });
    setEditando((prev) => sinClave(prev, it.sku));
  }

  function confirmarDisponible(it: ItemOrden) {
    const texto = editando[it.sku];
    setEditando((prev) => sinClave(prev, it.sku));
    if (texto == null || !texto.trim()) return;
    const pedido = cantidadSolicitada(it);
    const n = parseMontoEs(texto);
    if (n > pedido) toast(`No puede ser más de lo pedido (${fmtCant(pedido)}${it.unidad ? ' ' + it.unidad : ''}).`, 'warning');
    const disp = disponibleAcotado(it, n);
    const prev = marcasRef.current[it.sku];
    if (prev?.revisado && prev.disponible === disp) return;
    aplicar({ [it.sku]: { disponible: disp, revisado: true } });
  }

  function pedirLote(modo: Lote) {
    if (bloqueado) return;
    if (modo === 'stock' && !stock) return;
    // Si ya hay renglones marcados, se pregunta antes de pisarlos a todos.
    if (nRevisados > 0) { setLotePendiente(modo); return; }
    aplicarLote(modo);
  }

  function aplicarLote(modo: Lote) {
    setLotePendiente(null);
    const mapa = new Map<string, number>();
    if (stock) for (const [sku, s] of stock) mapa.set(sku, s.stock);
    aplicar(marcarLote(items, modo, mapa));
    setEditando({});
  }

  async function cerrarRevision() {
    setConfirmar(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setCerrando(true);
    cerrandoRef.current = true;
    try {
      // Va con TODAS las marcas: lo pendiente de guardar entra acá mismo.
      const actualizada = await marcarSolicitudRevisada(orden.id, marcasRef.current, nota.trim() || null);
      cerrada.current = true;
      sucias.current.clear();
      toast(actualizada.estado === 'atendida_almacen'
        ? `${orden.codigo}: almacén tiene todo, no pasa a Compras`
        : `${orden.codigo} revisada: lo que falta pasó a Compras`, 'success');
      onRevisada(actualizada, revisor);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo marcar la solicitud como revisada'), 'error');
    } finally {
      cerrandoRef.current = false;
      setCerrando(false);
    }
  }

  const solicitaPersona = quienSolicita(orden);
  const finalidad = (orden.finalidad ?? orden.motivo ?? '').trim();
  const btnTam = telefono ? 'btn-grande' : 'btn-sm';

  return (
    <div className="rev-almacen">
      {/* ── Cabecera de la SP ── */}
      <div className="card" style={{ padding: telefono ? '.8rem' : '1rem 1.1rem', marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong className="mono" style={{ fontSize: telefono ? '1.25rem' : '1.15rem' }}>📋 {orden.codigo}</strong>
              {orden.urgente && <span className="badge danger">🚨 URGENTE</span>}
              <span className="badge warning">En revisión de almacén</span>
            </div>
            <div className="muted" style={{ fontSize: '.84rem', marginTop: '.25rem' }}>
              📅 {dateTime(orden.created_at)} · {relTime(orden.created_at)}
            </div>
            {(orden.solicitante || solicitaPersona) && (
              <div style={{ fontSize: '.9rem', marginTop: '.2rem' }}>
                👤 {[orden.solicitante, solicitaPersona].filter(Boolean).join(' — ')}
              </div>
            )}
            {finalidad && <div style={{ fontSize: '.9rem', marginTop: '.2rem' }}>🎯 {finalidad}</div>}
            {orden.notas?.trim() && <div className="muted" style={{ fontSize: '.84rem', marginTop: '.2rem' }}>📝 {orden.notas.trim()}</div>}
          </div>
          <button type="button" className={`btn btn-ghost ${btnTam}`} onClick={() => setVerMensajeSP(true)}>
            💬 WhatsApp de la SP
          </button>
        </div>
      </div>

      {!canWrite && (
        <div className="aviso warning sm" style={{ marginBottom: '.75rem' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para revisar solicitudes hace falta escritura en Inventario.</div>
        </div>
      )}

      {/* ── Por lote ── */}
      <div className="surt-rotulo">Marcar todo de una vez</div>
      <div style={{ display: 'grid', gridTemplateColumns: telefono ? '1fr' : 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.45rem', marginBottom: '.75rem' }}>
        <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--success)' }} disabled={bloqueado} onClick={() => pedirLote('todo')}>
          {LOTE_TEXTO.todo}
        </button>
        <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--info)' }} disabled={bloqueado || !stock} onClick={() => pedirLote('stock')}
          title="Marca en cada renglón lo que dice el inventario (hasta lo pedido)">
          📦 {LOTE_TEXTO.stock}
        </button>
        <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--danger)' }} disabled={bloqueado} onClick={() => pedirLote('nada')}>
          {LOTE_TEXTO.nada}
        </button>
      </div>

      {/* ── Resumen en vivo ── */}
      <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.75rem', display: 'flex', gap: '.5rem .9rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Revisados <strong>{nRevisados}</strong> de <strong>{aRevisar.length}</strong></span>
        <span className="badge success">📦 Tiene {resumen.tiene.length}</span>
        <span className="badge primary">🛒 Va a Compras {resumen.falta.length}</span>
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>
          {guardando ? 'Guardando…' : errorGuardar ? '⚠ Sin guardar' : nRevisados ? '✓ Guardado' : ''}
        </span>
      </div>

      {/* ── Renglones ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem', marginBottom: '.85rem' }}>
        {items.map((it, idx) => (
          <Renglon
            key={`${it.sku}-${idx}`}
            it={it}
            marca={marcas[it.sku]}
            stock={stock ? stock.get(it.sku) ?? null : undefined}
            texto={editando[it.sku]}
            telefono={telefono}
            bloqueado={bloqueado}
            onHay={() => marcarHay(it)}
            onNoHay={() => marcarNoHay(it)}
            onTexto={(t) => setEditando((prev) => ({ ...prev, [it.sku]: t }))}
            onConfirmar={() => confirmarDisponible(it)}
          />
        ))}
      </div>

      {/* ── Nota y cierre ── */}
      <label className="surt-rotulo" htmlFor={`nota-alm-${orden.id}`} style={{ display: 'block' }}>Nota para Compras (opcional)</label>
      <textarea
        id={`nota-alm-${orden.id}`}
        className="input"
        rows={telefono ? 3 : 2}
        style={{ width: '100%', marginBottom: '.75rem', fontSize: telefono ? '1.05rem' : undefined }}
        placeholder="Ej.: el aceite que hay está abierto; se entrega lo que hay en Los Pinos"
        value={nota}
        disabled={bloqueado}
        onChange={(e) => setNota(e.target.value)}
      />
      <button
        type="button"
        className={`btn btn-primary ${telefono ? 'surt-guardar' : ''}`}
        style={telefono ? undefined : { width: '100%', minHeight: 46, fontWeight: 700 }}
        disabled={bloqueado || !listo}
        onClick={() => setConfirmar(true)}
        title={listo ? '' : 'Falta revisar algún renglón'}
      >
        {cerrando ? 'Marcando…' : '✅ Marcar como revisada'}
      </button>
      {!listo && aRevisar.length > 0 && (
        <div className="muted" style={{ fontSize: '.8rem', marginTop: '.35rem', textAlign: 'center' }}>
          Faltan {aRevisar.length - nRevisados} renglón(es) por revisar.
        </div>
      )}

      {lotePendiente && (
        <ConfirmDialog
          title={LOTE_TEXTO[lotePendiente]}
          message={<>Ya hay {nRevisados} renglón(es) revisados. Esto cambia <strong>todos</strong> los renglones de {orden.codigo}. ¿Seguir?</>}
          confirmText="Sí, marcar todo"
          onConfirm={() => aplicarLote(lotePendiente)}
          onCancel={() => setLotePendiente(null)}
        />
      )}

      {confirmar && (
        <ConfirmDialog
          title={`Marcar ${orden.codigo} como revisada`}
          success
          confirmText="✅ Marcar como revisada"
          message={resumen.falta.length
            ? <>Lo que falta (<strong>{resumen.falta.length}</strong> producto(s)) pasa a Compras para cotizar. Después ya no se puede cambiar desde Almacén.</>
            : <>Almacén tiene <strong>todo</strong>: la SP queda «Atendida por almacén» y no pasa a Compras.</>}
          preview={<ResumenListas tiene={resumen.tiene} falta={resumen.falta} />}
          onConfirm={() => void cerrarRevision()}
          onCancel={() => setConfirmar(false)}
        />
      )}

      {verMensajeSP && (
        <MensajeWhatsappModal
          titulo={`💬 Solicitud de Pedido ${orden.codigo}`}
          texto={mensajeSolicitudPedido(orden, { unidad: orden.solicitante, persona: solicitaPersona })}
          onClose={() => setVerMensajeSP(false)}
        />
      )}
    </div>
  );
}

/* ── Un renglón de la SP ── */
function Renglon({
  it, marca, stock, texto, telefono, bloqueado, onHay, onNoHay, onTexto, onConfirmar,
}: {
  it: ItemOrden;
  marca: MarcaAlmacen | undefined;
  /** undefined = cargando; null = sin dato. */
  stock: StockRenglon | null | undefined;
  texto: string | undefined;
  telefono: boolean;
  bloqueado: boolean;
  onHay: () => void;
  onNoHay: () => void;
  onTexto: (t: string) => void;
  onConfirmar: () => void;
}) {
  const unidad = (it.unidad ?? '').trim();
  const pedido = cantidadSolicitada(it);

  if (!seRevisa(it)) {
    return (
      <div style={{ ...cajaRenglon, opacity: .55 }}>
        <div style={{ fontWeight: 700 }}>{it.nombre}</div>
        <div className="muted" style={{ fontSize: '.8rem' }}>No se pide: venía desmarcado en la SP.</div>
      </div>
    );
  }

  const revisado = marca?.revisado === true;
  const disp = revisado ? disponibleAcotado(it, marca?.disponible ?? 0) : 0;
  const hay = revisado && disp > 0;
  const noHay = revisado && disp === 0;
  const falta = Math.round((pedido - disp) * 10000) / 10000;

  const colorStock = !stock || !stock.productoId ? 'var(--text-muted)'
    : stock.stock >= pedido ? 'var(--success)' : stock.stock > 0 ? 'var(--warning)' : 'var(--danger)';
  const borde = hay ? (falta > 0 ? 'var(--warning)' : 'var(--success)') : noHay ? 'var(--danger)' : 'var(--border)';

  return (
    <div style={{ ...cajaRenglon, borderLeft: `4px solid ${borde}`, padding: telefono ? '.75rem' : '.65rem .8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <div style={{ fontWeight: 700, fontSize: telefono ? '1.05rem' : '.98rem', wordBreak: 'break-word' }}>{it.nombre}</div>
          <div style={{ fontSize: '.88rem', marginTop: '.1rem' }}>
            Pedido: <strong className="mono">{fmtCant(pedido)}</strong>{unidad ? ` ${unidad}` : ''}
            {it.finalidad?.trim() ? <span className="muted"> · {it.finalidad.trim()}</span> : null}
          </div>
          <div style={{ fontSize: '.82rem', marginTop: '.15rem', color: colorStock }}>
            {stock === undefined ? <span className="muted">Buscando en el inventario…</span>
              : !stock || !stock.productoId ? 'Sin ficha en el inventario: revísalo a mano.'
                : <>
                  📦 En inventario: <strong className="mono">{fmtCant(stock.stock)}</strong>{unidad ? ` ${unidad}` : ''}
                  {stock.porAlmacen.length > 0 && (
                    <span className="muted"> · {stock.porAlmacen.map((a) => `${a.almacen} ${fmtCant(a.stock)}`).join(' · ')}</span>
                  )}
                </>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.35rem', flex: telefono ? '1 1 100%' : '0 0 auto', minWidth: telefono ? 0 : 200 }}>
          <button type="button" aria-pressed={hay} disabled={bloqueado} onClick={onHay}
            className={`btn ${hay ? 'btn-success' : 'btn-ghost'} ${telefono ? 'btn-grande' : 'btn-sm'}`}>
            ✓ Hay
          </button>
          <button type="button" aria-pressed={noHay} disabled={bloqueado} onClick={onNoHay}
            className={`btn ${noHay ? 'btn-danger' : 'btn-ghost'} ${telefono ? 'btn-grande' : 'btn-sm'}`}>
            ✗ No hay
          </button>
        </div>
      </div>

      {hay && (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '.5rem' }}>
          <label style={{ fontSize: '.82rem', fontWeight: 700 }} htmlFor={`disp-${it.sku}`}>Disponible</label>
          <input
            id={`disp-${it.sku}`}
            className="input mono"
            inputMode="decimal"
            style={{ width: telefono ? 130 : 110, textAlign: 'center', fontSize: telefono ? '1.2rem' : undefined, minHeight: telefono ? 48 : undefined }}
            value={texto ?? paraCampo(disp)}
            disabled={bloqueado}
            onChange={(e) => onTexto(e.target.value)}
            onBlur={onConfirmar}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            onFocus={(e) => e.target.select()}
          />
          <span style={{ fontSize: '.85rem' }}>{unidad || ''} de {fmtCant(pedido)}</span>
          {falta > 0
            ? <span className="badge warning">Faltan {fmtCant(falta)} → Compras</span>
            : <span className="badge success">Completo</span>}
        </div>
      )}
      {noHay && <div style={{ marginTop: '.4rem' }}><span className="badge primary">🛒 Todo a Compras ({fmtCant(pedido)}{unidad ? ` ${unidad}` : ''})</span></div>}
    </div>
  );
}

const cajaRenglon: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  padding: '.65rem .8rem',
};

/** Cómo quedó una SP revisada, en palabras (pestaña «Revisadas» de la PC y del teléfono). */
export function resultadoRevision(o: Orden): { texto: string; clase: string } {
  if (o.estado === 'atendida_almacen') return { texto: 'Almacén tenía todo', clase: 'success' };
  if (o.estado === 'pendiente') return { texto: 'Pasó a Compras', clase: 'primary' };
  return { texto: `En Compras · ${statusBadge(o.estado).label}`, clase: 'info' };
}

/** Lo que tiene y lo que va a Compras, en dos listas cortas (confirmación y pestaña de revisadas). */
export function ResumenListas({ tiene, falta }: ReturnType<typeof resumenRevision>) {
  const fila = (r: { sku: string; nombre: string; cantidad: number; unidad: string }) => (
    <li key={r.sku}>{r.nombre} — <strong className="mono">{fmtCant(r.cantidad)}</strong>{r.unidad ? ` ${r.unidad}` : ''}</li>
  );
  return (
    <div style={{ display: 'grid', gap: '.5rem', fontSize: '.86rem' }}>
      <div>
        <strong>📦 Tiene almacén</strong>
        {tiene.length ? <ul style={{ margin: '.2rem 0 0 1.1rem', padding: 0 }}>{tiene.map(fila)}</ul> : <div className="muted">Nada de lo solicitado</div>}
      </div>
      <div>
        <strong>🛒 Va a Compras</strong>
        {falta.length ? <ul style={{ margin: '.2rem 0 0 1.1rem', padding: 0 }}>{falta.map(fila)}</ul> : <div className="muted">Nada: almacén tiene todo</div>}
      </div>
    </div>
  );
}
