/* ============================================================
   MGG · Retenciones v8 · Vista agrupada «Por impuesto»

   Traslado de `vistaImpuesto` de la v7 en la maqueta v8 (R2-7): un
   impuesto a la vez (el de la tarjeta elegida), agrupado por proveedor y
   paginado; «Mostrar», «Orden» y «Buscar en …»; cada proveedor se abre
   con sus facturas (10 y «Ver las N facturas restantes»).
   «Pendientes del período en curso y vencidos» y la selección para el
   comprobante agrupado esperan a la base de Retenciones (períodos y el
   interruptor «Agrupar comprobantes»): solo en local, marcados.
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { nf, paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import type { RetencionItem } from '../datos/puerta';
import { AccionesRetencion } from '../pantalla/AccionesRetencion';
import { Paginador } from '../pantalla/Paginador';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { fechaVe } from '../pantalla/realizadasYLibro';
import {
  EST, MOSTRAR_I, faltaEn, gruposPorImpuesto, hecha, montoDe, razonSeleccion,
  type FacturaAgrupada, type MostrarImpuesto, type OrdenImpuesto,
} from './modeloAgrupada';

const MAX_GRUPO = 10;
const montos = (m: Record<string, number>) => Object.entries(m).map(([mon, v]) => money(v, mon)).join(' + ');

interface Props {
  enBase: FacturaAgrupada[];
  k: string;
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
}

export function PorImpuesto({ enBase, k, onRegistrar }: Props) {
  const [mostrar, setMostrar] = useState<MostrarImpuesto>('pend');
  const [orden, setOrden] = useState<OrdenImpuesto>('antigua');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(TAMANO_PAGINA_INICIAL);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [verTodas, setVerTodas] = useState<Set<string>>(new Set());
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const { grupos, facturas } = useMemo(() => gruposPorImpuesto(enBase, k, mostrar, orden, q), [enBase, k, mostrar, orden, q]);
  const { filas, pagina: pag } = paginar(grupos, pagina, tamano);
  const seleccionable = mostrar === 'pend' && import.meta.env.DEV;
  const total = grupos.reduce<Record<string, number>>((a, g) => { for (const [m, v] of Object.entries(g.total)) a[m] = (a[m] ?? 0) + v; return a; }, {});
  const alternar = (set: Set<string>, id: string, fijar: (s: Set<string>) => void, si?: boolean) => {
    const n = new Set(set);
    if (si ?? !n.has(id)) n.add(id); else n.delete(id);
    fijar(n);
  };
  const porId = new Map(enBase.map((f) => [f.id, f]));
  const elegidas = [...seleccion].map((id) => ({ f: porId.get(id), k })).filter((x): x is { f: FacturaAgrupada; k: string } => !!x.f);

  return (
    <>
      <div className="rv8-v7-imp-controles">
        <label className="rv8-campo"><span>Mostrar</span>
          <select className="rv8-select" value={mostrar} onChange={(ev) => { setMostrar(ev.target.value as MostrarImpuesto); setPagina(1); setSeleccion(new Set()); }}>
            {import.meta.env.DEV && <option disabled>Pendientes del período en curso y vencidos (requiere la base de Retenciones)</option>}
            {(Object.keys(MOSTRAR_I) as MostrarImpuesto[]).map((v) => <option key={v} value={v}>{MOSTRAR_I[v]}</option>)}
          </select>
        </label>
        <label className="rv8-campo"><span>Orden</span>
          <select className="rv8-select" value={orden} onChange={(ev) => { setOrden(ev.target.value as OrdenImpuesto); setPagina(1); }}>
            <option value="antigua">La factura más antigua primero</option>
            <option value="reciente">La más reciente primero</option>
            <option value="monto">Mayor monto primero</option>
          </select>
        </label>
        <label className="rv8-campo rv8-v7-buscar-i"><span>Buscar en {nombreImpuesto(k)}</span>
          <input className="rv8-texto" value={q} placeholder="Proveedor, RIF, factura u OC" onChange={(ev) => { setQ(ev.target.value); setPagina(1); }} />
        </label>
      </div>
      <p className="rv8-contador">
        {nombreImpuesto(k)} · {MOSTRAR_I[mostrar].toLowerCase()}: <b>{nf(facturas)}</b> factura(s) de <b>{nf(grupos.length)}</b> proveedor(es)
        {Object.keys(total).length ? ` · total ${montos(total)}` : ''}.
      </p>

      {!grupos.length ? (
        <div className="rv8-vacio"><p>Sin facturas para este impuesto con este filtro.</p></div>
      ) : filas.map((g) => {
        const abierto = abiertos.has(g.p);
        const ids = g.xs.map((f) => f.id), marcadas = ids.filter((id) => seleccion.has(id)).length;
        const visibles = verTodas.has(g.p) ? g.xs : g.xs.slice(0, MAX_GRUPO);
        return (
          <section key={g.p} className={`rv8-v7-grupo${abierto ? ' rv8-abierto' : ''}`}>
            <div className="rv8-v7-grupo-cab">
              {seleccionable ? (
                <input type="checkbox" className="rv8-v7-chk" checked={marcadas > 0 && marcadas === ids.length}
                  ref={(el) => { if (el) el.indeterminate = marcadas > 0 && marcadas < ids.length; }}
                  aria-label={`Seleccionar todas las facturas de ${g.nombre} (${ids.length})`}
                  onChange={(ev) => { const n = new Set(seleccion); for (const id of ids) { if (ev.target.checked) n.add(id); else n.delete(id); } setSeleccion(n); }} />
              ) : <span />}
              <button type="button" className="rv8-v7-grupo-btn" aria-expanded={abierto} onClick={() => alternar(abiertos, g.p, setAbiertos)}>
                <span className="rv8-v7-flecha" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
                <span className="rv8-nombre">{g.nombre}<small>{g.rif ?? ''}</small></span>
              </button>
              <span className="rv8-v7-g-n">{nf(g.xs.length)} factura(s){marcadas ? <> · <b>{marcadas} marcada(s)</b></> : null}</span>
              <span className="rv8-v7-g-monto rv8-n">{Object.keys(g.total).length ? montos(g.total) : '—'}<small>{mostrar === 'hechas' ? 'retenido' : ''}</small></span>
              <span className="rv8-v7-g-antigua">Más antigua: {fechaVe(g.antigua)}</span>
            </div>
            {abierto && (
              <>
                <ul className="rv8-v7-items">
                  {visibles.map((f) => {
                    const c = f.casillas[k], m = montoDe(f, k);
                    return (
                      <li key={f.id} className="rv8-v7-item">
                        {seleccionable ? (
                          <input type="checkbox" className="rv8-v7-chk" checked={seleccion.has(f.id)} aria-label={`Seleccionar la factura ${f.num ?? f.docCodigo ?? ''} de ${g.nombre}`}
                            onChange={() => alternar(seleccion, f.id, setSeleccion)} />
                        ) : <span />}
                        <span className="rv8-quien">Factura {f.num ?? 'por indicar'} · {f.docCodigo ?? '—'}
                          <small>{fechaVe(f.fecha)}{c.motivo && (c.estado === 'pd' || c.estado === 'nc') ? ` · ${c.motivo}` : ''}</small></span>
                        <span className="rv8-cuanto"><span className={`rv8-pill rv8-${c.estado}`}>{EST[c.estado]}</span>{m ? <><br /><span className="rv8-monto">{money(m.monto, m.moneda)}</span></> : null}</span>
                        <span className="rv8-acc">
                          {faltaEn(c.estado) && f.dir === 'practicada' && f.item && onRegistrar && (
                            <button type="button" className="rv8-mini rv8-registrar" onClick={() => onRegistrar(f.item!, k)}>{c.estado === 'anulada' ? 'Crear una nueva con estos datos' : 'Registrar'}</button>
                          )}
                          {hecha(c.estado) && c.retencion && <AccionesRetencion r={c.retencion} corto />}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {g.xs.length > MAX_GRUPO && (verTodas.has(g.p)
                  ? <button type="button" className="rv8-ver-restantes" aria-expanded="true" onClick={() => alternar(verTodas, g.p, setVerTodas, false)}>Mostrar menos (las primeras {MAX_GRUPO})</button>
                  : <button type="button" className="rv8-ver-restantes" aria-expanded="false" onClick={() => alternar(verTodas, g.p, setVerTodas, true)}>Ver las {g.xs.length - MAX_GRUPO} facturas restantes de este proveedor</button>)}
              </>
            )}
          </section>
        );
      })}
      {grupos.length > 0 && <Paginador total={grupos.length} pagina={pag} tamano={tamano} unidad="proveedor(es)" onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />}

      {seleccionable && seleccion.size > 0 && (
        <div className="rv8-barra-agrupado rv8-v7-barra-sel" role="region" aria-label="Selección">
          <span className="rv8-v7-sel-txt"><b>{nf(seleccion.size)} seleccionada(s)</b> · {nombreImpuesto(k)}<small>{razonSeleccion(elegidas)}</small></span>
          <span className="rv8-v7-sel-acc">
            <button type="button" className="btn btn-ghost" onClick={() => setSeleccion(new Set())}>Quitar selección ({nf(seleccion.size)})</button>
            <button type="button" className="btn" disabled>Emitir comprobante agrupado…</button>
            <MarcaPaquete21 />
          </span>
        </div>
      )}
    </>
  );
}
