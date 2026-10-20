/* ============================================================
   MGG · Retenciones v8 · Libro fiscal

   Traslado de `v6PintarLibro` de la maqueta: una fila por retención con la
   fecha, el comprobante, el impuesto, el proveedor, la factura, lo
   retenido y su estado (con quién y cuándo). «Anular» aparece solo si la
   pantalla recibe con qué anular; «🖨 Comprobante», «Historial» y el
   aviso de IVA cambiado esperan a sus datos y no se muestran.
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import type { RetencionPracticada } from '../datos/puerta';
import { AccionesRetencion } from './AccionesRetencion';
import { BarraLista } from './BarraLista';
import { Paginador } from './Paginador';
import { nombreImpuesto } from './pendientesPorDocumento';
import {
  ESTADO_CLASE, ESTADO_TEXTO, FILTRO_INICIAL, estadoDe, fechaVe, filasLibro, opcionesLibro, textoDireccion,
  type FiltroLibro, type OrdenLista,
} from './realizadasYLibro';
import { quienYCuando } from './quien';

const ORDENES = [{ valor: 'reciente', texto: 'Más reciente primero' }, { valor: 'antiguo', texto: 'Más antiguo primero' }];

interface Props {
  libro: RetencionPracticada[];
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
}

export function LibroFiscalV8({ libro, onAnular, onAdjuntar }: Props) {
  const [f, setF] = useState<FiltroLibro>(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const opciones = useMemo(() => opcionesLibro(libro), [libro]);
  const xs = useMemo(() => filasLibro(libro, f), [libro, f]);
  const { filas, pagina: pag } = paginar(xs, pagina, tamano);
  const cambiar = (x: Partial<FiltroLibro>) => { setF((v) => ({ ...v, ...x })); setPagina(1); };

  return (
    <>
      <BarraLista
        q={f.q} placeholder="Buscar por N° de comprobante, proveedor, RIF, factura u OC" resultados={xs.length} unidad="retención(es)"
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
      <div className="lista-sis v8-libro">
        <div className="fila-sis cab">
          <span>Fecha</span><span>Comprobante</span><span>Impuesto</span><span>Proveedor</span><span>Factura</span><span className="n">Retenido</span><span>Estado</span><span />
        </div>
        {filas.length === 0 && (
          <div className="vacio"><p>{libro.length ? 'Ninguna retención coincide con la búsqueda o los filtros.' : 'Todavía no hay retenciones en el libro.'}</p></div>
        )}
        {filas.map((r) => {
          const e = estadoDe(r);
          return (
            <div key={r.id} className="fila-sis">
              <span data-l="Fecha">{fechaVe(r.facturaFecha ?? r.createdAt)}</span>
              <span data-l="Comprobante" className="mono">{r.numeroComprobante ?? '—'}</span>
              <span data-l="Impuesto">{nombreImpuesto(r.tipo)}<small>{textoDireccion(r)}</small></span>
              <span data-l="Proveedor">{r.contraparteNombre ?? '—'}<small>{r.contraparteRif ?? ''}</small></span>
              <span data-l="Factura">{r.facturaNumero ?? '—'}<small>{r.docCodigo ?? ''}</small></span>
              <span className="n" data-l="Retenido">{money(r.montoRetenido, r.moneda)}</span>
              <span data-l="Estado"><span className={`pill ${ESTADO_CLASE[e]}`}>{ESTADO_TEXTO[e]}</span><small>{quienYCuando(r)}</small></span>
              <span className="acc"><AccionesRetencion r={r} onAnular={onAnular} onAdjuntar={onAdjuntar} /></span>
            </div>
          );
        })}
        <Paginador total={xs.length} pagina={pag} tamano={tamano} unidad="retención(es)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </>
  );
}
