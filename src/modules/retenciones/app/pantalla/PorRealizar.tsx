/* ============================================================
   MGG · Retenciones v8 · Por realizar

   Traslado de `v6PintarPendientes` de la maqueta (2026-10-14-retenciones-v8.html,
   l. 4633-4670), en el mismo orden:
   1. el panel «Retenido al pagar, sin registrar (N)» (C1), con «Elegir el
      impuesto…» y «Registrar» por fila (v8-12 §2: ningún impuesto viene marcado);
   2. los avisos del pago mayor al debido (C2 a), con «Descartar»;
   3. la barra, la nota y la lista: una fila por documento con sus facturas
      registradas, el total, los impuestos pendientes y las acciones
      («Registrar <IMP>», «Gestionada en otro sistema…», «📎 Factura»,
      «Ver OC» y «Ver en vista agrupada»).
   Una acción sin su función (o sin datos) no se muestra. «Gestionada en otro
   sistema…» necesita la base de Retenciones (paquete 2.1): solo en local,
   desactivada y con su marca; en producción no aparece.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import { usePuerta, type ArchivoFactura, type RetencionItem, type RetenidoAlPagar } from '../datos/puerta';
import { BarraLista } from './BarraLista';
import { Paginador } from './Paginador';
import { filtrarPendientes, nombreImpuesto, opcionesImpuesto, type DocumentoPendiente, type OrdenPendientes } from './pendientesPorDocumento';
import { archivosFactura, avisoDeDocumento, itemDelRetenido } from './porRealizarExtras';
import './rv8-por-realizar.css';

interface Props {
  docs: DocumentoPendiente[];
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
  /** Abre la OC (solo con permiso de Compras o Pedidos). Sin ella, «Ver OC» no se muestra. */
  onVerOc?: (item: RetencionItem) => void;
  /** Lleva el documento a la Vista agrupada. Sin ella, el botón no se muestra. */
  onVerAgrupada?: (item: RetencionItem) => void;
}

const ORDENES: { valor: OrdenPendientes; texto: string }[] = [
  { valor: 'antiguo', texto: 'Más antiguo primero' },
  { valor: 'reciente', texto: 'Más reciente primero' },
  { valor: 'proveedor', texto: 'Proveedor (A–Z)' },
];

const MARCA_BASE = 'Requiere la base de Retenciones (paquete 2.1)';

