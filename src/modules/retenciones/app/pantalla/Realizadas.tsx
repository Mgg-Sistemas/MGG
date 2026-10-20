/* ============================================================
   MGG · Retenciones v8 · Realizadas

   Traslado de `v7PintarHechas` de la maqueta (v8-3-listas.js, l. 191-230):
   una fila por factura con sus retenciones («IVA · Bs 360,00 · N° … ·
   Registrada», quién y cuándo) y, a la derecha, las acciones de la factura:
   «🖨 <IMP>» por cada comprobante practicado, «+ Nota de crédito» y «Ver en
   vista agrupada». Una anulada dice si la reemplazó otra o si el impuesto
   quedó pendiente.
   «📎 Factura» lee el archivo de Compras por la puerta (useArchivosFactura).
   «+ Nota de crédito» necesita la base de Retenciones (paquete 2.1): solo en
   local, desactivado y con su marca. «Imprimir lista», el filtro «Origen» y
   «Registrar <IMP> de nuevo» esperan a sus datos y no se muestran.
   ============================================================ */

import { useMemo, useState, type CSSProperties } from 'react';
import { money } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { AccionesRetencion } from './AccionesRetencion';
import { BotonFactura } from './BotonFactura';
import { BarraLista } from './BarraLista';
import { Paginador } from './Paginador';
import { nombreImpuesto } from './pendientesPorDocumento';
import {
  ESTADO_CLASE, FILTRO_INICIAL, estadoDe, facturasRealizadas, fechaVe, opcionesLibro, textoDireccion, textoEstadoEnFactura,
  type FacturaRealizada, type FiltroLibro, type OrdenLista,
} from './realizadasYLibro';
import { quienYCuando } from './quien';
import { useArchivosFactura } from './useArchivosFactura';
import './rv8-por-realizar.css';

const ORDENES = [{ valor: 'reciente', texto: 'Más reciente primero' }, { valor: 'antiguo', texto: 'Más antiguo primero' }];
/** Las columnas de la maqueta (listaSis de v7PintarHechas). */
const COLUMNAS = { '--cols': '1fr 1.5fr 1fr 3.2fr 1.4fr' } as CSSProperties;
const MARCA_BASE = 'Requiere la base de Retenciones (paquete 2.1)';

export function Realizadas({ libro, onAnular, onAdjuntar, onVerAgrupada }: {
  libro: RetencionPracticada[];
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** Lleva la factura a la Vista agrupada. Sin ella, el botón no se muestra. */
  onVerAgrupada?: (factura: FacturaRealizada) => void;
}) {
  const puerta = usePuerta();
  const [f, setF] = useState<FiltroLibro>(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const opciones = useMemo(() => opcionesLibro(libro), [libro]);
  const facturas = useMemo(() => facturasRealizadas(libro, f), [libro, f]);
  const { filas, pagina: pag } = paginar(facturas, pagina, tamano);
  const cambiar = (x: Partial<FiltroLibro>) => { setF((v) => ({ ...v, ...x })); setPagina(1); };
  const archivos = useArchivosFactura(useMemo(() => filas.map((x) => ({ kind: x.todas[0].docKind, id: x.todas[0].docId })), [filas]));
  const comprobante = (r: RetencionPracticada) => () => {
    puerta.verComprobante(r).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante.', 'error'));
  };

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
      <div className="lista-sis v8-realizadas" style={COLUMNAS}>
        <div className="fila-sis cab"><span>OC o compra</span><span>Proveedor</span><span>Factura</span><span>Retenciones</span><span /></div>
        {filas.length === 0 && (
          <div className="vacio"><p>{libro.length ? 'Ninguna factura coincide con la búsqueda o los filtros.' : 'Todavía no hay retenciones registradas.'}</p></div>
        )}
        {filas.map((x) => {
          const imprimibles = x.retenciones.filter((r) => r.direccion === 'practicada' && r.numeroComprobante && !r.anulada);
          const ivaRegistrado = x.todas.some((r) => r.direccion === 'practicada' && r.tipo === 'iva' && !r.anulada);
          return (
            <div key={x.clave} className="fila-sis">
              <span data-l="OC o compra" className="mono">{x.docCodigo ?? '—'}</span>
              <span data-l="Proveedor">{x.contraparteNombre ?? '—'}<small>{textoDireccion(x)}</small></span>
              <span data-l="Factura">{x.facturaNumero ?? '—'}<small>{fechaVe(x.fecha)}</small></span>
              <span data-l="Retenciones">
                {x.retenciones.map((r) => (
                  <span key={r.id} className="v8-ret-linea">
                    {nombreImpuesto(r.tipo)} · {money(r.montoRetenido, r.moneda)} · N° {r.numeroComprobante ?? 'sin número'}{' '}
                    <span className={`pill ${ESTADO_CLASE[estadoDe(r)]}`}>{textoEstadoEnFactura(r, x.todas)}</span>
                    <span className="v8-ret-acc"><AccionesRetencion r={r} onAnular={onAnular} onAdjuntar={onAdjuntar} corto sinComprobante /></span>
                    <small>{quienYCuando(r)}</small>
                  </span>
                ))}
              </span>
              <span className="acc">
                {imprimibles.map((r) => (
                  <button key={r.id} type="button" className="mini" aria-label={`Comprobante N° ${r.numeroComprobante}`} onClick={comprobante(r)}>
                    🖨 {nombreImpuesto(r.tipo)}
                  </button>
                ))}
                {import.meta.env.DEV && ivaRegistrado && x.direccion === 'practicada' && (
                  <button type="button" className="mini rv8-requiere-base" disabled title={MARCA_BASE} aria-label={`+ Nota de crédito (${MARCA_BASE})`}>+ Nota de crédito</button>
                )}
                {archivos && <BotonFactura archivos={archivos.get(`${x.todas[0].docKind}:${x.todas[0].docId}`)} nombre={x.facturaNumero ?? ''} />}
                {onVerAgrupada && <button type="button" className="mini" onClick={() => onVerAgrupada(x)}>Ver en vista agrupada</button>}
              </span>
            </div>
          );
        })}
        <Paginador total={facturas.length} pagina={pag} tamano={tamano} unidad="factura(s)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </>
  );
}
