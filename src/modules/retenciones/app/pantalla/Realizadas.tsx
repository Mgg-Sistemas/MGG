/* ============================================================
   MGG · Retenciones v8 · Realizadas

   Traslado de `v7PintarHechas` de la maqueta: una fila por factura con sus
   retenciones («IVA · Bs 360,00 · N° … · Registrada», quién y cuándo).
   «🖨 Comprobante», «+ Nota de crédito», «Historial», «Imprimir lista» y
   «Ver en vista agrupada» esperan a sus datos y no se muestran.
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import type { RetencionPracticada } from '../datos/puerta';
import { BarraLista } from './BarraLista';
import { Paginador } from './Paginador';
import { nombreImpuesto } from './pendientesPorDocumento';
import {
  ESTADO_CLASE, ESTADO_TEXTO, FILTRO_INICIAL, estadoDe, facturasRealizadas, fechaVe, opcionesLibro, textoDireccion,
  type FiltroLibro, type OrdenLista,
} from './realizadasYLibro';
import { quienYCuando } from './quien';

const ORDENES = [{ valor: 'reciente', texto: 'Más reciente primero' }, { valor: 'antiguo', texto: 'Más antiguo primero' }];

export function Realizadas({ libro }: { libro: RetencionPracticada[] }) {
  const [f, setF] = useState<FiltroLibro>(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const opciones = useMemo(() => opcionesLibro(libro), [libro]);
  const facturas = useMemo(() => facturasRealizadas(libro, f), [libro, f]);
  const { filas, pagina: pag } = paginar(facturas, pagina, tamano);
  const cambiar = (x: Partial<FiltroLibro>) => { setF((v) => ({ ...v, ...x })); setPagina(1); };

  return (
    <>
      <BarraLista
        q={f.q} placeholder="Buscar por N° de comprobante, proveedor, RIF, factura u OC" resultados={facturas.length} unidad="factura(s)"
        filtros={[
          { campo: 'impuesto', etiqueta: 'Impuesto', valor: f.impuesto, opciones: opciones.impuesto },
          { campo: 'mes', etiqueta: 'Mes', valor: f.mes, opciones: opciones.mes },
          { campo: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: opciones.estado },
        ]}
        orden={{ valor: f.orden, opciones: ORDENES }}
        onQ={(q) => cambiar({ q })}
        onFiltro={(campo, valor) => cambiar({ [campo]: valor } as Partial<FiltroLibro>)}
        onOrden={(v) => cambiar({ orden: v as OrdenLista })}
        onQuitar={() => cambiar({ q: '', impuesto: '', mes: '', estado: '' })}
      />
      <div className="lista-sis v8-realizadas">
        <div className="fila-sis cab"><span>OC o compra</span><span>Proveedor</span><span>Factura</span><span>Retenciones</span></div>
        {filas.length === 0 && (
          <div className="vacio"><p>{libro.length ? 'Ninguna factura coincide con la búsqueda o los filtros.' : 'Todavía no hay retenciones registradas.'}</p></div>
        )}
        {filas.map((x) => (
          <div key={x.clave} className="fila-sis">
            <span data-l="OC o compra" className="mono">{x.docCodigo ?? '—'}</span>
            <span data-l="Proveedor">{x.contraparteNombre ?? '—'}<small>{textoDireccion(x)}</small></span>
            <span data-l="Factura">{x.facturaNumero ?? '—'}<small>{fechaVe(x.fecha)}</small></span>
            <span data-l="Retenciones">
              {x.retenciones.map((r) => {
                const e = estadoDe(r);
                return (
                  <span key={r.id} className="v8-ret-linea">
                    {nombreImpuesto(r.tipo)} · {money(r.montoRetenido, r.moneda)} · N° {r.numeroComprobante ?? 'sin número'}{' '}
                    <span className={`pill ${ESTADO_CLASE[e]}`}>{ESTADO_TEXTO[e]}</span>
                    <small>{quienYCuando(r)}</small>
                  </span>
                );
              })}
            </span>
          </div>
        ))}
        <Paginador total={facturas.length} pagina={pag} tamano={tamano} unidad="factura(s)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </>
  );
}
