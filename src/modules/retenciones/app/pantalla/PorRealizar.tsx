/* ============================================================
   MGG · Retenciones v8 · Por realizar

   Traslado de `v6PintarPendientes` de la maqueta: una fila por documento
   (OC o compra) con sus facturas registradas, el total, los impuestos que
   le faltan y las acciones. Solo se muestran las acciones que funcionan
   hoy: «Registrar» aparece cuando la pantalla recibe con qué registrar.
   «Gestionada en otro sistema…», «Ver en vista agrupada» y el bloque
   «Retenido al pagar» esperan a sus datos (capacidades), así que no se
   muestran.
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import type { RetencionItem } from '../datos/puerta';
import { BarraLista } from './BarraLista';
import { Paginador } from './Paginador';
import { filtrarPendientes, nombreImpuesto, opcionesImpuesto, type DocumentoPendiente, type OrdenPendientes } from './pendientesPorDocumento';

interface Props {
  docs: DocumentoPendiente[];
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
}

const ORDENES: { valor: OrdenPendientes; texto: string }[] = [
  { valor: 'antiguo', texto: 'Más antiguo primero' },
  { valor: 'reciente', texto: 'Más reciente primero' },
  { valor: 'proveedor', texto: 'Proveedor (A–Z)' },
];

export function PorRealizar({ docs, onRegistrar }: Props) {
  const [q, setQ] = useState('');
  const [impuesto, setImpuesto] = useState('');
  const [orden, setOrden] = useState<OrdenPendientes>('antiguo');
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);

  const filtrados = useMemo(() => filtrarPendientes(docs, { q, impuesto, orden }), [docs, q, impuesto, orden]);
  const { filas, pagina: pag } = paginar(filtrados, pagina, tamano);
  const conAcciones = !!onRegistrar;

  return (
    <>
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
        {filas.map(({ item, registradas, pendientes }) => (
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
                {pendientes.map((k) => (
                  <button key={k} type="button" className="mini registrar" onClick={() => onRegistrar?.(item, k)}>Registrar {nombreImpuesto(k)}</button>
                ))}
              </span>
            )}
          </div>
        ))}
        <Paginador total={filtrados.length} pagina={pag} tamano={tamano} unidad="documento(s)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </>
  );
}
