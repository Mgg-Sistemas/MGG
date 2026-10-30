/* ============================================================
   MGG · Compras · Almacén revisa una Solicitud de Pedido (29-10-2026)

   Una SP en `revision_almacen`: CADA almacén (Los Pinos, Matanza · 30-10)
   dice renglón por renglón (o por lote) si lo tiene y cuánto. El almacenista
   sectorizado responde por SU sede; quien no tiene sede asignada (admin,
   analistas) elige por cuál responde. Se ve el stock de la sede y, como
   información, lo que ya respondió la otra.

   Cada cambio se guarda en la base al rato (sin confirmar) para que otro
   usuario, o el teléfono, vea el avance en vivo: `ordenes` está en realtime.
   Solo se mandan los renglones tocados y solo de la sede elegida, así nadie
   pisa lo de otro.

   «Confirmar revisión de <Sede>» lo hace la base (`almacen_revisar_solicitud`).
   Cuando confirmaron todas las sedes, la base reparte (Los Pinos primero) y lo
   que ninguno tiene pasa a Compras; si entre los dos lo tienen todo, la SP
   queda «Atendida por almacén». Los mensajes de WhatsApp los muestra el padre
   (`onConfirmada`), porque al cerrarse la SP sale de la lista.

   La misma pantalla sirve en la PC y en el teléfono (`variante`).
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ItemOrden, Orden } from '@/shared/lib/types';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSectorizacion } from '@/modules/inventario/useSectorizacion';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { dateTime, relTime, statusBadge } from '@/shared/lib/format';
import { parseMontoEs } from '@/shared/lib/montoEs';
import { useNombreUsuario } from '@/shared/lib/useNombreUsuario';
import { MensajeWhatsappModal } from './MensajeWhatsappModal';
import { quienSolicita } from './quienSolicita';
import {
  cantidadSolicitada,
  confirmacionDe,
  conMarcasDeSede,
  disponibleAcotado,
  estadoSedes,
  etiquetaSede,
  fmtCant,
  marcaDeSede,
  marcarLote,
  marcasIniciales,
  mensajeSolicitudPedido,
  resumenRevision,
  resumenSede,
  sedesPendientes,
  sedesQuePuedeResponder,
  seRevisa,
  SEDES_REVISION_ALMACEN,
  todoRevisado,
  type MarcaAlmacen,
  type ResumenRevision,
} from './revisionAlmacen';
import { confirmarRevisionSede, guardarMarcasSede, stockDeRenglones, type StockRenglon } from './revisionAlmacen.repository';

/** Lo que se espera antes de mandar a la base lo marcado (se juntan varios toques en una sola escritura). */
const ESPERA_GUARDAR_MS = 700;
/** Un renglón recién tocado acá no se pisa con lo que llega de la base durante este rato. */
const PROTEGER_LOCAL_MS = 4000;

/** La última sede por la que respondió este usuario (admin): se propone en la próxima SP. */
let ultimaSede: string | null = null;

interface Props {
  orden: Orden;
  variante?: 'pc' | 'telefono';
  /** Una sede confirmó: el padre muestra su mensaje (y el de la revisión completa si la SP quedó cerrada). */
  onConfirmada: (actualizada: Orden, sede: string, revisor: string) => void;
}

type Lote = 'todo' | 'nada' | 'stock';

