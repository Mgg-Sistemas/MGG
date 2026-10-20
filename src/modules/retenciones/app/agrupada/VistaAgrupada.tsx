/* ============================================================
   MGG · Retenciones v8 · Vista agrupada

   Traslado de la sección «Vista agrupada» de la maqueta v8
   (2026-10-14-retenciones-v8.html, `#sec-facturas`, líneas 1262–1336) con
   sus funciones de pintar: la búsqueda, las tarjetas por impuesto
   (`pintarTotales` de la v7), la nota del IGTF, los filtros, la barra
   «Agrupar por» y la vista (`vistaFactura`, `vistaSin`, `bloqueProveedor`,
   `v6AgruparPorDocumento`, `htmlFactura`, `htmlTira`, `htmlCasilla`).
   Mismas clases, con el prefijo rv8- (hoja rv8-agrupada.css).
   Lo que espera a la base de Retenciones (perfil fiscal, «Modificar» la
   aplicabilidad, «gestionada en otro sistema») no sale en producción; en
   local se ve vacío y marcado.
   ============================================================ */

import { useMemo, useState, type ReactNode } from 'react';
import { money } from '@/shared/lib/format';
import { nf, paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import type { ConceptoRetencion, ConfigRetencion, RetencionItem, RetencionPracticada } from '../datos/puerta';
import { AccionesRetencion } from '../pantalla/AccionesRetencion';
import { Paginador } from '../pantalla/Paginador';
import { impuestosQueAplican, nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { fechaVe } from '../pantalla/realizadasYLibro';
import {
  EST, SIGNO, armarFacturas, base, casillaCuenta, cuentasDe, faltaEn, hecha, impuestosActivos, motivoNoAplica, porDocumento,
  porProveedor, retenidoDe, sinRetencion, vistaFactura,
  type EstadoCasilla, type EstadoVista, type FacturaAgrupada, type FiltroFecha,
} from './modeloAgrupada';
import './rv8-agrupada.css';

/** Una marca discreta, solo en local, para lo que espera a la base de Retenciones. */
const RequiereBase = () => (import.meta.env.DEV ? <span className="rv8-huella">requiere la base de Retenciones (paquete 2.1)</span> : null);

const FECHAS: [FiltroFecha, string][] = [['quincena', 'Quincena actual'], ['mes', 'Mes actual'], ['pasado', 'Mes anterior'], ['todo', 'Todas'], ['rango', 'Rango…']];
const DIRECCIONES: ['practicada' | 'recibida' | '', string][] = [['practicada', 'A proveedores'], ['recibida', 'De clientes'], ['', 'Todas']];
const ESTADOS: ['' | EstadoCasilla, string][] = [['', 'Todos'], ['falta', 'Pendientes'], ['ok', 'Registradas'], ['declarada', 'Declaradas'], ['anulada', 'Anuladas'], ['pd', 'Por definir'], ['nc', 'No aplica']];
const MAX_PROVEEDOR = 5;
const monto = (m: Record<string, number>) => Object.entries(m).map(([mon, v]) => money(v, mon)).join(' + ') || money(0, 'Bs');
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

interface Props {
  pendientes: RetencionItem[];
  libro: RetencionPracticada[];
  config: ConfigRetencion;
  conceptos: ConceptoRetencion[];
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
}

export function VistaAgrupada({ pendientes, libro, config, conceptos, onRegistrar, onAnular, onAdjuntar }: Props) {
  const impuestos = useMemo(() => impuestosActivos(config, conceptos, libro), [config, conceptos, libro]);
  const facturas = useMemo(
    () => armarFacturas(pendientes, libro, impuestos, (it) => impuestosQueAplican(it, config, conceptos), motivoNoAplica(config, conceptos)),
    [pendientes, libro, impuestos, config, conceptos],
  );
  const [e, setE] = useState<EstadoVista>(() => ({
    q: '', fecha: 'mes', desde: '', hasta: '', provs: new Set(), imp: new Set(impuestos), dir: '', est: '', cuenta: null, sel: null,
  }));
  const [vista, setVista] = useState<'factura' | 'impuesto' | 'sin'>('factura');
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(TAMANO_PAGINA_INICIAL);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const cambiar = (p: Partial<EstadoVista>) => { setE((x) => ({ ...x, ...p })); setPagina(1); };

  const enBase = useMemo(() => base(facturas, e), [facturas, e]);
  const lista = useMemo(() => (vista === 'sin' ? sinRetencion(enBase, impuestos) : vistaFactura(enBase, e, impuestos)), [vista, enBase, e, impuestos]);
  const { filas, pagina: pag } = paginar(lista, pagina, tamano);

  // Una tarjeta elige su impuesto; tocarla otra vez vuelve a todos (`v7ElegirImpuesto`).
  const elegirImpuesto = (k: string | null) => cambiar({ sel: k, cuenta: null, imp: new Set(k ? [k] : impuestos) });
  const elegirCuenta = (k: string, tipo: NonNullable<EstadoVista['cuenta']>['tipo']) => {
    const igual = e.cuenta?.k === k && e.cuenta.tipo === tipo;
    cambiar(igual ? { cuenta: null } : { cuenta: { k, tipo }, sel: k, imp: new Set([k]) });
  };
  const limpiar = () => cambiar({ q: '', fecha: 'todo', provs: new Set(), imp: new Set(impuestos), dir: '', est: '', cuenta: null, sel: null });

  const nFiltros = [e.fecha !== 'todo', impuestos.some((k) => !e.imp.has(k)), !!e.dir, !!e.est, e.provs.size > 0].filter(Boolean).length;

  return (
    <div className="rv8-agrupada">
      <section className="rv8-buscar" role="search">
        <label htmlFor="rv8-q">Búsqueda: factura, proveedor, RIF, OC o comprobante</label>
        <span className="rv8-lupa" aria-hidden="true">⌕</span>
        <input id="rv8-q" className="rv8-q-campo" type="text" autoComplete="off" placeholder="Ej.: 000123, Alfa, J-00000002, OC-0045, 202609…"
          value={e.q} onChange={(ev) => cambiar({ q: ev.target.value })} />
      </section>

      <Totales enBase={enBase} impuestos={impuestos} e={e} onImpuesto={elegirImpuesto} onCuenta={elegirCuenta} />
      <p className="rv8-nota-igtf">El IGTF no se incluye en la tira: corresponde a una percepción por cada pago en divisas, no a una retención por factura. Se registra con el pago, en el Libro fiscal («IGTF pagado»).</p>

      <details className="rv8-filtros" open>
        <summary>Filtros ({nFiltros})</summary>
        <div className="rv8-filtros-cuerpo">
          <div className="rv8-campo">
            <span id="rv8-l-fecha">Fecha de la factura</span>
            <div className="rv8-chips" role="group" aria-labelledby="rv8-l-fecha">
              {FECHAS.map(([v, t]) => <button key={v} type="button" className="rv8-chip" aria-pressed={e.fecha === v} onClick={() => cambiar({ fecha: v })}>{t}</button>)}
            </div>
            {e.fecha === 'rango' && (
              <div className="rv8-rango">
                <input className="rv8-fecha" type="date" aria-label="Desde" value={e.desde} max={e.hasta || undefined} onChange={(ev) => cambiar({ desde: ev.target.value })} />
                <span className="rv8-muted">a</span>
                <input className="rv8-fecha" type="date" aria-label="Hasta" value={e.hasta} min={e.desde || undefined} onChange={(ev) => cambiar({ hasta: ev.target.value })} />
              </div>
            )}
          </div>
          <Proveedores facturas={facturas} provs={e.provs} onCambio={(provs) => cambiar({ provs })} />
          <div className="rv8-campo">
            <span id="rv8-l-imp">Impuesto</span>
            <div className="rv8-chips" role="group" aria-labelledby="rv8-l-imp">
              {impuestos.map((k) => (
                <button key={k} type="button" className="rv8-chip" aria-pressed={e.imp.has(k)} onClick={() => {
                  const imp = new Set(e.imp);
                  if (imp.has(k)) imp.delete(k); else imp.add(k);
                  if (!imp.size) return; // siempre queda al menos uno
                  cambiar({ imp, cuenta: null, sel: imp.size === 1 ? [...imp][0] : null });
                }}>{nombreImpuesto(k)}</button>
              ))}
            </div>
          </div>
          <div className="rv8-campo">
            <span id="rv8-l-dir">Dirección</span>
            <div className="rv8-chips" role="group" aria-labelledby="rv8-l-dir">
              {DIRECCIONES.map(([v, t]) => <button key={v || 'todas'} type="button" className="rv8-chip" aria-pressed={e.dir === v} onClick={() => cambiar({ dir: v })}>{t}</button>)}
            </div>
          </div>
          <label className="rv8-campo">
            <span>Estado</span>
            <select className="rv8-select" value={e.est} onChange={(ev) => cambiar({ est: ev.target.value as EstadoVista['est'], cuenta: null })}>
              {ESTADOS.map(([v, t]) => <option key={v || 'todos'} value={v}>{t}</option>)}
            </select>
          </label>
        </div>
      </details>

      <div className="rv8-barra-vista">
        <div className="rv8-view-switch rv8-agrupar" role="group" aria-label="Agrupar por">
          <button type="button" aria-pressed={vista === 'factura'} onClick={() => { setVista('factura'); setPagina(1); }}>Por factura</button>
          <button type="button" aria-pressed={vista === 'sin'} onClick={() => { setVista('sin'); setPagina(1); }}>Sin retención</button>
        </div>
        <div className="rv8-activos" aria-live="polite">
          {e.cuenta && (
            <span className="rv8-activo">Filtro: {nombreImpuesto(e.cuenta.k)} {{ falta: 'pendiente', hechas: 'registrada', pd: 'por definir', nc: 'no aplica' }[e.cuenta.tipo]}
              <button type="button" aria-label="Quitar este filtro" onClick={() => cambiar({ cuenta: null })}>✕</button></span>
          )}
        </div>
      </div>

      <section className="rv8-vista">
        {!lista.length ? (
          <div className="rv8-vacio">
            <p>{vista === 'sin' ? 'Sin facturas sin retención para los filtros aplicados.' : 'Sin facturas para los filtros aplicados.'}</p>
            <p className="rv8-muted">Ampliar el rango de fechas o buscar por proveedor, RIF, factura, OC o comprobante.</p>
            <button type="button" className="btn" onClick={limpiar}>Quitar filtros</button>
          </div>
        ) : (
          <>
            <p className="rv8-contador">
              {vista === 'sin'
                ? `${nf(lista.length)} factura(s) sin retenciones aplicables. Cada casilla indica el motivo.`
                : `${nf(lista.length)} factura(s). Las facturas sin retenciones aplicables figuran en «Sin retención».`}
            </p>
            {import.meta.env.DEV && vista === 'factura' && (
              <div className="rv8-v8-sel-filtro"><button type="button" className="btn" disabled>Seleccionar las facturas del filtro</button><RequiereBase /></div>
            )}
            {porProveedor(filas).map(([p, fs]) => (
              <Proveedor key={p} fs={fs} todas={facturas} conResumen={vista === 'factura'} impuestos={impuestos} e={e}
                abierto={expandidos.has(p) || fs.length <= MAX_PROVEEDOR}
                onPlegar={(abrir) => setExpandidos((s) => { const n = new Set(s); if (abrir) n.add(p); else n.delete(p); return n; })}
                onRegistrar={onRegistrar} onAnular={onAnular} onAdjuntar={onAdjuntar} pctIva={config.pctIvaGeneral} />
            ))}
            <Paginador total={lista.length} pagina={pag} tamano={tamano} unidad="factura(s)" onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
          </>
        )}
      </section>
    </div>
  );
}

/* ───────── Las tarjetas por impuesto (`pintarTotales`, v7) ───────── */
function Totales({ enBase, impuestos, e, onImpuesto, onCuenta }: {
  enBase: FacturaAgrupada[]; impuestos: string[]; e: EstadoVista;
  onImpuesto: (k: string | null) => void; onCuenta: (k: string, tipo: 'falta' | 'hechas' | 'pd' | 'nc') => void;
}) {
  const cuentas = Object.fromEntries(impuestos.map((k) => [k, cuentasDe(enBase, k)]));
  const tot = impuestos.reduce((a, k) => a + cuentas[k].faltan, 0);
  return (
    <section className="rv8-totales rv8-v7-tarjetas" aria-label="Totales por impuesto. Solo cuentan las retenciones aplicables. Cada número filtra la vista.">
      <div className="rv8-v7-tj-barra">
        <span className="rv8-v7-tj-ayuda">
          {e.sel ? <>Se muestra <b>{nombreImpuesto(e.sel)}</b>.</> : `Se muestran los ${impuestos.length} impuestos activos.`} Cada tarjeta selecciona su impuesto; sus números filtran la vista.
        </span>
        {e.sel && <button type="button" className="btn btn-ghost" onClick={() => onImpuesto(null)}>Ver todos los impuestos</button>}
      </div>
      <label className="rv8-campo rv8-v7-sel-movil">
        <span>Impuesto</span>
        <select className="rv8-select" value={e.sel ?? ''} onChange={(ev) => onImpuesto(ev.target.value || null)}>
          <option value="">Todos los impuestos · {nf(tot)} pendientes</option>
          {impuestos.map((k) => <option key={k} value={k}>{nombreImpuesto(k)} · {nf(cuentas[k].faltan)} pendientes</option>)}
        </select>
      </label>
      <div className="rv8-v7-tj-grid" style={{ ['--n' as string]: impuestos.length }}>
        {impuestos.map((k) => {
          const c = cuentas[k], on = e.sel === k;
          const b = (tipo: 'falta' | 'hechas' | 'pd' | 'nc', cls: string, num: number, txt: string) => (
            <button type="button" className={`rv8-cuenta${cls ? ` rv8-${cls}` : ''}`} aria-pressed={e.cuenta?.k === k && e.cuenta.tipo === tipo} disabled={!num} onClick={() => onCuenta(k, tipo)}>
              <strong>{nf(num)}</strong> {txt}
            </button>
          );
          return (
            <div key={k} className={`rv8-total-imp rv8-v7-tarjeta${on ? ' rv8-sel' : ''}`}>
              <button type="button" className="rv8-v7-tj" aria-pressed={on} onClick={() => onImpuesto(on ? null : k)}
                aria-label={`${nombreImpuesto(k)}: ${on ? 'seleccionado; tocar para ver todos los impuestos' : 'ver solo este impuesto'}`}>
                <span className="rv8-v7-tj-nombre">{nombreImpuesto(k)}</span>
                <span className="rv8-v7-tj-marca" aria-hidden="true">{on ? '✓ Seleccionado' : 'Ver solo este'}</span>
                <span className="rv8-v7-tj-ret">Retenido: {monto(c.monto)}</span>
              </button>
              <div className="rv8-botones">
                {b('falta', 'falta', c.faltan, plural(c.faltan, 'pendiente', 'pendientes'))}
                {b('hechas', '', c.hechas, plural(c.hechas, 'registrada', 'registradas'))}
                {b('pd', 'pd', c.pd, 'por definir')}
                {b('nc', '', c.nc, plural(c.nc, 'no aplica', 'no aplican'))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───────── Proveedores (multi-selección con búsqueda, `pintarProveedores`) ───────── */
function Proveedores({ facturas, provs, onCambio }: { facturas: FacturaAgrupada[]; provs: Set<string>; onCambio: (p: Set<string>) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [verElegidos, setVerElegidos] = useState(false);
  const todos = useMemo(() => {
    const m = new Map<string, { nombre: string; rif: string | null; n: number }>();
    for (const f of facturas) {
      const k = f.proveedorId ?? f.proveedorNombre;
      const x = m.get(k);
      if (x) x.n++; else m.set(k, { nombre: f.proveedorNombre, rif: f.proveedorRif, n: 1 });
    }
    return m;
  }, [facturas]);
  const nombre = (k: string) => todos.get(k)?.nombre ?? k;
  const sel = [...provs].sort((a, b) => nombre(a).localeCompare(nombre(b)));
  const alternar = (k: string) => { const n = new Set(provs); if (n.has(k)) n.delete(k); else n.add(k); onCambio(n); };
  const fila = (k: string) => (
    <label key={k} role="option" aria-selected={provs.has(k)}>
      <input type="checkbox" checked={provs.has(k)} onChange={() => alternar(k)} /> {nombre(k)} <span className="rv8-muted rv8-mono">{todos.get(k)?.rif ?? ''}</span>
    </label>
  );
  const ql = q.trim().toLowerCase();
  const encontrados = ql.length >= 2 ? [...todos.entries()].filter(([, p]) => p.nombre.toLowerCase().includes(ql) || (p.rif ?? '').toLowerCase().includes(ql)).map(([k]) => k) : [];
  const usados = [...todos.entries()].filter(([k]) => !provs.has(k)).sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([k]) => k);
  const chips = verElegidos ? sel : sel.slice(0, 3);
  return (
    <div className="rv8-campo">
      <span className="rv8-etiqueta" id="rv8-l-prov">Proveedores</span>
      <div className="rv8-multi">
        <button type="button" className={`rv8-select${sel.length ? ' rv8-activo' : ''}`} aria-haspopup="listbox" aria-expanded={abierto} aria-labelledby="rv8-l-prov rv8-prov-boton" id="rv8-prov-boton" onClick={() => setAbierto((a) => !a)}>
          <span>{!sel.length ? 'Todos' : sel.length === 1 ? nombre(sel[0]) : `${nombre(sel[0])} +${sel.length - 1}`}</span><span aria-hidden="true">▾</span>
        </button>
        {abierto && (
          <div className="rv8-multi-panel">
            <input className="rv8-texto" placeholder="Buscar proveedor o RIF (mínimo 2 caracteres)" aria-label="Buscar proveedor o RIF" value={q} onChange={(ev) => setQ(ev.target.value)} />
            <div className="rv8-multi-lista" role="listbox" aria-multiselectable="true">
              <label className="rv8-todos"><input type="checkbox" checked={!sel.length} onChange={() => onCambio(new Set())} /> Todos</label>
              {ql.length >= 2 ? (encontrados.length ? encontrados.slice(0, 20).map(fila) : <div className="rv8-info">Sin resultados</div>) : (
                <>
                  {sel.length > 0 && <><div className="rv8-sec">Elegidos</div>{sel.slice(0, 50).map(fila)}</>}
                  <div className="rv8-sec">Más usados en el período</div>
                  {usados.map(fila)}
                  {ql.length === 1 && <div className="rv8-info">Escribir al menos 2 caracteres para buscar.</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="rv8-elegidos" aria-live="polite">
        {chips.map((k) => (
          <span key={k} className="rv8-elegido">{nombre(k)}<button type="button" aria-label={`Quitar ${nombre(k)} del filtro`} onClick={() => alternar(k)}>✕</button></span>
        ))}
        {sel.length > 3 && !verElegidos && <button type="button" className="rv8-elegido rv8-mas-n" onClick={() => setVerElegidos(true)}>+{sel.length - 3}</button>}
        {sel.length > 1 && <button type="button" className="rv8-quitar-todos" onClick={() => onCambio(new Set())}>Quitar todos</button>}
      </div>
    </div>
  );
}

/* ───────── Un proveedor, sus documentos y sus facturas (`bloqueProveedor`, `v6AgruparPorDocumento`) ───────── */
interface AccionesProps {
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** El % de retención del IVA de Parámetros (75 % de la maqueta). */
  pctIva?: number;
}

function Proveedor({ fs, todas, conResumen, impuestos, e, abierto, onPlegar, ...acc }: AccionesProps & {
  fs: FacturaAgrupada[]; todas: FacturaAgrupada[]; conResumen: boolean; impuestos: string[]; e: EstadoVista;
  abierto: boolean; onPlegar: (abrir: boolean) => void;
}) {
  const f0 = fs[0];
  const visibles = abierto ? fs : fs.slice(0, MAX_PROVEEDOR);
  let resumen: ReactNode = `${fs.length} factura(s) en esta página`;
  if (conResumen) {
    const faltan = fs.reduce((a, f) => a + impuestos.filter((k) => faltaEn(f.casillas[k].estado)).length, 0);
    const pd = fs.reduce((a, f) => a + impuestos.filter((k) => f.casillas[k].estado === 'pd').length, 0);
    resumen = <>{resumen}{faltan ? <> · <b>{faltan} pendiente(s) de registro</b></> : ' · sin pendientes'}{pd ? ` · ${pd} por definir` : ''}</>;
  }
  return (
    <section className="rv8-proveedor">
      <header>
        <h3>{f0.proveedorNombre}<span className="rv8-rif">{f0.proveedorRif ?? ''}</span></h3>
        {f0.dir === 'recibida' ? <span className="rv8-perfil"><span className="rv8-etq">Cliente</span></span> : import.meta.env.DEV && <span className="rv8-perfil"><button type="button" className="rv8-mini" disabled>Perfil fiscal</button><RequiereBase /></span>}
        <span className="rv8-resumen">{resumen}</span>
      </header>
      {porDocumento(visibles).map(([doc, xs]) => <Documento key={doc} xs={xs} todas={todas} impuestos={impuestos} e={e} {...acc} />)}
      {fs.length > MAX_PROVEEDOR && (
        abierto
          ? <button type="button" className="rv8-ver-restantes" aria-expanded="true" onClick={() => onPlegar(false)}>Mostrar menos (las primeras {MAX_PROVEEDOR})</button>
          : <button type="button" className="rv8-ver-restantes" aria-expanded="false" onClick={() => onPlegar(true)}>Ver las {fs.length - MAX_PROVEEDOR} facturas restantes de este proveedor</button>
      )}
    </section>
  );
}

function Documento({ xs, todas, impuestos, e, ...acc }: AccionesProps & { xs: FacturaAgrupada[]; todas: FacturaAgrupada[]; impuestos: string[]; e: EstadoVista }) {
  const x0 = xs[0];
  const delDoc = x0.docId ? todas.filter((f) => f.docKind === x0.docKind && f.docId === x0.docId) : xs;
  const pend = [...new Set(delDoc.flatMap((f) => (f.dir === 'practicada' ? impuestos.filter((k) => faltaEn(f.casillas[k].estado)) : [])))];
  const reg = delDoc.filter((f) => f.num != null).length;
  return (
    <>
      <div className="rv8-doc-cab">
        <span>Documento <b>{x0.docCodigo ?? '—'}</b> · {reg} factura(s) registrada(s){delDoc.length > reg ? ` · ${delDoc.length - reg} por registrar` : ''}</span>
        <span>{pend.length ? `Pendiente: ${pend.map(nombreImpuesto).join(', ')}` : 'Sin pendientes'}</span>
      </div>
      {xs.map((f) => <Factura key={f.id} f={f} impuestos={impuestos} e={e} {...acc} />)}
    </>
  );
}

/* ───────── La factura y su tira (`htmlFactura`, `htmlTira`) ───────── */
function Factura({ f, impuestos, e, ...acc }: AccionesProps & { f: FacturaAgrupada; impuestos: string[]; e: EstadoVista }) {
  const ret = retenidoDe(f);
  const n = impuestos.length;
  const titulo = f.num != null || f.dir !== 'practicada'
    ? `Factura ${f.num ?? '—'}`
    : <>Factura por indicar <span className="rv8-doc-pend">(el N° se escribe al registrar)</span></>;
  return (
    <article className="rv8-factura" aria-label={`Factura ${f.num ?? 'por indicar'} de ${f.proveedorNombre}`}>
      <div>
        <div className="rv8-num">{titulo}</div>
        <div className="rv8-meta">{fechaVe(f.fecha)} · <span className="rv8-doc">{f.docCodigo ?? '—'}</span>{f.total != null ? ` · ${money(f.total, f.moneda)}` : ''}</div>
        {f.dir === 'recibida' && <div className="rv8-meta">Retención de clientes (la empresa es sujeto retenido)</div>}
      </div>
      <div className={`rv8-tira${n === 4 ? ' rv8-cuatro' : ''}`} style={{ ['--n' as string]: n }} role="group" aria-label={`Retenciones de la factura ${f.num ?? 'por indicar'}`}>
        {impuestos.map((k) => <CasillaV key={k} f={f} k={k} e={e} n={n} {...acc} />)}
      </div>
      <div className="rv8-tot"><small>Total retenido</small><span>{Object.keys(ret).length ? monto(ret) : '—'}</span></div>
    </article>
  );
}

/* ───────── Una casilla (`htmlCasilla`) ───────── */
function CasillaV({ f, k, e, n, pctIva, onRegistrar, onAnular, onAdjuntar }: AccionesProps & { f: FacturaAgrupada; k: string; e: EstadoVista; n: number }) {
  const c = f.casillas[k];
  const r = c.retencion;
  const at = (e.cuenta || e.est || e.imp.size < n) && !casillaCuenta(e, f, k) ? ' rv8-atenuada' : '';
  const origen = c.origen === 'libro' ? 'según libro' : 'según Parámetros';
  const est = c.estado === 'anulada' ? `Anulada · el ${nombreImpuesto(k)} de esta factura está pendiente` : EST[c.estado];
  return (
    <div className={`rv8-casilla rv8-${c.estado}${at}`}>
      <span className="rv8-imp">{nombreImpuesto(k)}<span className="rv8-origen">{origen}{r?.actorName ? ` · ${r.actorName}` : ''}</span></span>
      <span className="rv8-est">{SIGNO[c.estado]} {est}</span>
      {(hecha(c.estado) || c.estado === 'anulada') && r ? (
        <>
          <span className="rv8-monto">{money(r.montoRetenido, r.moneda)}</span>
          {k === 'iva' && r.porcentaje ? <span className="rv8-por"><b>{r.porcentaje} %</b></span> : null}
          {k !== 'iva' && r.conceptoNombre ? <span className="rv8-por">{r.conceptoNombre}</span> : null}
          {r.numeroComprobante && <span className="rv8-comp" title="Comprobante">N° {r.numeroComprobante}</span>}
        </>
      ) : c.estado === 'falta' ? (
        <span className="rv8-por">{k === 'iva' ? <>Retención aplicable: <b>{pctIva ?? 75} %</b></> : 'Concepto por seleccionar'}</span>
      ) : (
        <span className="rv8-motivo">{c.motivo ?? ''}</span>
      )}
      <CasillaAcciones f={f} k={k} c={c} onRegistrar={onRegistrar} onAnular={onAnular} onAdjuntar={onAdjuntar} />
    </div>
  );
}

function CasillaAcciones({ f, k, c, onRegistrar, onAnular, onAdjuntar }: AccionesProps & { f: FacturaAgrupada; k: string; c: FacturaAgrupada['casillas'][string] }) {
  const registrar = faltaEn(c.estado) && f.dir === 'practicada' && f.item && onRegistrar;
  const conAcciones = c.retencion && c.estado !== 'anulada';
  if (!registrar && !conAcciones) return null;
  return (
    <span className="rv8-acciones">
      {registrar && (
        <button type="button" className="rv8-mini rv8-registrar" onClick={() => onRegistrar(f.item!, k)}>
          {c.estado === 'anulada' ? 'Crear una nueva con estos datos' : 'Registrar'}
        </button>
      )}
      {conAcciones && <AccionesRetencion r={c.retencion!} onAnular={onAnular} onAdjuntar={onAdjuntar} corto />}
    </span>
  );
}