export function PorRealizar({ docs, onRegistrar, onVerOc, onVerAgrupada }: Props) {
  const puerta = usePuerta();
  const [q, setQ] = useState('');
  const [impuesto, setImpuesto] = useState('');
  const [orden, setOrden] = useState<OrdenPendientes>('antiguo');
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const [descartados, setDescartados] = useState<Set<string>>(() => new Set());

  const filtrados = useMemo(() => filtrarPendientes(docs, { q, impuesto, orden }), [docs, q, impuesto, orden]);
  const { filas, pagina: pag } = paginar(filtrados, pagina, tamano);
  const avisos = useMemo(
    () => docs.map((d) => ({ item: d.item, texto: avisoDeDocumento(d.item) }))
      .filter((a): a is { item: RetencionItem; texto: string } => !!a.texto && !descartados.has(`${a.item.kind}:${a.item.id}`)),
    [docs, descartados],
  );
  const abrir = puerta.verFactura;
  const verFactura = abrir ? (a: ArchivoFactura) => abrir.call(puerta, a) : null;
  const conAcciones = !!(onRegistrar || verFactura || onVerOc || onVerAgrupada || import.meta.env.DEV);

  return (
    <>
      <RetenidoAlPagarPanel items={docs.map((d) => d.item)} onRegistrar={onRegistrar} />
      {avisos.map(({ item, texto }) => (
        <div key={`${item.kind}:${item.id}`} className="rv8-alerta-media rv8-aviso-fila" role="status">
          <span>{item.ocCodigo ?? '—'} · {item.proveedorNombre}: {texto}</span>
          <button type="button" className="rv8-mini" onClick={() => setDescartados((s) => new Set(s).add(`${item.kind}:${item.id}`))}>Descartar</button>
        </div>
      ))}
      <BarraLista
        q={q} placeholder="Buscar por proveedor, RIF, factura u OC" resultados={filtrados.length} unidad="documento(s)"
        filtros={[{ campo: 'k', etiqueta: 'Impuesto', valor: impuesto, opciones: opcionesImpuesto(docs) }]}
        orden={{ valor: orden, opciones: ORDENES }}
        onQ={(v) => { setQ(v); setPagina(1); }}
        onFiltro={(_, v) => { setImpuesto(v); setPagina(1); }}
        onOrden={(v) => { setOrden(v as OrdenPendientes); setPagina(1); }}
        onQuitar={() => { setQ(''); setImpuesto(''); setPagina(1); }}
      />
      <p className="huella">Lo pendiente se agrupa por documento (OC o compra). Cada factura se registra aparte, con su número escrito a mano; el documento sigue aquí mientras le quede algo por registrar.</p>
      <div className={`lista-sis${conAcciones ? '' : ' sin-acciones'}`}>
        <div className="fila-sis cab">
          <span>OC o compra</span><span>Proveedor</span><span>Facturas</span><span className="n">Total</span><span>Pendiente</span>{conAcciones && <span />}
        </div>
        {filas.length === 0 && (
          <div className="vacio"><p>{docs.length ? 'Ningún documento coincide con la búsqueda o los filtros.' : 'No hay retenciones por realizar.'}</p></div>
        )}
        {filas.map(({ item, registradas, pendientes }) => {
          const archivos = archivosFactura(item);
          return (
            <div key={`${item.kind}-${item.id}`} className="fila-sis">
              <span data-l="OC o compra" className="mono">
                {item.ocCodigo ?? '—'}
                {item.kind === 'compra_directa' && <span className="badge v8-badge-cd" title="Compra directa">CD</span>}
              </span>
              <span data-l="Proveedor">{item.proveedorNombre}<small>{item.proveedorRif ?? 'Sin RIF'}</small></span>
              <span data-l="Facturas">{registradas ? `${registradas} registrada(s)` : 'Ninguna registrada'}</span>
              <span className="n" data-l="Total">{money(item.total, item.moneda)}</span>
              <span data-l="Pendiente">
                {pendientes.length
                  ? pendientes.map((k) => <span key={k} className="pill falta">{nombreImpuesto(k)}</span>)
                  : <span className="muted">—</span>}
              </span>
              {conAcciones && (
                <span className="acc">
                  {onRegistrar && pendientes.map((k) => (
                    <button key={k} type="button" className="mini registrar" onClick={() => onRegistrar(item, k)}>Registrar {nombreImpuesto(k)}</button>
                  ))}
                  {import.meta.env.DEV && pendientes.length > 0 && (
                    <button type="button" className="mini rv8-requiere-base" disabled title={MARCA_BASE} aria-label={`Gestionada en otro sistema (${MARCA_BASE})`}>
                      Gestionada en otro sistema…
                    </button>
                  )}
                  {verFactura && (archivos.length
                    ? (
                      <button type="button" className="mini" aria-label={`Ver el archivo de la factura de ${item.ocCodigo ?? 'el documento'}`}
                        onClick={() => { verFactura(archivos[0]).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo abrir la factura.', 'error')); }}>
                        📎 Factura
                      </button>
                    )
                    : <button type="button" className="mini" disabled title="Sin archivo de factura en Compras" aria-label="Sin archivo de factura en Compras">📎 Sin archivo</button>)}
                  {onVerOc && item.kind === 'oc' && <button type="button" className="mini" onClick={() => onVerOc(item)}>Ver OC</button>}
                  {onVerAgrupada && <button type="button" className="mini" onClick={() => onVerAgrupada(item)}>Ver en vista agrupada</button>}
                </span>
              )}
            </div>
          );
        })}
        <Paginador total={filtrados.length} pagina={pag} tamano={tamano} unidad="documento(s)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </>
  );
}

/* ───────── «Retenido al pagar, sin registrar (N)» (C1; maqueta l. 4640-4647 y v8-12 §2) ───────── */

const IMPUESTOS_PAGO = ['iva', 'islr', 'municipal'];

function RetenidoAlPagarPanel({ items, onRegistrar }: { items: RetencionItem[]; onRegistrar?: (item: RetencionItem, impuesto: string) => void }) {
  const puerta = usePuerta();
  const [lista, setLista] = useState<RetenidoAlPagar[]>([]);
  const [elegido, setElegido] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    puerta.retenidoSinRegistrar?.()
      .then((xs) => { if (vivo) setLista(xs); })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo leer lo retenido al pagar.', 'error'));
    return () => { vivo = false; };
  }, [puerta]);
  if (!lista.length) return null;
  return (
    <div className="rv8-tarjeta-pagar">
      <h3>Retenido al pagar, sin registrar ({lista.length})</h3>
      <p className="rv8-huella">Lo retenido en el pago que todavía no está en el libro, incluidos los servicios directos. Al registrar, se usa la tasa de la factura y la del pago queda como referencia.</p>
      <div className="rv8-lista-mini">
        {lista.slice(0, 10).map((r) => {
          const clave = `${r.kind}:${r.id}`, item = itemDelRetenido(r, items), k = elegido[clave] ?? '';
          return (
            <div key={clave} className="rv8-fila">
              <span>
                <b className="mono">{r.codigo ?? '—'}</b> · {r.kind === 'oc' ? 'OC' : r.kind === 'compra_directa' ? 'Compra directa' : 'Servicio directo'}
                {' · '}{r.proveedorNombre ?? '—'} · retenido {money(r.retenido, r.moneda)}
                {r.tasa ? ` · tasa del pago ${r.tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
              </span>
              {onRegistrar && item && (
                <span className="rv8-v8-pago-imp">
                  <select className="rv8-select" value={k} aria-label={`Impuesto de lo retenido al pagar en ${r.codigo ?? 'el documento'}`}
                    onChange={(e) => setElegido((m) => ({ ...m, [clave]: e.target.value }))}>
                    <option value="">Elegir el impuesto…</option>
                    {IMPUESTOS_PAGO.map((x) => <option key={x} value={x}>{nombreImpuesto(x)}</option>)}
                  </select>
                  <button type="button" className="rv8-mini rv8-registrar" disabled={!k} onClick={() => onRegistrar(item, k)}>
                    {k ? `Registrar ${nombreImpuesto(k)}` : 'Registrar'}
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {lista.length > 10 && <p className="rv8-huella">Se muestran 10 de {lista.length}.</p>}
    </div>
  );
}
