import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import type { Almacen, Existencia, Movimiento, Producto } from '@/shared/lib/types';
import { listMovimientosPorProducto, TIPOS_MOVIMIENTO } from './movimientos.repository';
import { listAlmacenes, listExistenciasDeProducto } from './almacenes.repository';
import {
  ajustesPmpPorAlmacen, almacenesDelKardex, contarSinAlmacen, desglosePorSede, entradasSalidas, etiquetaAlmacen,
  filtrarKardex, FILTRO_SIN_ALMACEN, nombreSedeCorto, sinAlmacen, stockEn,
} from './stockPorAlmacen';
// descargarProductoPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.

/* Formateadores creados UNA vez: `toLocaleDateString/TimeString` con `timeZone` construye
   un Intl.DateTimeFormat en cada llamada (~0,15 ms). Con kardex de cientos de filas y
   re-renders por realtime, eso costaba cientos de ms por render. */
const FMT_DIA = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: 'short', year: 'numeric' });
const FMT_HORA = new Intl.DateTimeFormat('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });

/** Desde dónde se abrió el modal: esa sede/almacén va primero y filtra el kardex por defecto. */
export interface OrigenDetalle { sede?: string | null; almacen?: string | null }

interface ProductoDetailProps {
  producto: Producto;
  origen?: OrigenDetalle | null;
  onClose: () => void;
}

/*
  Trazabilidad de un producto. Responde en este orden: ¿cuánto hay y DÓNDE? (desglose por
  sede → almacén), ¿cuánto vale? (PMP), ¿qué pasó? (kardex, filtrable por almacén).
  Antes la cabecera mostraba «Stock actual» = total de TODAS las sedes sin decirlo, y cada
  línea del kardex un «saldo» del almacén de esa línea: el almacenista de Los Pinos veía
  20 en su lista, 35 en el modal y 15 en la primera línea, los tres correctos y ninguno
  explicado. Ahora cada número dice de qué ámbito es.
  Las recepciones de orden de compra no registran almacén (y su saldo/PMP son globales):
  se muestran siempre, rotuladas como tales, y no se atribuyen a ningún almacén.
*/
export function ProductoDetail({ producto, origen = null, onClose }: ProductoDetailProps) {
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = todavía cargando. Se consulta por producto (no la tabla entera, que en producción
  // supera el tope de 1.000 filas por respuesta y dejaba productos «sin stock» en pantalla).
  const [existencias, setExistencias] = useState<Existencia[] | null>(null);
  const [errorStock, setErrorStock] = useState(false);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  // Filtro del kardex por almacén: arranca en el almacén desde el que se abrió (si tiene movimientos).
  const [filtroAlm, setFiltroAlm] = useState<string | null>(origen?.almacen ?? null);
  // ESTAÑO EN BRUTO / ESTAÑO REFINADO llevan doble medida: stock en kg + N° lingotes
  // (Σ lingotes producidos en fundición/refinación). Se carga aparte y solo para ellos.
  const esBruto = /bruto/i.test(producto.nombre);
  const esRefinado = /refinad/i.test(producto.nombre);
  const [lingotes, setLingotes] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMovimientosPorProducto(producto.id)
      .then((data) => { if (!cancelled) setMovs(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar kardex'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [producto.id]);

  // Dónde está el stock: existencias DEL producto + sede de cada almacén (principal y depósito).
  useEffect(() => {
    let cancelled = false;
    setExistencias(null); setErrorStock(false);
    Promise.all([
      listExistenciasDeProducto(producto.id),
      listAlmacenes('principal').catch(() => [] as Almacen[]),
      listAlmacenes('deposito').catch(() => [] as Almacen[]),
    ]).then(([ex, a1, a2]) => {
      if (cancelled) return;
      setExistencias(ex);
      setAlmacenes([...a1, ...a2]);
    }).catch(() => { if (!cancelled) { setExistencias([]); setErrorStock(true); } });
    return () => { cancelled = true; };
  }, [producto.id]);

  useEffect(() => {
    if (!esBruto && !esRefinado) { setLingotes(null); return; }
    let cancelled = false;
    (esBruto
      ? import('@/modules/produccion/colada.repository').then((m) => m.totalLingotesFundicion())
      : import('@/modules/produccion/refinacion.repository').then((m) => m.totalLingotesRefinacion())
    ).then((n) => { if (!cancelled) setLingotes(n); }).catch(() => { if (!cancelled) setLingotes(null); });
    return () => { cancelled = true; };
  }, [producto.id, esBruto, esRefinado]);

  const cargandoStock = existencias === null;
  const desglose = useMemo(() => desglosePorSede(existencias ?? [], almacenes, origen?.sede ?? null), [existencias, almacenes, origen?.sede]);
  const almacenesKardex = useMemo(() => almacenesDelKardex(movs, almacenes, origen?.sede ?? null), [movs, almacenes, origen?.sede]);
  const nSinAlmacen = useMemo(() => contarSinAlmacen(movs), [movs]);
  // Si el almacén elegido no tiene movimientos (o ya no existe), se muestra todo.
  const filtroEfectivo =
    filtroAlm === FILTRO_SIN_ALMACEN ? (nSinAlmacen > 0 ? FILTRO_SIN_ALMACEN : null)
    : filtroAlm && almacenesKardex.includes(filtroAlm) ? filtroAlm
    : null;
  const movsVisibles = useMemo(() => filtrarKardex(movs, filtroEfectivo), [movs, filtroEfectivo]);
  /** Día y hora ya formateados + si la fila abre un día nuevo (cabecera del kardex). */
  const lineas = useMemo(() => {
    let diaPrevio = '';
    return movsVisibles.map((m) => {
      const d = new Date(m.at);
      const dia = Number.isNaN(d.getTime()) ? '—' : FMT_DIA.format(d);
      const nuevoDia = dia !== diaPrevio;
      diaPrevio = dia;
      return { m, dia, nuevoDia, hora: Number.isNaN(d.getTime()) ? '' : FMT_HORA.format(d) };
    });
  }, [movsVisibles]);
  const { entradas: totalIn, salidas: totalOut } = useMemo(() => entradasSalidas(movs, filtroEfectivo), [movs, filtroEfectivo]);
  const ambito = !filtroEfectivo ? 'todas las sedes' : filtroEfectivo === FILTRO_SIN_ALMACEN ? 'recepciones de compra' : `▣ ${filtroEfectivo}`;
  const unidad = esBruto || esRefinado ? 'kg' : producto.unidad;
  const hayChips = almacenesKardex.length + (nSinAlmacen > 0 ? 1 : 0) > 1;
  // La suma por almacén y el agregado del producto DEBERÍAN coincidir; si no, hay que decirlo.
  const descuadre = !cargandoStock && !errorStock && Math.abs(desglose.total - (Number(producto.stock) || 0)) > 0.0005;
  const valorStock = (n: number) => (cargandoStock ? '…' : errorStock ? '?' : `${num(n)} ${unidad}`);

  // Costo inicial y ajuste del PMP en cada recompra, por almacén.
  const { ajustes, costoInicial } = useMemo(() => ajustesPmpPorAlmacen(movs), [movs]);

  async function handleDownloadPdf() {
    try {
      const { descargarProductoPdf } = await import('./productoPdf');
      await descargarProductoPdf(producto.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error');
    }
  }

  return (
    <Modal
      title={`Trazabilidad · ${producto.sku}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={handleDownloadPdf} title="Descargar trazabilidad del producto">
            ↓ Trazabilidad PDF
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <div>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Trazabilidad
          </div>
          <h3 style={{ margin: '.15rem 0 0' }}>{producto.nombre}</h3>
          <div className="muted mono" style={{ fontSize: '.78rem' }}>
            {producto.sku} · {producto.categoria} · {producto.unidad}
          </div>
          <div style={{ marginTop: '.35rem', display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {producto.receta_fundicion && (
              <span className="badge info">Receta: {producto.receta_fundicion}</span>
            )}
            {producto.en_fundicion && (
              <span className="badge warning">🔥 EN PROCESO DE FUNDICIÓN</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {/* Primero el número que el usuario espera ver: el de SU almacén o SU sede. */}
          {origen?.almacen && (
            <MiniStat label={`Stock en ${origen.almacen}`} value={valorStock(stockEn(existencias ?? [], origen.almacen))} color="var(--primary-3)" />
          )}
          {!origen?.almacen && origen?.sede && (
            <MiniStat label={`Stock en ${nombreSedeCorto(origen.sede)}`} value={valorStock(desglose.sedes.find((s) => s.esOrigen)?.stock ?? 0)} color="var(--primary-3)" />
          )}
          <MiniStat label="Stock total (todas las sedes)" value={`${num(producto.stock)} ${unidad}`} color={origen?.almacen || origen?.sede ? 'var(--text)' : 'var(--primary-3)'} />
          {(esBruto || esRefinado) && lingotes != null && (
            <MiniStat label="N° lingotes" value={num(lingotes)} color="var(--primary-3)" />
          )}
          <MiniStat label="Mínimo" value={num(producto.stock_min)} color="var(--text)" />
          <MiniStat label="Costo inicial" value={costoInicial != null ? money(costoInicial) : '—'} color="var(--text)" />
          <MiniStat label="PMP global" value={money(producto.precio)} color="var(--primary-3)" />
          <MiniStat label={`Entradas (${ambito})`} value={`+${num(totalIn)}`} color="var(--success)" />
          <MiniStat label={`Salidas (${ambito})`} value={`−${num(totalOut)}`} color="var(--danger)" />
        </div>
      </div>

      {/* Dónde está el stock: sede → almacén, con el PMP de cada almacén. */}
      <div className="card" style={{ margin: '0 0 .75rem', padding: '.65rem .85rem' }}>
        <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
          Dónde está el stock
        </div>
        {cargandoStock ? (
          <div className="muted" style={{ fontSize: '.82rem' }}>Cargando desglose por almacén…</div>
        ) : errorStock ? (
          <div style={{ fontSize: '.82rem', color: 'var(--danger)' }}>No se pudo cargar el desglose por almacén. Cerrá y volvé a abrir; si sigue, avisá a Sistemas.</div>
        ) : !desglose.sedes.length ? (
          <div className="muted" style={{ fontSize: '.82rem' }}>Sin stock en ningún almacén.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '.45rem 1rem' }}>
            {desglose.sedes.map((s) => (
              <div key={s.sede} style={{ fontSize: '.82rem', borderLeft: `3px solid ${s.esOrigen ? 'var(--primary, #ff8a00)' : 'var(--border)'}`, paddingLeft: '.55rem' }}>
                <div>
                  <strong>{s.etiqueta}</strong> · <span className="mono" style={{ color: 'var(--primary-3)', fontWeight: 700 }}>{num(s.stock)} {unidad}</span>
                  {s.esOrigen && <span className="badge info" style={{ marginLeft: '.4rem', fontSize: '.6rem' }}>vista actual</span>}
                </div>
                {s.almacenes.map((a) => (
                  <div key={a.almacen} className="muted mono" style={{ fontSize: '.74rem' }}>
                    ▣ {a.almacen}: <strong style={{ color: 'var(--text)' }}>{num(a.stock)}</strong> · PMP {money(a.costo)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {descuadre ? (
          <div style={{ fontSize: '.76rem', marginTop: '.4rem', color: 'var(--warning, #f5a524)' }}>
            ⚠ La suma por almacén ({num(desglose.total)} {unidad}) no coincide con el total del producto ({num(producto.stock)} {unidad}). Avisá a Sistemas: hay que reconciliar las existencias.
          </div>
        ) : (
          <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem' }}>
            La lista de cada sede muestra solo lo de esa sede (columna «Stock en …»); acá se ve todo.
          </div>
        )}
      </div>

      {(() => {
        const detalle = ([
          ['Almacén principal (catálogo)', producto.almacen],
          ['Nombre de búsqueda', producto.nombre_busqueda],
          ['Marca', producto.marca],
          ['Modelo', producto.modelo],
          ['Fabricante', producto.fabricante],
          ['Color', producto.color],
          ['N°', producto.numero],
          ['Serial', producto.serial],
          ['Código', producto.codigo],
          ['Ubicación física', producto.ubicacion_fisica],
          ['Descripción', producto.descripcion],
        ] as Array<[string, string | null | undefined]>).filter(([, v]) => v && String(v).trim());
        if (!detalle.length) return null;
        return (
          <div className="card" style={{ margin: '0 0 .75rem', padding: '.65rem .85rem' }}>
            <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>
              Detalle del producto
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.35rem .9rem' }}>
              {detalle.map(([k, v]) => (
                <div key={k} style={{ fontSize: '.82rem' }}>
                  <span className="muted">{k}: </span>
                  <strong style={{ color: 'var(--text)' }}>{v}</strong>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Filtro del kardex por almacén (solo si hay más de un ámbito). */}
      {!loading && hayChips && (
        <div style={{ marginBottom: '.55rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: '.78rem' }}>Kardex de:</span>
            <button type="button" className={`chip ${!filtroEfectivo ? 'chip-active' : ''}`} onClick={() => setFiltroAlm(null)}>
              Todos los almacenes <span className="dim">· {movs.length}</span>
            </button>
            {almacenesKardex.map((a) => (
              <button key={a} type="button" className={`chip ${filtroEfectivo === a ? 'chip-active' : ''}`} onClick={() => setFiltroAlm(a)}>
                ▣ {etiquetaAlmacen(a, almacenes)} <span className="dim">· {movs.filter((m) => (m.almacen ?? '').trim() === a).length}</span>
              </button>
            ))}
            {nSinAlmacen > 0 && (
              <button type="button" className={`chip ${filtroEfectivo === FILTRO_SIN_ALMACEN ? 'chip-active' : ''}`} onClick={() => setFiltroAlm(FILTRO_SIN_ALMACEN)}>
                📦 Recepciones de compra (sin almacén) <span className="dim">· {nSinAlmacen}</span>
              </button>
            )}
          </div>
          {filtroEfectivo && filtroEfectivo !== FILTRO_SIN_ALMACEN && nSinAlmacen > 0 && (
            <div className="muted" style={{ fontSize: '.72rem', marginTop: '.3rem' }}>
              Las recepciones de compra no registran a qué almacén entraron: se muestran igual, pero no se cuentan en «Entradas (▣ {filtroEfectivo})».
            </div>
          )}
        </div>
      )}

      {loading ? (
        <EmptyState message="Cargando kardex…" icon="◔" />
      ) : !movs.length ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <EmptyState message="Sin movimientos registrados todavía." icon="✨" />
        </div>
      ) : !movsVisibles.length ? (
        <div className="card" style={{ padding: '1.5rem' }}>
          <EmptyState message={`Sin movimientos (${ambito}).`} icon="✨" />
        </div>
      ) : (
        <div className="kardex">
          {lineas.map(({ m, dia, nuevoDia, hora }, i) => {
            const meta = TIPOS_MOVIMIENTO[m.tipo] ?? { label: m.tipo, icon: '◔', color: 'info' as const };
            const isIn = m.delta > 0;
            const isOut = m.delta < 0;
            const deltaTxt = isIn ? `+${num(m.delta)}` : isOut ? `−${num(Math.abs(m.delta))}` : '0';
            const global = sinAlmacen(m);
            const aj = ajustes.get(m.id);
            const muestraAjuste = aj && aj.antes != null && aj.antes !== aj.despues;

            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {nuevoDia && <div className="kx-dia">{dia}</div>}
                <div className={`kx-row ${isIn ? 'in' : isOut ? 'out' : ''} ${i % 2 ? 'alt' : ''}`}>
                  {/* 1) La cantidad, primero y grande: es lo que el almacenista busca. */}
                  <div className="kx-delta">
                    {deltaTxt}
                    <small>{unidad}</small>
                  </div>

                  {/* 2) Qué pasó */}
                  <div className="kx-main">
                    <div className="kx-tipo">
                      <span>{meta.icon} {meta.label}</span>
                      {global
                        ? <span className="badge warning" style={{ fontSize: '.62rem' }}>sin almacén · recepción de compra</span>
                        : m.almacen && <span className="badge" style={{ fontSize: '.62rem' }}>▣ {etiquetaAlmacen((m.almacen ?? '').trim(), almacenes)}</span>}
                      {m.consumo_interno && <span className="badge info" style={{ fontSize: '.62rem' }}>🏭 Consumo interno</span>}
                    </div>
                    {m.detalle && <div className="kx-detalle">{m.detalle}</div>}
                    {m.destino && (
                      <div className="kx-sub">
                        {m.almacen && <>Origen: <strong style={{ color: 'var(--text)' }}>{m.almacen}</strong> → </>}
                        Destino: <strong style={{ color: 'var(--text)' }}>{m.destino}</strong>
                        {m.fecha_entrega && <> · {date(m.fecha_entrega)}</>}
                      </div>
                    )}
                    {(m.precio_unitario != null || m.costo_promedio != null || m.ref_codigo) && (
                      <div className="kx-sub mono">
                        {m.precio_unitario != null && <>Costo unit: <strong style={{ color: 'var(--text)' }}>{money(m.precio_unitario)}</strong></>}
                        {m.precio_unitario != null && m.costo_promedio != null && ' · '}
                        {m.costo_promedio != null && <>{global ? 'PMP global' : 'PMP del almacén'}: <strong style={{ color: 'var(--primary-3)' }}>{money(m.costo_promedio)}</strong></>}
                        {m.ref_codigo && <>{(m.precio_unitario != null || m.costo_promedio != null) && ' · '}Ref: {m.ref_codigo}</>}
                      </div>
                    )}
                    {muestraAjuste && aj && (
                      <div className="kx-sub mono" style={{ color: aj.despues > (aj.antes ?? 0) ? 'var(--danger)' : 'var(--success)' }}>
                        💱 {global ? 'PMP global' : 'PMP del almacén'} ajustado por recompra{aj.compra != null ? ` (compra a ${money(aj.compra)})` : ''}: {money(aj.antes)} → <strong>{money(aj.despues)}</strong> {aj.despues > (aj.antes ?? 0) ? '▲' : '▼'}
                      </div>
                    )}
                    <div className="kx-meta">{hora} · por {m.actor_name || m.actor || '—'}</div>
                  </div>

                  {/* 3) Saldo después del movimiento, en su ámbito */}
                  <div className="kx-saldo">
                    <small>{global ? 'saldo total' : `saldo en ${m.almacen}`}</small>
                    <strong>{num(m.stock_despues)}</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="card" style={{ padding: '.55rem .75rem', margin: 0 }}>
      <div className="muted" style={{ fontSize: '.65rem', textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
