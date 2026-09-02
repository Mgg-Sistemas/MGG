/* ============================================================
   MGG · Cocina · Panel del Mercado (ciclo de 21 días)

   Se muestra POR CAPAS, de lo macro a lo micro:
     1. La ecuación del ciclo (saldo + entradas = disponible − consumo = queda),
        siempre visible, y el contraste contra el inventario SOLO si no cuadra.
     2. Un selector de qué mirar: Disponible, Movimientos o ambos. Antes los dos
        bloques venían encima sin alternativa y con 50 víveres el scroll era
        abrumador; ahora lo elige el usuario y se recuerda.
     3. El detalle: drill por víver y kardex.

   Los víveres que NO se movieron en el ciclo quedan detrás de un «ver los N
   restantes»: siguen ahí, pero no compiten con lo que sí pasó.
   ============================================================ */
import { Fragment, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import type { CocinaComida } from '@/shared/lib/types';
import { labelTipoComida, TIPOS_COMIDA } from './cocina.repository';
import {
  cerrarMercado, type ResumenMercado, type DisponibleItem, type KardexEntrada, type KardexConsumo,
  type MercadoCocina,
} from './mercados.repository';
import { separarMovidos } from './mercadoComparar';

/** Qué bloque se está mirando. Se recuerda por usuario. */
type Vista = 'disponible' | 'movimientos' | 'ambos';
const VISTA_KEY = 'mgg.cocina.mercado.vista';

/** Un cero en una tabla de 50 filas es ruido: se muestra un punto tenue. */
function cifra(n: number): string { return n === 0 ? '·' : num(n); }

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function diaAntes(iso: string): string { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }

export function MercadoPanel({ resumen, mercados, onElegirMercado, cocinaNombre, almacen, canWrite, actor, userEmail, onReload, onEditComida, onDelComida }: {
  resumen: ResumenMercado;
  /** Todos los cortes de esta cocina, del más nuevo al más viejo. Alimenta el selector. */
  mercados: MercadoCocina[];
  onElegirMercado: (id: string) => void;
  cocinaNombre: string;
  almacen: string | null;
  canWrite: boolean;
  actor: string;
  userEmail: string | null;
  onReload: () => void | Promise<void>;
  onEditComida: (c: CocinaComida) => void;
  onDelComida: (c: CocinaComida) => void;
}) {
  const { mercado, dia, dias, puedeCerrar, disponible, kardex, totales, diferencias } = resumen;
  const [drill, setDrill] = useState<DisponibleItem | null>(null);
  const [cerrar, setCerrar] = useState(false);
  const [busca, setBusca] = useState('');
  const [verQuietos, setVerQuietos] = useState(false);
  const [soloDif, setSoloDif] = useState(false);
  const [vista, setVista] = useState<Vista>(() => {
    try { const v = localStorage.getItem(VISTA_KEY); if (v === 'disponible' || v === 'movimientos' || v === 'ambos') return v; } catch { /* modo privado */ }
    return 'disponible';
  });
  function elegirVista(v: Vista) {
    setVista(v);
    try { localStorage.setItem(VISTA_KEY, v); } catch { /* modo privado: no se recuerda, no importa */ }
  }

  // Los víveres que se movieron en el ciclo van primero; los que solo arrastran
  // saldo quedan detrás de un botón. Con 50 víveres, mostrarlos todos es lo que
  // hace que no se pueda leer nada.
  const { movidos, quietos } = useMemo(() => separarMovidos(disponible), [disponible]);
  const difPorProducto = useMemo(
    () => new Map(diferencias.map((d) => [d.producto_id, d] as const)),
    [diferencias],
  );

  // Un víver puede estar descuadrado SIN haberse movido en el ciclo: arrastra un
  // saldo que el inventario no tiene. Escondido detrás de «ver los que no se
  // movieron», la tira decía «10 víveres» y la tabla mostraba 7 — el descuadre se
  // contaba pero no se podía encontrar. Los quietos con diferencia suben siempre.
  const [quietosConDif, quietosOk] = useMemo(() => {
    const con: DisponibleItem[] = [];
    const sin: DisponibleItem[] = [];
    for (const d of quietos) (difPorProducto.has(d.producto_id) ? con : sin).push(d);
    return [con, sin] as const;
  }, [quietos, difPorProducto]);

  // Con 50 víveres y 10 descuadrados, encontrarlos a ojo entre las barras naranjas
  // es el trabajo que el filtro evita: se pide «solo los descuadrados» y la tabla
  // queda con esos y nada más.
  const filas = useMemo(() => {
    const base = [...movidos, ...quietosConDif];
    if (soloDif) return base.filter((d) => difPorProducto.has(d.producto_id));
    return verQuietos ? [...base, ...quietosOk] : base;
  }, [movidos, quietosConDif, quietosOk, verQuietos, soloDif, difPorProducto]);
  const kardexFiltrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return kardex;
    return kardex.filter((k) => {
      if (k.kind === 'entrada') return k.nombre.toLowerCase().includes(q);
      return `${k.comida.codigo} ${labelTipoComida(k.comida.tipo_comida)} ${(k.comida.items ?? []).map((i) => i.nombre).join(' ')}`.toLowerCase().includes(q);
    });
  }, [kardex, busca]);

  return (
    <div>
      {/* ── CAPA 1 · La ecuación del ciclo ─────────────────────────────────
          Cinco números en el orden en que se leen. Reemplaza a las cuatro tarjetas
          que mezclaban bolívares con platos y no se sumaban entre sí. */}
      <div className="card" style={{ margin: '.3rem 0 .7rem', padding: '.8rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.35rem' }}>
          {/* Con un solo corte el selector sería un desplegable de un elemento: hasta
              que exista el segundo, el título es texto. */}
          {mercados.length > 1 ? (
            <select
              className="select"
              style={{ width: 'auto', fontSize: '.9rem', fontWeight: 700, padding: '.15rem 1.6rem .15rem .4rem' }}
              value={mercado.id}
              onChange={(e) => onElegirMercado(e.target.value)}
              title="Cambiar de mercado"
            >
              {mercados.map((m) => (
                <option key={m.id} value={m.id}>
                  Mercado #{m.numero}{m.estado === 'abierto' ? ' · en curso' : ''}
                </option>
              ))}
            </select>
          ) : (
            <strong style={{ fontSize: '.95rem' }}>Mercado #{mercado.numero}</strong>
          )}
          <span className="muted" style={{ fontSize: '.78rem' }}>
            {fmtDia(mercado.fecha_inicio)} → {fmtDia(mercado.fecha_fin)}
            {mercado.estado === 'cerrado'
              ? ' · cerrado'
              : ` · día ${Math.min(dia, dias)} de ${dias}`}
          </span>
        </div>

        {/* Autoría: sin protagonismo. Es un dato de respaldo para cuando alguien
            pregunta quién movió el corte, no algo que haya que leer todos los días.
            Los mercados anteriores al 02/09/2026 no la tienen guardada. */}
        {(mercado.abierto_por_nombre || mercado.abierto_por || mercado.cerrado_por_nombre || mercado.cerrado_por) && (
          <div className="dim" style={{ fontSize: '.71rem', marginBottom: '.55rem' }}>
            {(mercado.abierto_por_nombre || mercado.abierto_por) && (
              <>Abrió {mercado.abierto_por_nombre || mercado.abierto_por}</>
            )}
            {(mercado.abierto_por_nombre || mercado.abierto_por) && (mercado.cerrado_por_nombre || mercado.cerrado_por) && ' · '}
            {(mercado.cerrado_por_nombre || mercado.cerrado_por) && (
              <>Cerró {mercado.cerrado_por_nombre || mercado.cerrado_por}
                {mercado.cerrado_en ? ` el ${fmtDia(mercado.cerrado_en.slice(0, 10))}` : ''}</>
            )}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: '.5rem' }}>
          <Cifra rotulo="Saldo inicial" valor={num(totales.saldoInicial)} />
          <Cifra rotulo="+ Entradas" valor={num(totales.entradas)} color="var(--primary-3, #2ecc71)" />
          <Cifra rotulo="= Disponible" valor={num(totales.disponible)} fuerte />
          <Cifra rotulo="− Consumo" valor={num(totales.consumos)} color="var(--danger)" />
          <Cifra rotulo="= Queda" valor={num(totales.queda)} fuerte color="var(--primary-3, #2ecc71)" />
        </div>
        {/* El contraste con el inventario aparece SOLO si no cuadra. Un «0» que
            tranquiliza ocupa lugar y enseña a no mirar. */}
        {totales.diferencia != null && totales.vieresConDiferencia > 0 && (
          <div style={{ marginTop: '.6rem', paddingTop: '.55rem', borderTop: '1px solid var(--border)', fontSize: '.83rem' }}>
            ⚠ Según el inventario quedan <strong className="mono">{num(totales.inventario ?? 0)}</strong>
            {' · diferencia '}
            <strong className="mono" style={{ color: totales.diferencia < 0 ? 'var(--danger)' : 'var(--warning)' }}>
              {totales.diferencia > 0 ? '+' : ''}{num(totales.diferencia)}
            </strong>
            {' en '}{totales.vieresConDiferencia} víver{totales.vieresConDiferencia === 1 ? '' : 'es'}
            {/* Un solo botón lleva de la advertencia a los víveres concretos: enciende
                el filtro y, si hacía falta, cambia a la vista que tiene la tabla.
                Antes solo cambiaba de vista y dejaba al analista buscándolos a ojo. */}
            <button
              className={`btn btn-sm ${soloDif ? 'btn-primary' : 'btn-ghost'}`}
              style={{ marginLeft: '.5rem' }}
              onClick={() => {
                const activar = !soloDif;
                setSoloDif(activar);
                if (activar && vista === 'movimientos') elegirVista('disponible');
              }}
            >
              {soloDif ? '↩ Ver todos' : 'Ver solo estos'}
            </button>
          </div>
        )}
      </div>

      {/* ── CAPA 2 · Qué se quiere mirar ───────────────────────────────────── */}
      <div className="view-switch" style={{ display: 'flex', gap: '.35rem', marginBottom: '.7rem', flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '.76rem', alignSelf: 'center', marginRight: '.2rem' }}>Ver:</span>
        {([['disponible', 'Disponible'], ['movimientos', 'Movimientos'], ['ambos', 'Ambos']] as [Vista, string][]).map(([v, label]) => (
          <button key={v} type="button" className={`btn btn-sm ${vista === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => elegirVista(v)}>
            {label}
          </button>
        ))}
      </div>

      {/* Botón de cierre (resaltado desde el día 22). Un mercado ya cerrado se está
          CONSULTANDO desde el selector: ofrecerle «cerrar» sería una trampa. */}
      {canWrite && mercado.estado === 'abierto' && (
        <div style={{ marginBottom: '.8rem' }}>
          <button
            className={`btn ${puedeCerrar ? 'btn-primary' : 'btn-ghost'}`}
            style={puedeCerrar ? {} : { borderStyle: 'dashed' }}
            onClick={() => setCerrar(true)}
            title={puedeCerrar ? 'Cerrar el mercado y arrastrar lo que queda al próximo' : 'Todavía no llega el día 22; podés cerrar igual si hace falta'}
          >
            {puedeCerrar ? '🔒 Cerrar mercado (día 22) — genera PDF y arrastra saldo' : '🔒 Cerrar mercado anticipadamente'}
          </button>
        </div>
      )}

      {/* ── CAPA 3a · Disponible a consumir ──────────────────────────────── */}
      {vista !== 'movimientos' && (
      <div className="card" style={{ marginBottom: '.9rem' }}>
        <div className="card-title" style={{ marginBottom: '.5rem' }}>Disponible a consumir <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· saldo inicial + entradas − consumos · tocá un víver para el detalle</span></div>
        {/* Una tabla filtrada que no lo dice se lee como si fuera todo el mercado, y
            ahí el filtro deja de ayudar y empieza a engañar. El aviso lleva su propia
            salida, para no tener que volver a la tira de arriba. */}
        {soloDif && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.5rem', padding: '.4rem .6rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-2, rgba(255,255,255,.03))', borderRadius: 'var(--r-sm, 4px)', fontSize: '.79rem' }}>
            <span style={{ color: 'var(--warning)' }}>
              Mostrando solo los <strong>{filas.length}</strong> víveres descuadrados de {disponible.length}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSoloDif(false)}>↩ Ver todos</button>
          </div>
        )}
        {!filas.length ? (
          <p className="hint muted" style={{ margin: 0 }}>
            {soloDif
              ? 'Ya no queda ningún víver descuadrado: el mercado y el inventario coinciden.'
              : 'Sin víveres movidos en este mercado todavía.'}
          </p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.83rem' }}>
              <thead><tr>
                <th>Víver</th>
                <th style={{ textAlign: 'right' }}>Saldo inicial</th>
                <th style={{ textAlign: 'right' }}>Entradas</th>
                <th style={{ textAlign: 'right' }}>Disponible</th>
                <th style={{ textAlign: 'right' }}>Consumido</th>
                <th style={{ textAlign: 'right' }}>Queda</th>
              </tr></thead>
              <tbody>
                {filas.map((d) => {
                  const dif = difPorProducto.get(d.producto_id);
                  return (
                    // El Fragment lleva la key, no el <tr>: la fila del víver y su
                    // sub-línea de diferencia son DOS <tr> del mismo elemento de la lista.
                    <Fragment key={d.producto_id}>
                      <tr className="row-selectable"
                        style={{ cursor: 'pointer', ...(dif ? { borderLeft: '3px solid var(--warning)' } : {}) }}
                        onClick={() => setDrill(d)} title="Ver saldo, entradas y consumos">
                        {/* La unidad va UNA vez, con el nombre: repetirla en cada celda de
                            «Queda» partía el número en dos líneas y multiplicaba el ruido. */}
                        <td>
                          {d.nombre}{' '}
                          <span className="muted mono" style={{ fontSize: '.72rem' }}>{d.unidad}</span>
                          {' '}<span className="dim mono" style={{ fontSize: '.7rem' }}>{d.sku}</span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{cifra(d.saldoInicial)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.entradas ? 'var(--primary-3, #2ecc71)' : undefined }}>{d.entradas ? `+${num(d.entradas)}` : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{cifra(d.disponible)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: d.consumos ? 'var(--danger)' : undefined }}>{d.consumos ? `−${num(d.consumos)}` : '·'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: d.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(d.queda)}</td>
                      </tr>
                      {/* La diferencia se dice con NÚMEROS y palabras, no solo con un color:
                          así se lee igual en una captura en blanco y negro. */}
                      {dif && (
                        <tr style={{ borderLeft: '3px solid var(--warning)' }}>
                          <td colSpan={6} style={{ paddingTop: 0, fontSize: '.76rem' }}>
                            <span style={{ color: 'var(--warning)' }}>⚠ en inventario hay <strong className="mono">{num(dif.inventario)}</strong></span>
                            {' · '}
                            {dif.diferencia < 0 ? 'faltan' : 'sobran'} <strong className="mono">{num(Math.abs(dif.diferencia))}</strong> {d.unidad.toLowerCase()}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* Los que no se movieron no desaparecen: su stock sigue siendo real. Se
            cuentan los CUADRADOS: los que tienen diferencia ya están arriba, y
            ofrecer «ver 12» para después mostrar 9 es una cuenta que no cierra.
            Con el filtro encendido el botón no va: contradiría al filtro. */}
        {!soloDif && quietosOk.length > 0 && (
          <button className="btn btn-sm btn-ghost" style={{ marginTop: '.5rem' }} onClick={() => setVerQuietos((v) => !v)}>
            {verQuietos ? `Ocultar los ${quietosOk.length} que no se movieron` : `Ver los ${quietosOk.length} víveres que no se movieron`}
          </button>
        )}
      </div>
      )}

      {/* ── CAPA 3b · Kardex: entradas (verde) y consumos (rojo) ─────────── */}
      {vista !== 'disponible' && (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
          <div className="card-title" style={{ margin: 0 }}>Movimientos del mercado <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· entradas y consumos</span></div>
          <input className="input" style={{ maxWidth: 240 }} placeholder="Buscar en el kardex…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {!kardexFiltrado.length ? (
          <p className="hint muted" style={{ margin: 0 }}>Sin movimientos en este mercado.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {kardexFiltrado.map((k, i) => k.kind === 'entrada'
              ? <FilaEntrada key={`e${i}`} row={k} />
              : <FilaConsumo key={`c${k.comida.id}`} row={k} canWrite={canWrite} onEdit={() => onEditComida(k.comida)} onDel={() => onDelComida(k.comida)} />)}
          </div>
        )}
      </div>
      )}

      {drill && (
        <DrillModal item={drill} kardex={kardex} fechaInicio={mercado.fecha_inicio} onClose={() => setDrill(null)} />
      )}
      {cerrar && (
        <CierreModal resumen={resumen} cocinaNombre={cocinaNombre} almacen={almacen} actor={actor} userEmail={userEmail}
          onClose={() => setCerrar(false)}
          onDone={async () => { setCerrar(false); await onReload(); }} />
      )}
    </div>
  );
}

/** Un número de la ecuación del ciclo, con su rótulo debajo. */
function Cifra({ rotulo, valor, color, fuerte }: { rotulo: string; valor: string; color?: string; fuerte?: boolean }) {
  return (
    <div>
      {/* Cifras tabulares (.mono) para que los dígitos se alineen entre mercados
          cuando se comparan dos cortes uno debajo del otro. */}
      <div className="mono" style={{ fontSize: fuerte ? '1.35rem' : '1.15rem', fontWeight: fuerte ? 800 : 700, color }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.02em' }}>{rotulo}</div>
    </div>
  );
}

/* ───────── Fila de kardex: ENTRADA (verde) ───────── */
function FilaEntrada({ row }: { row: KardexEntrada }) {
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--primary-3, #2ecc71)', display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '.86rem' }}><span style={{ color: 'var(--primary-3, #2ecc71)' }}>⬇ Entrada</span> · {row.nombre}</div>
        <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(row.at)}{row.almacen ? ` · 📦 ${row.almacen}` : ''}{row.detalle ? ` · ${row.detalle}` : ''}</div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div className="mono" style={{ fontWeight: 800, color: 'var(--primary-3, #2ecc71)' }}>+{num(row.cantidad)} {row.unidad}</div>
        {row.valor > 0 && <div className="muted mono" style={{ fontSize: '.74rem' }}>{money(row.valor)}</div>}
      </div>
    </div>
  );
}

/* ───────── Fila de kardex: CONSUMO (rojo, expandible) ───────── */
function FilaConsumo({ row, canWrite, onEdit, onDel }: { row: KardexConsumo; canWrite: boolean; onEdit: () => void; onDel: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const c = row.comida;
  const t = TIPOS_COMIDA.find((x) => x.value === c.tipo_comida);
  return (
    <div className="card" style={{ margin: 0, padding: '.5rem .7rem', borderLeft: '4px solid var(--danger)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ minWidth: 0, cursor: 'pointer' }} onClick={() => setAbierto((v) => !v)}>
          <div style={{ fontWeight: 600, fontSize: '.86rem' }}>
            <span style={{ color: 'var(--danger)' }}>⬆ Consumo</span> · <span className="mono">{c.codigo}</span> · {t?.icon} {labelTipoComida(c.tipo_comida)}
          </div>
          <div className="muted" style={{ fontSize: '.74rem' }}>{dateTime(c.at)} · {num(c.platos)} platos · {(c.items ?? []).length} víver(es) {abierto ? '▾' : '▸'}</div>
        </div>
        <div style={{ textAlign: 'right', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span className="mono" style={{ fontWeight: 800, color: 'var(--danger)' }}>{money(c.valor_total)}</span>
          {canWrite && <>
            <button className="btn btn-sm btn-ghost" onClick={onEdit} title="Editar comida">✎</button>
            <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDel} title="Eliminar comida">🗑</button>
          </>}
        </div>
      </div>
      {abierto && (
        <ul className="muted" style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem', fontSize: '.78rem' }}>
          {(c.items ?? []).map((it, j) => <li key={j}>{it.nombre} · {num(it.cantidad)} {it.unidad} · {money(it.subtotal)}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ───────── Drill-down de un víver: saldo inicial + entradas + consumos ───────── */
function DrillModal({ item, kardex, fechaInicio, onClose }: {
  item: DisponibleItem; kardex: (KardexEntrada | KardexConsumo)[]; fechaInicio: string; onClose: () => void;
}) {
  const entradas = kardex.filter((k): k is KardexEntrada => k.kind === 'entrada' && k.producto_id === item.producto_id);
  const consumos = kardex
    .filter((k): k is KardexConsumo => k.kind === 'consumo')
    .map((k) => ({ comida: k.comida, item: (k.comida.items ?? []).find((it) => it.producto_id === item.producto_id) }))
    .filter((x) => x.item);

  return (
    <Modal title={`Víver · ${item.nombre}`} size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)', fontSize: '.9rem' }}>
        <div>Hasta el <strong>{fmtDia(diaAntes(fechaInicio))}</strong>: quedaban <strong className="mono">{num(item.saldoInicial)} {item.unidad}</strong></div>
        <div>+ entradas desde el <strong>{fmtDia(fechaInicio)}</strong>: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{num(item.entradas)} {item.unidad}</strong></div>
        <div style={{ marginTop: '.2rem' }}>= <strong>TOTAL DISPONIBLE A CONSUMIR</strong>: <strong className="mono" style={{ fontSize: '1.05rem' }}>{num(item.disponible)} {item.unidad}</strong></div>
        <div className="muted">− consumido: <strong className="mono" style={{ color: 'var(--danger)' }}>{num(item.consumos)} {item.unidad}</strong> · queda: <strong className="mono" style={{ color: item.queda <= 0 ? 'var(--danger)' : 'var(--primary-3, #2ecc71)' }}>{num(item.queda)} {item.unidad}</strong></div>
      </div>

      <h4 style={{ margin: '.6rem 0 .35rem', color: 'var(--primary-3, #2ecc71)' }}>Entradas ({entradas.length})</h4>
      {!entradas.length ? <p className="hint muted" style={{ margin: 0 }}>Sin entradas nuevas en este mercado.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {entradas.map((e, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span className="muted">{dateTime(e.at)}{e.almacen ? ` · 📦 ${e.almacen}` : ''}</span>
              <span className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>+{num(e.cantidad)} {e.unidad}</span>
            </div>
          ))}
        </div>
      )}

      <h4 style={{ margin: '.8rem 0 .35rem', color: 'var(--danger)' }}>Consumos ({consumos.length})</h4>
      {!consumos.length ? <p className="hint muted" style={{ margin: 0 }}>Sin consumos de este víver.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          {consumos.map(({ comida, item: it }, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.25rem', fontSize: '.83rem' }}>
              <span><span className="mono">{comida.codigo}</span> · {labelTipoComida(comida.tipo_comida)} · <span className="muted">{dateTime(comida.at)}</span></span>
              <span className="mono" style={{ color: 'var(--danger)' }}>−{num(it?.cantidad ?? 0)} {it?.unidad ?? ''}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* ───────── Modal de cierre: preview PDF + correo + confirmar ───────── */
function CierreModal({ resumen, cocinaNombre, almacen, actor, userEmail, onClose, onDone }: {
  resumen: ResumenMercado; cocinaNombre: string; almacen: string | null; actor: string; userEmail: string | null;
  onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const { mercado, kpis, disponible, totales, diferencias } = resumen;
  const remanente = disponible.filter((d) => d.queda > 0);
  const [correos, setCorreos] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El ajuste solo EXISTE si hay diferencia. Cuando todo cuadra, el modal es un
  // resumen y un botón: sin opciones, sin motivo, sin fricción.
  const hayDiferencia = diferencias.length > 0;
  const [ajustar, setAjustar] = useState(true);   // por defecto ajustar: es lo que ya se hacía a mano
  const [motivo, setMotivo] = useState('');

  // Snapshot "previo" para la vista previa del PDF (mismos datos que persiste el cierre).
  const snapshotPreview = useMemo(() => ({
    generado_en: new Date().toISOString(),
    desde: `${mercado.fecha_inicio}T00:00:00`, hasta: `${mercado.fecha_fin}T23:59:59`,
    totales: { platos: kpis.platos, valor: kpis.consumoValor, entradasValor: kpis.entradasValor },
    consumos: disponible.filter((d) => d.consumos > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.consumos, valor: Math.round(d.consumos * d.precio * 100) / 100 })),
    entradas: disponible.filter((d) => d.entradas > 0).map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.entradas, valor: Math.round(d.entradas * d.precio * 100) / 100 })),
    remanente: remanente.map((d) => ({ producto_id: d.producto_id, sku: d.sku, nombre: d.nombre, unidad: d.unidad, cantidad: d.queda })),
  }), [mercado, kpis, disponible, remanente]);

  async function verPdf() {
    try {
      const { descargarCierrePdf } = await import('./mercadoCierrePdf');
      await descargarCierrePdf(cocinaNombre, mercado, snapshotPreview);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmar() {
    setError(null); setSaving(true);
    try {
      const { cerrado, snapshot } = await cerrarMercado(mercado, almacen, actor, userEmail,
        hayDiferencia ? { ajustarAInventario: ajustar, motivo } : undefined);
      // Siempre genera el PDF del cierre (vista previa).
      try {
        const { descargarCierrePdf } = await import('./mercadoCierrePdf');
        await descargarCierrePdf(cocinaNombre, cerrado, snapshot);
      } catch { /* si el PDF falla, el cierre igual quedó hecho */ }
      // Correo OPCIONAL: solo si se cargaron destinatarios.
      const lista = correos.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
      if (lista.length) {
        try {
          const { enviarCierrePorCorreo } = await import('./enviarCierreCocina');
          const { destinatarios } = await enviarCierrePorCorreo(cocinaNombre, cerrado, snapshot, lista);
          toast(`Mercado cerrado · PDF generado · enviado a ${destinatarios.join(', ')}`, 'success');
        } catch (e) {
          toast(`Mercado cerrado y PDF generado, pero el correo falló: ${e instanceof Error ? e.message : ''}`, 'warning');
        }
      } else {
        toast('Mercado cerrado · PDF generado. Se abrió el siguiente con el saldo arrastrado.', 'success');
      }
      notify(`🔒 Cocina · mercado #${mercado.numero} de ${cocinaNombre} cerrado`, 'info', { link: '#/app/cocina' });
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cerrar el mercado'); setSaving(false); }
  }

  return (
    <Modal title={`Cerrar mercado #${mercado.numero} · ${cocinaNombre}`} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-ghost" onClick={verPdf} disabled={saving}>↓ Ver PDF</button>
        <button className="btn btn-primary" onClick={() => void confirmar()}
          disabled={saving || (hayDiferencia && ajustar && motivo.trim().length < 5)}
          title={hayDiferencia && ajustar && motivo.trim().length < 5 ? 'Escribí el motivo del ajuste' : undefined}>
          {saving ? 'Cerrando…' : '🔒 Cerrar mercado'}
        </button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ marginTop: 0 }}>
        Se cierra el mercado <strong>#{mercado.numero}</strong> ({fmtDia(mercado.fecha_inicio)} → {fmtDia(mercado.fecha_fin)}), se <strong>genera el PDF</strong> del cierre y <strong>lo que queda pasa como saldo inicial del próximo mercado</strong>. No mueve el inventario real. El correo es opcional.
      </p>
      <div className="card" style={{ margin: '0 0 .8rem', background: 'var(--bg-2)' }}>
        <div style={{ fontSize: '.88rem' }}>Platos: <strong className="mono">{num(kpis.platos)}</strong> · Consumo: <strong className="mono" style={{ color: 'var(--danger)' }}>{money(kpis.consumoValor)}</strong> · Remanente: <strong className="mono" style={{ color: 'var(--primary-3, #2ecc71)' }}>{money(kpis.disponibleValor)}</strong></div>
        <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>{remanente.length} víver(es) pasan al próximo mercado.</div>
      </div>

      {/* ── El ajuste: SOLO cuando el libro y el almacén no coinciden ──────────
          No se escribe ningún movimiento de inventario. Si los dos difieren es
          porque algo se movió por fuera del ciclo y el inventario YA lo contó:
          escribirlo otra vez lo contaría dos veces. Lo único que se decide acá es
          con qué número arranca el mercado siguiente. */}
      {hayDiferencia && (
        <div className="card" style={{ margin: '0 0 .8rem', borderColor: 'var(--warning)' }}>
          <div style={{ fontWeight: 600, marginBottom: '.4rem' }}>
            ⚠ El mercado y el inventario no coinciden
          </div>
          <div style={{ fontSize: '.86rem', marginBottom: '.5rem' }}>
            Según el mercado quedan <strong className="mono">{num(totales.queda)}</strong> ·
            {' '}según el inventario <strong className="mono">{num(totales.inventario ?? 0)}</strong> ·
            {' diferencia '}
            <strong className="mono" style={{ color: (totales.diferencia ?? 0) < 0 ? 'var(--danger)' : 'var(--warning)' }}>
              {(totales.diferencia ?? 0) > 0 ? '+' : ''}{num(totales.diferencia ?? 0)}
            </strong>
            {' en '}{diferencias.length} víver{diferencias.length === 1 ? '' : 'es'}
          </div>
          <div className="table-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: '.6rem' }}>
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr>
                <th>Víver</th>
                <th style={{ textAlign: 'right' }}>Mercado</th>
                <th style={{ textAlign: 'right' }}>Inventario</th>
                <th style={{ textAlign: 'right' }}>Diferencia</th>
              </tr></thead>
              <tbody>
                {diferencias.map((d) => (
                  <tr key={d.producto_id} style={{ borderLeft: '3px solid var(--warning)' }}>
                    <td>{d.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{d.unidad}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(d.mercado)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(d.inventario)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: d.diferencia < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                      {d.diferencia > 0 ? '+' : ''}{num(d.diferencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '.35rem' }}>
            <input type="radio" checked={ajustar} onChange={() => setAjustar(true)} style={{ marginTop: '.25rem' }} />
            <span style={{ fontSize: '.86rem' }}>
              <strong>Ajustar al inventario</strong> ({num(totales.inventario ?? 0)}) — el mercado siguiente arranca del stock real
            </span>
          </label>
          <label style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="radio" checked={!ajustar} onChange={() => setAjustar(false)} style={{ marginTop: '.25rem' }} />
            <span style={{ fontSize: '.86rem' }}>
              Cerrar con el remanente del mercado ({num(totales.queda)}) — la diferencia queda anotada y se arrastra
            </span>
          </label>
          {ajustar && (
            <div className="form-row" style={{ marginTop: '.55rem' }}>
              <label>Motivo del ajuste <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: conteo del 11/09 con la cocina · salida no imputada al ciclo" />
              <small className="muted" style={{ fontSize: '.72rem' }}>
                Queda guardado en el cierre. Sin esto, dentro de cuatro meses el número no se puede auditar.
              </small>
            </div>
          )}
        </div>
      )}
      <div className="form-row">
        <label>📧 Enviar por correo <span className="muted" style={{ fontWeight: 400 }}>· opcional (dejalo vacío para solo cerrar y generar el PDF)</span></label>
        <input className="input" value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="correo1@mgg.com, correo2@mgg.com" />
      </div>
    </Modal>
  );
}
