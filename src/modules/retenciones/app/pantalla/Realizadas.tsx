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
   local, desactivado y con su marca. «Registrar <IMP> de nuevo» (v8AccionRehacer)
   aparece en la anulada sin reemplazo si la raíz pasa su acción. «Imprimir
   lista» y el filtro «Origen» esperan a sus datos y no se muestran.
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
  ESTADO_CLASE, FILTRO_INICIAL, ORDENES_LISTA, estadoDe, facturasRealizadas, fechaVe, opcionesLibro, opcionesRealizadas, textoDireccion, textoEstadoEnFactura,
  type FacturaRealizada, type FiltroLibro, type OrdenLista,
} from './realizadasYLibro';
import { quienYCuando } from './quien';
import { puedeRegistrarDeNuevo } from './registrarDeNuevo';
import { useArchivosFactura } from './useArchivosFactura';
import { useVistaComprobante } from '../impresion/useVistaComprobante';
import { EjemploImpresion } from '../impresion/EjemploImpresion';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { NotaCreditoDialogo } from './NotaCreditoDialogo';
import { puedeNotaCredito } from './notaCredito';
import { BarraImprimirLista } from './BarraImprimirLista';
import { SaltoDirecto } from './SaltoDirecto';
import './rv8-por-realizar.css';

/** Las columnas de la maqueta (listaSis de v7PintarHechas). */
const COLUMNAS = { '--cols': '1fr 1.5fr 1fr 3.2fr 1.4fr' } as CSSProperties;

export function Realizadas({ libro, onAnular, onAdjuntar, onVerAgrupada, onRegistrarDeNuevo }: {
  libro: RetencionPracticada[];
  onAnular?: (r: RetencionPracticada) => void;
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** Lleva la factura a la Vista agrupada. Sin ella, el botón no se muestra. */
  onVerAgrupada?: (factura: FacturaRealizada) => void;
  /** «Registrar <IMP> de nuevo» en una anulada sin reemplazo. Sin ella, el botón no se muestra. */
  onRegistrarDeNuevo?: (r: RetencionPracticada) => void;
}) {
  const [f, setF] = useState<FiltroLibro>(FILTRO_INICIAL);
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const opciones = useMemo(() => opcionesRealizadas(libro), [libro]);
  const facturas = useMemo(() => facturasRealizadas(libro, f), [libro, f]);
  const { filas, pagina: pag } = paginar(facturas, pagina, tamano);
  const cambiar = (x: Partial<FiltroLibro>) => { setF((v) => ({ ...v, ...x })); setPagina(1); };
  const archivos = useArchivosFactura(useMemo(() => filas.map((x) => ({ kind: x.todas[0].docKind, id: x.todas[0].docId })), [filas]));
  const hoja = useVistaComprobante(libro);
  const [nota, setNota] = useState<RetencionPracticada | null>(null);
  const comprobante = (r: RetencionPracticada) => () => {
    hoja.abrir(r).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el comprobante.', 'error'));
  };
  const puerta = usePuerta();
  // El salto directo: la practicada abre su comprobante; la de un cliente, su PDF
  const abrir = (r: RetencionPracticada) => {
    if (r.direccion === 'practicada') { comprobante(r)(); return; }
    puerta.verArchivo(r).catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo abrir el comprobante.', 'error'));
  };
  const visibles = useMemo(() => facturas.flatMap((x) => x.retenciones), [facturas]);

  return (
    <>
      <BarraLista
        q={f.q} placeholder="Buscar por N° de comprobante, proveedor, RIF, factura u OC" resultados={facturas.length} unidad="factura(s)"
        filtros={[
          { campo: 'impuesto', etiqueta: 'Impuesto', valor: f.impuesto, opciones: opciones.impuesto },
          { campo: 'mes', etiqueta: 'Mes', valor: f.mes, opciones: opciones.mes },
          { campo: 'estado', etiqueta: 'Estado', valor: f.estado, opciones: opciones.estado },
        ]}
        orden={{ valor: f.orden, opciones: ORDENES_LISTA }}
        onQ={(q) => cambiar({ q })}
        onFiltro={(campo, valor) => cambiar({ [campo]: valor } as Partial<FiltroLibro>)}
        onOrden={(v) => cambiar({ orden: v as OrdenLista })}
        onQuitar={() => cambiar({ q: '', impuesto: '', mes: '', estado: '' })}
      />
      <SaltoDirecto q={f.q} retenciones={libro} onAbrir={abrir} />
      <BarraImprimirLista filas={visibles} />
      <EjemploImpresion />
      <div className="lista-sis v8-realizadas" style={COLUMNAS}>
        <div className="fila-sis cab"><span>OC o compra</span><span>Proveedor</span><span>Factura</span><span>Retenciones</span><span /></div>
        {filas.length === 0 && (
          <div className="vacio"><p>{libro.length ? 'Ninguna factura coincide con la búsqueda o los filtros.' : 'Todavía no hay retenciones registradas.'}</p></div>
        )}
        {filas.map((x) => {
          const imprimibles = x.retenciones.filter((r) => r.direccion === 'practicada' && r.numeroComprobante);
          const ivaNc = x.todas.find(puedeNotaCredito);
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
                    <span className="v8-ret-acc">
                      <AccionesRetencion r={r} onAnular={onAnular} onAdjuntar={onAdjuntar} corto sinComprobante />
                      {onRegistrarDeNuevo && puedeRegistrarDeNuevo(r, x.todas) && (
                        <button type="button" className="mini registrar" onClick={() => onRegistrarDeNuevo(r)}>Registrar {nombreImpuesto(r.tipo)} de nuevo</button>
                      )}
                    </span>
                    <small>{quienYCuando(r)}</small>
                  </span>
                ))}
              </span>
              <span className="acc">
                {imprimibles.map((r) => (
                  <button key={r.id} type="button" className={`mini ${r.anulada ? 'anulada' : ''}`}
                    aria-label={`${r.anulada ? 'Ver la anulada' : 'Comprobante'} N° ${r.numeroComprobante}`}
                    onClick={comprobante(r)}>
                    {r.anulada ? `Ver anulada ${nombreImpuesto(r.tipo)}` : `🖨 ${nombreImpuesto(r.tipo)}`}
                  </button>
                ))}
                {import.meta.env.DEV && ivaNc && (
                  <span className="rv8-con-marca"><button type="button" className="mini" onClick={() => setNota(ivaNc)}>+ Nota de crédito</button><MarcaPaquete21 /></span>
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
      {hoja.vista}
      {nota && <NotaCreditoDialogo factura={nota} onCerrar={() => setNota(null)} />}
    </>
  );
}