const LOTE_TEXTO: Record<Lote, string> = {
  todo: '✓ Hay todo',
  stock: 'Según stock de la sede',
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

/** ¿Puede responder la revisión? Inventario (escritura) o Salidas (escritura): el almacenista escribe por Salidas. */
export function usePuedeRevisarAlmacen(): boolean {
  const { can } = usePermissions();
  return can('inventario', 'escritura') || can('salidas', 'escritura');
}

export function RevisionSolicitudAlmacen({ orden, variante = 'pc', onConfirmada }: Props) {
  const telefono = variante === 'telefono';
  const { user } = useSession();
  const { appUser } = usePermissions();
  const canWrite = usePuedeRevisarAlmacen();
  const revisor = appUser?.nombre?.trim() || user?.email || 'Almacén';
  const nombreDe = useNombreUsuario();
  const { sedes: misSedes } = useSectorizacion();
  const opciones = useMemo(() => sedesQuePuedeResponder(misSedes), [misSedes]);
  const estados = estadoSedes(orden);

  // La sede por la que se responde: la elegida, o la primera que falta (la última usada si falta).
  const [sedeElegida, setSedeElegida] = useState<string | null>(() => {
    const pendientes = opciones.filter((s) => !confirmacionDe(orden, s));
    if (ultimaSede && pendientes.includes(ultimaSede)) return ultimaSede;
    return pendientes[0] ?? opciones[0] ?? null;
  });
  const sede = sedeElegida && opciones.includes(sedeElegida) ? sedeElegida : opciones[0] ?? null;
  function elegir(s: string) { ultimaSede = s; setSedeElegida(s); }

  const [verMensajeSP, setVerMensajeSP] = useState(false);
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
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
              {estados.map((e) => (
                <span key={e.sede} className={`badge ${e.confirmada ? 'success' : e.revisados > 0 ? 'info' : 'warning'}`}
                  title={e.confirmada ? `Confirmó ${nombreDe(null, e.confirmacion?.confirmada_por) || ''} · ${dateTime(e.confirmacion?.confirmada_en)}` : undefined}>
                  🏬 {e.etiqueta} {e.confirmada ? '✓' : e.revisados > 0 ? `${e.revisados}/${e.total}` : 'pendiente'}
                </span>
              ))}
            </div>
          </div>
          <button type="button" className={`btn btn-ghost ${btnTam}`} onClick={() => setVerMensajeSP(true)}>
            💬 WhatsApp de la SP
          </button>
        </div>
      </div>

      {!canWrite && (
        <div className="aviso warning sm" style={{ marginBottom: '.75rem' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para revisar solicitudes hace falta escritura en Inventario o en Salidas.</div>
        </div>
      )}

      {/* ── Por qué sede responde (solo si puede por más de una) ── */}
      {opciones.length > 1 && (
        <>
          <div className="surt-rotulo">Respondo por</div>
          <div className="view-toggle" role="tablist" aria-label="Sede que responde" style={{ marginBottom: '.75rem', flexWrap: 'wrap' }}>
            {opciones.map((s) => (
              <button key={s} type="button" className={s === sede ? 'active' : ''} onClick={() => elegir(s)}>
                🏬 {etiquetaSede(s)}{confirmacionDe(orden, s) ? ' ✓' : ''}
              </button>
            ))}
          </div>
        </>
      )}

      {sede ? (
        <RevisionSede
          key={sede}
          orden={orden}
          sede={sede}
          telefono={telefono}
          canWrite={canWrite}
          revisor={revisor}
          onConfirmada={onConfirmada}
        />
      ) : (
        <>
          <div className="aviso info sm" style={{ marginBottom: '.75rem' }}>
            <span className="aviso-icono">ℹ</span>
            <div>
              Tu usuario está asignado a {(misSedes ?? []).map(etiquetaSede).join(', ') || '—'}; las solicitudes las
              confirman {SEDES_REVISION_ALMACEN.map((s) => s.etiqueta).join(' y ')}. Acá solo se ve cómo van.
            </div>
          </div>
          <RespuestasSoloLectura orden={orden} />
        </>
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

/* ── La revisión de UNA sede ── */
function RevisionSede({
  orden, sede, telefono, canWrite, revisor, onConfirmada,
}: {
  orden: Orden;
  sede: string;
  telefono: boolean;
  canWrite: boolean;
  revisor: string;
  onConfirmada: Props['onConfirmada'];
}) {
  const etq = etiquetaSede(sede);
  const nombreDe = useNombreUsuario();
  const items = useMemo(() => orden.items ?? [], [orden.items]);
  const aRevisar = useMemo(() => items.filter(seRevisa), [items]);
  const confirmacion = confirmacionDe(orden, sede);
  const [confirmadaAca, setConfirmadaAca] = useState(false);
  const confirmada = !!confirmacion || confirmadaAca;
  const otras = SEDES_REVISION_ALMACEN.filter((s) => s.sede !== sede);

  // ── Marcas de ESTA sede: el estado local manda; la base se actualiza al rato ──
  const marcasRef = useRef<Record<string, MarcaAlmacen>>(marcasIniciales(items, sede));
  const [marcas, setMarcas] = useState<Record<string, MarcaAlmacen>>(marcasRef.current);
  const sucias = useRef(new Set<string>());
  const tocadoEn = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cerrada = useRef(false);
  /** Mientras se confirma, un guardado que falle (la SP ya cambió) no se avisa. */
  const cerrandoRef = useRef(false);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  // Lo que otro usuario (o el teléfono) guardó llega por realtime: se toma, salvo los
  // renglones que se están tocando acá y todavía no llegaron (o acaban de llegar) a la base.
  useEffect(() => {
    const remotas = marcasIniciales(items, sede);
    const ahora = Date.now();
    const next: Record<string, MarcaAlmacen> = { ...remotas };
    for (const [sku, m] of Object.entries(marcasRef.current)) {
      const reciente = ahora - (tocadoEn.current.get(sku) ?? 0) < PROTEGER_LOCAL_MS;
      if (sku in remotas && (sucias.current.has(sku) || reciente)) next[sku] = m;
    }
    marcasRef.current = next;
    setMarcas(next);
  }, [items, sede]);

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
      await guardarMarcasSede(orden.id, sede, parcial);
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
  }, [orden.id, sede]);

  // Al salir de la SP (otra SP, otra sede, volver a la lista) se guarda lo pendiente.
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
  const stockSede = useCallback((sku: string) => {
    const st = stock?.get(sku);
    return st?.productoId ? st.porSede[sede] ?? 0 : null;
  }, [stock, sede]);

  // ── Campo «Disponible» mientras se escribe (texto, para aceptar «0,5») ──
  const [editando, setEditando] = useState<Record<string, string>>({});
  const [nota, setNota] = useState(confirmacion?.nota ?? '');
  const [lotePendiente, setLotePendiente] = useState<Lote | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  const resumen = useMemo(() => resumenSede(items, sede, marcas), [items, sede, marcas]);
  const pendientesOtras = sedesPendientes(orden, sede);
  const esUltima = pendientesOtras.length === 0;
  // Si esta sede es la última que falta, así queda la SP al confirmar (reparto entre almacenes).
  const final = useMemo<ResumenRevision | null>(
    () => (esUltima ? resumenRevision(conMarcasDeSede(items, sede, marcas)) : null),
    [esUltima, items, sede, marcas],
  );
  const nRevisados = aRevisar.filter((it) => marcas[it.sku]?.revisado).length;
  const listo = todoRevisado(items, marcas);
  const bloqueado = !canWrite || cerrando || confirmada;

  function marcarHay(it: ItemOrden) {
    const pedido = cantidadSolicitada(it);
    const prev = marcasRef.current[it.sku];
    const st = stockSede(it.sku);
    // Si ya tenía una cantidad, se respeta; si el inventario de la sede dice que hay menos
    // de lo pedido (pero algo hay), se propone eso; si no, todo lo pedido.
    const disp = prev?.revisado && prev.disponible > 0
      ? prev.disponible
      : st != null && st > 0 && st < pedido ? st : pedido;
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
    for (const it of items) mapa.set(it.sku, stockSede(it.sku) ?? 0);
    aplicar(marcarLote(items, modo, mapa));
    setEditando({});
  }

  async function confirmarSede() {
    setConfirmar(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setCerrando(true);
    cerrandoRef.current = true;
    try {
      // Va con TODAS las marcas de la sede: lo pendiente de guardar entra acá mismo.
      const actualizada = await confirmarRevisionSede(orden.id, sede, marcasRef.current, nota.trim() || null);
      cerrada.current = true;
      sucias.current.clear();
      setConfirmadaAca(true);
      toast(actualizada.estado === 'atendida_almacen'
        ? `${orden.codigo}: los almacenes tienen todo, no pasa a Compras`
        : actualizada.estado === 'pendiente'
          ? `${orden.codigo} revisada por todos los almacenes: lo que falta pasó a Compras`
          : `${etq} confirmó su revisión de ${orden.codigo}`, 'success');
      onConfirmada(actualizada, sede, revisor);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo confirmar la revisión'), 'error');
    } finally {
      cerrandoRef.current = false;
      setCerrando(false);
    }
  }

  const btnTam = telefono ? 'btn-grande' : 'btn-sm';

  return (
    <>
      {confirmada && (
        <div className="aviso success sm" style={{ marginBottom: '.75rem' }}>
          <span className="aviso-icono">✅</span>
          <div>
            <strong>{etq} ya confirmó su revisión</strong>
            {confirmacion?.confirmada_por && <> · {nombreDe(null, confirmacion.confirmada_por)}</>}
            {confirmacion?.confirmada_en && <span className="muted"> · {dateTime(confirmacion.confirmada_en)}</span>}
            {pendientesOtras.length > 0 && <div className="muted">Falta que responda {pendientesOtras.map((p) => p.etiqueta).join(', ')}.</div>}
          </div>
        </div>
      )}

      {/* ── Por lote ── */}
      {!confirmada && (
        <>
          <div className="surt-rotulo">Marcar todo de una vez · {etq}</div>
          <div style={{ display: 'grid', gridTemplateColumns: telefono ? '1fr' : 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.45rem', marginBottom: '.75rem' }}>
            <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--success)' }} disabled={bloqueado} onClick={() => pedirLote('todo')}>
              {LOTE_TEXTO.todo}
            </button>
            <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--info)' }} disabled={bloqueado || !stock} onClick={() => pedirLote('stock')}
              title={`Marca en cada renglón lo que dice el inventario de ${etq} (hasta lo pedido)`}>
              📦 {LOTE_TEXTO.stock}
            </button>
            <button type="button" className={`btn btn-ghost ${btnTam}`} style={{ borderColor: 'var(--danger)' }} disabled={bloqueado} onClick={() => pedirLote('nada')}>
              {LOTE_TEXTO.nada}
            </button>
          </div>
        </>
      )}

      {/* ── Resumen en vivo ── */}
      <div className="card" style={{ padding: '.6rem .8rem', marginBottom: '.75rem', display: 'flex', gap: '.5rem .9rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>🏬 <strong>{etq}</strong>: revisados <strong>{nRevisados}</strong> de <strong>{aRevisar.length}</strong></span>
        <span className="badge success">📦 Tiene {resumen.tiene.length}</span>
        <span className="badge danger">❌ No tiene {resumen.falta.length}</span>
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>
          {guardando ? 'Guardando…' : errorGuardar ? '⚠ Sin guardar' : nRevisados && !confirmada ? '✓ Guardado' : ''}
        </span>
      </div>

      {/* ── Renglones ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem', marginBottom: '.85rem' }}>
        {items.map((it, idx) => (
          <Renglon
            key={`${it.sku}-${idx}`}
            it={it}
            sede={sede}
            marca={marcas[it.sku]}
            stock={stock ? stock.get(it.sku) ?? null : undefined}
            otras={otras.map((o) => ({ etiqueta: o.etiqueta, marca: marcaDeSede(it, o.sede), confirmada: !!confirmacionDe(orden, o.sede) }))}
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

      {/* ── Nota y confirmación ── */}
      {!confirmada && (
        <>
          <label className="surt-rotulo" htmlFor={`nota-alm-${orden.id}-${sede}`} style={{ display: 'block' }}>Nota de {etq} (opcional)</label>
          <textarea
            id={`nota-alm-${orden.id}-${sede}`}
            className="input"
            rows={telefono ? 3 : 2}
            style={{ width: '100%', marginBottom: '.75rem', fontSize: telefono ? '1.05rem' : undefined }}
            placeholder="Ej.: el aceite que hay está abierto"
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
            {cerrando ? 'Confirmando…' : `✅ Confirmar revisión de ${etq}`}
          </button>
          {!listo && aRevisar.length > 0 && (
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.35rem', textAlign: 'center' }}>
              Faltan {aRevisar.length - nRevisados} renglón(es) por revisar en {etq}.
            </div>
          )}
        </>
      )}

      {lotePendiente && (
        <ConfirmDialog
          title={`${LOTE_TEXTO[lotePendiente]} · ${etq}`}
          message={<>Ya hay {nRevisados} renglón(es) revisados en {etq}. Esto cambia <strong>todos</strong> los renglones de {orden.codigo} para {etq}. ¿Seguir?</>}
          confirmText="Sí, marcar todo"
          onConfirm={() => aplicarLote(lotePendiente)}
          onCancel={() => setLotePendiente(null)}
        />
      )}

      {confirmar && (
        <ConfirmDialog
          title={`Confirmar revisión de ${etq} · ${orden.codigo}`}
          success
          confirmText={`✅ Confirmar ${etq}`}
          message={!esUltima
            ? <>{etq} tiene <strong>{resumen.tiene.length}</strong> de {aRevisar.length} producto(s). Falta que responda <strong>{pendientesOtras.map((p) => p.etiqueta).join(', ')}</strong>: cuando responda, lo que ningún almacén tenga pasa a Compras. Después ya no se puede cambiar lo de {etq}.</>
            : final && final.falta.length
              ? <>Con esto responden todos los almacenes: lo que falta (<strong>{final.falta.length}</strong> producto(s)) pasa a Compras para cotizar.</>
              : <>Con esto responden todos los almacenes y entre ellos tienen <strong>todo</strong>: la SP queda «Atendida por almacén» y no pasa a Compras.</>}
          preview={final
            ? <ResumenListas {...final} />
            : <ResumenListas tiene={resumen.tiene} falta={resumen.falta}
                tituloTiene={`📦 Tiene ${etq}`} tituloFalta={`❌ No tiene ${etq}`} vacioFalta={`Nada: ${etq} tiene todo`} />}
          onConfirm={() => void confirmarSede()}
          onCancel={() => setConfirmar(false)}
        />
      )}
    </>
  );
}

/* ── Un renglón de la SP ── */
function Renglon({
  it, sede, marca, stock, otras, texto, telefono, bloqueado, onHay, onNoHay, onTexto, onConfirmar,
}: {
  it: ItemOrden;
  sede: string;
  marca: MarcaAlmacen | undefined;
  /** undefined = cargando; null = sin dato. */
  stock: StockRenglon | null | undefined;
  /** Lo que respondieron las otras sedes (solo para ver). */
  otras: Array<{ etiqueta: string; marca: MarcaAlmacen | undefined; confirmada: boolean }>;
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
  const etq = etiquetaSede(sede);

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

  const enSede = stock?.productoId ? stock.porSede[sede] ?? 0 : 0;
  const otrasSedes = stock?.productoId
    ? Object.entries(stock.porSede).filter(([s]) => s !== sede).map(([s, n]) => `${etiquetaSede(s)} ${fmtCant(n)}`)
    : [];
  const colorStock = !stock || !stock.productoId ? 'var(--text-muted)'
    : enSede >= pedido ? 'var(--success)' : enSede > 0 ? 'var(--warning)' : 'var(--danger)';
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
                  📦 En {etq}: <strong className="mono">{fmtCant(enSede)}</strong>{unidad ? ` ${unidad}` : ''}
                  {otrasSedes.length > 0 && <span className="muted"> · {otrasSedes.join(' · ')}</span>}
                </>}
          </div>
          {otras.map((o) => (
            <div key={o.etiqueta} className="muted" style={{ fontSize: '.8rem', marginTop: '.1rem' }}>
              🏬 {o.etiqueta}:{' '}
              {!o.marca?.revisado ? 'sin responder'
                : o.marca.disponible > 0 ? <span style={{ color: 'var(--success)' }}>✓ hay {fmtCant(disponibleAcotado(it, o.marca.disponible))}{unidad ? ` ${unidad}` : ''}</span>
                  : <span style={{ color: 'var(--danger)' }}>✗ no hay</span>}
              {o.confirmada ? ' (confirmó)' : ''}
            </div>
          ))}
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
          <label style={{ fontSize: '.82rem', fontWeight: 700 }} htmlFor={`disp-${sede}-${it.sku}`}>Disponible en {etq}</label>
          <input
            id={`disp-${sede}-${it.sku}`}
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
            ? <span className="badge warning">Faltan {fmtCant(falta)} en {etq}</span>
            : <span className="badge success">Completo</span>}
        </div>
      )}
      {noHay && <div style={{ marginTop: '.4rem' }}><span className="badge danger">✗ {etq} no tiene ({fmtCant(pedido)}{unidad ? ` ${unidad}` : ''})</span></div>}
    </div>
  );
}

/* ── Quien no responde por ninguna sede: solo ve lo que respondió cada una ── */
function RespuestasSoloLectura({ orden }: { orden: Orden }) {
  const items = (orden.items ?? []).filter(seRevisa);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {items.map((it, idx) => (
        <div key={`${it.sku}-${idx}`} style={cajaRenglon}>
          <div style={{ fontWeight: 700 }}>{it.nombre} <span className="muted" style={{ fontWeight: 400 }}>· {fmtCant(cantidadSolicitada(it))}{it.unidad ? ` ${it.unidad}` : ''}</span></div>
          <div className="muted" style={{ fontSize: '.82rem' }}>
            {SEDES_REVISION_ALMACEN.map(({ sede, etiqueta }) => {
              const m = marcaDeSede(it, sede);
              return `${etiqueta}: ${!m?.revisado ? 'sin responder' : m.disponible > 0 ? `hay ${fmtCant(disponibleAcotado(it, m.disponible))}` : 'no hay'}`;
            }).join(' · ')}
          </div>
        </div>
      ))}
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

/**
 * Lo que tiene y lo que va a Compras, en listas cortas (confirmación y pestaña de
 * revisadas). Con `porSede`, lo que tiene sale agrupado por el almacén que lo entrega.
 */
export function ResumenListas({
  tiene, falta, porSede, tituloTiene = '📦 Tiene almacén', tituloFalta = '🛒 Va a Compras',
  vacioFalta = 'Nada: almacén tiene todo',
}: ResumenRevision & { tituloTiene?: string; tituloFalta?: string; vacioFalta?: string }) {
  const fila = (r: { sku: string; nombre: string; cantidad: number; unidad: string }, i: number) => (
    <li key={`${r.sku}-${i}`}>{r.nombre} — <strong className="mono">{fmtCant(r.cantidad)}</strong>{r.unidad ? ` ${r.unidad}` : ''}</li>
  );
  const agrupado = !!porSede?.length && porSede.some((e) => e.sede);
  const lista = { margin: '.2rem 0 0 1.1rem', padding: 0 };
  return (
    <div style={{ display: 'grid', gap: '.5rem', fontSize: '.86rem' }}>
      <div>
        <strong>{tituloTiene}</strong>
        {!tiene.length ? <div className="muted">Nada de lo solicitado</div>
          : agrupado ? porSede!.map((e) => (
            <div key={e.sede || 'almacen'} style={{ marginTop: '.2rem' }}>
              <span style={{ fontWeight: 600 }}>🏬 {e.etiqueta}</span>
              <ul style={lista}>{e.renglones.map(fila)}</ul>
            </div>
          ))
            : <ul style={lista}>{tiene.map(fila)}</ul>}
      </div>
      <div>
        <strong>{tituloFalta}</strong>
        {falta.length ? <ul style={lista}>{falta.map(fila)}</ul> : <div className="muted">{vacioFalta}</div>}
      </div>
    </div>
  );
}
