/* ============================================================
   MGG · Retenciones v8 · Pendientes de impresión y entrega

   El botón de la cabecera y su diálogo, como en la maqueta (v6: el botón
   #v6-pend-imp con su cuenta; v8-3-listas.js, abrirPendientesImpresion: la
   barra con Impuesto, Motivo y Período, el orden, la huella, las filas con
   «🖨 Comprobante» y las páginas).
   Lo que dice si un comprobante se imprimió y se entregó vive en la base de
   Retenciones (paquete 04: retencion_impresiones y las columnas impresa_*).
   Hasta que exista, el botón no aparece en producción; en local se ve con su
   estructura, la lista vacía y la marca 2.1.
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { Modal } from '@/shared/ui/Modal';
import { opcionesConConteo } from '../listas/filtros';
import { paginar, TAMANO_PAGINA_INICIAL } from '../listas/paginador';
import { BarraLista } from '../pantalla/BarraLista';
import { Paginador } from '../pantalla/Paginador';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { fechaVe } from './numeros';
import {
  HUELLA_IMPRESION, MOTIVO_IMPRESION, ORDENES_IMPRESION, SIN_RESULTADOS, VACIO_IMPRESION,
  basePendientes, filtrarPendientesImpresion, mesesDeFacturas, pasaImpresion, pendientesImpresion, textoMotivo,
  type FiltrosImpresion, type OrdenImpresion, type RetencionImpresion,
} from './listaPendientesImpresion';
import './rv8-pendientes-impresion.css';

const INICIALES: FiltrosImpresion = { q: '', impuesto: '', motivo: '', mes: '', orden: 'antiguo' };

interface Props {
  /** Los comprobantes con sus datos de impresión. Hasta el paquete 04 no hay de dónde leerlos: vacío. */
  retenciones?: RetencionImpresion[];
  /** «🖨 Comprobante»: abre la vista previa del comprobante encima del diálogo. */
  onComprobante?: (id: string) => void;
}

/** El botón de la cabecera, con la cuenta de pendientes. Solo en local mientras falte la base. */
export function BotonPendientesImpresion({ retenciones = [], onComprobante }: Props) {
  const [abierto, setAbierto] = useState(false);
  const n = useMemo(() => pendientesImpresion(retenciones).length, [retenciones]);
  if (!import.meta.env.DEV) return null;
  return (
    <>
      <span className="rv8-con-marca">
        <button type="button" className="btn btn-ghost rv8-chip-impresion" onClick={() => setAbierto(true)}>
          Pendientes de impresión y entrega <span className="rv8-badge-alerta">{n}</span>
        </button>
        <MarcaPaquete21 />
      </span>
      {abierto && <PendientesImpresion retenciones={retenciones} onComprobante={onComprobante} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

export function PendientesImpresion({ retenciones = [], onComprobante, onCerrar }: Props & { onCerrar: () => void }) {
  const [f, setF] = useState<FiltrosImpresion>(INICIALES);
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState<number>(TAMANO_PAGINA_INICIAL);
  const cambiar = (c: Partial<FiltrosImpresion>) => { setF((x) => ({ ...x, ...c })); setPagina(1); };

  const todos = useMemo(() => pendientesImpresion(retenciones), [retenciones]);
  const xs = useMemo(() => filtrarPendientesImpresion(retenciones, f), [retenciones, f]);
  const opciones = useMemo(() => {
    const base = basePendientes(retenciones, f.q);
    const puestos = [{ campo: 'impuesto', valor: f.impuesto }, { campo: 'motivo', valor: f.motivo }, { campo: 'mes', valor: f.mes ?? '' }];
    const impuestos = [...new Set(base.map((x) => x.r.tipo))].map((k) => [k, nombreImpuesto(k)] as const);
    return {
      impuesto: opcionesConConteo(base, puestos, 'impuesto', impuestos, pasaImpresion, true),
      motivo: opcionesConConteo(base, puestos, 'motivo', Object.entries(MOTIVO_IMPRESION), pasaImpresion),
      mes: opcionesConConteo(base, puestos, 'mes', mesesDeFacturas(base.map((x) => x.r.fecha)), pasaImpresion),
    };
  }, [retenciones, f]);
  const vista = paginar(xs, pagina, tamano);

  return (
    <Modal title="Pendientes de impresión y entrega" size="xl" onClose={onCerrar}>
      <BarraLista
        q={f.q} placeholder="Buscar por N° de comprobante, proveedor, RIF, factura u OC" resultados={xs.length} unidad="comprobante(s)"
        filtros={[
          { campo: 'impuesto', etiqueta: 'Impuesto', valor: f.impuesto, opciones: opciones.impuesto },
          { campo: 'motivo', etiqueta: 'Motivo', valor: f.motivo, opciones: opciones.motivo },
          { campo: 'mes', etiqueta: 'Período (mes de la factura)', valor: f.mes ?? '', opciones: opciones.mes },
        ]}
        orden={{ valor: f.orden, opciones: ORDENES_IMPRESION.map(([valor, texto]) => ({ valor, texto })) }}
        onQ={(q) => cambiar({ q })}
        onFiltro={(campo, valor) => cambiar({ [campo]: valor } as Partial<FiltrosImpresion>)}
        onOrden={(v) => cambiar({ orden: v as OrdenImpresion })}
        onQuitar={() => cambiar({ q: '', impuesto: '', motivo: '', mes: '' })}
      />
      <p className="rv8-huella">{HUELLA_IMPRESION}</p>
      <div className="rv8-lista-imp">
        {vista.filas.map(({ r, motivo }) => (
          <div key={r.id} className="rv8-fila-imp">
            <span className="rv8-fila-txt">
              <b className="mono">{r.numero}</b> · {nombreImpuesto(r.tipo)} · {r.proveedor} · {fechaVe(r.fecha)} · {money(r.monto)}
              <small className={`rv8-motivo m-${motivo}`}>{textoMotivo({ r, motivo }, fechaVe)}</small>
            </span>
            <span className="rv8-fila-acc">
              <button type="button" className="mini" disabled={!onComprobante} onClick={() => onComprobante?.(r.id)}>🖨 Comprobante</button>
            </span>
          </div>
        ))}
        {!vista.filas.length && (
          <p className="rv8-huella">{todos.length ? SIN_RESULTADOS : <>{VACIO_IMPRESION} <MarcaPaquete21 /></>}</p>
        )}
        <Paginador total={xs.length} pagina={vista.pagina} tamano={tamano} unidad="comprobante(s)"
          onPagina={setPagina} onTamano={(t) => { setTamano(t); setPagina(1); }} />
      </div>
    </Modal>
  );
}
