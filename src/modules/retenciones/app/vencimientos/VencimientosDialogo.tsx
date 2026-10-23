/* ============================================================
   MGG · Retenciones v8 · El diálogo Vencimientos

   Traslado de `dlg-vencimientos` y `pintarVencimientos` (maqueta v8,
   l. 5456-5475): los umbrales, y los grupos Vencido y Por vencer
   (abiertos) y Al día (plegado), 25 por grupo, los más próximos primero;
   cada fila lleva a su ficha («Ver el período»). Los avisos no bloquean
   nada. Las licencias y las actividades esperan sus fechas en la base: en
   local, una línea marcada con «2.1».
   ============================================================ */

import { Modal } from '@/shared/ui/Modal';
import { nf } from '../listas/paginador';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import type { Umbrales } from '../datos/vencimientos';
import { textoFicha, textoVence, type Ficha, type GrupoVenc, type Vencimiento } from './modeloVencimientos';
import './rv8-vencimientos.css';

const TAM = 25;

export function VencimientosDialogo({ xs, umbrales: u, conLicencias, onFicha, onCerrar }: {
  xs: Vencimiento[]; umbrales: Umbrales;
  /** false = la base todavía no tiene licencias ni actividades con fecha (solo las declaraciones). */
  conLicencias: boolean;
  onFicha: (f: Ficha) => void;
  onCerrar: () => void;
}) {
  const grupo = (titulo: string, g: GrupoVenc, abierto: boolean) => {
    const ys = xs.filter((x) => x.grupo === g);
    return (
      <details className={`rv8-v7-venc-grupo rv8-${g}`} open={abierto}>
        <summary><b>{titulo}</b> · {nf(ys.length)}</summary>
        <div className="rv8-lista-mini">
          {ys.length ? ys.slice(0, TAM).map((x, i) => (
            <div key={`${x.que}-${i}`} className={`rv8-fila rv8-v7-venc-fila rv8-${x.grupo}${x.pronto ? ' rv8-pronto' : ''}`}>
              <span><b>{x.que}</b><small>{textoVence(x)}</small></span>
              <button type="button" className="rv8-mini" onClick={() => onFicha(x.ficha)}>{textoFicha(x.ficha)}</button>
            </div>
          )) : <p className="rv8-huella">Nada.</p>}
        </div>
        {ys.length > TAM && <p className="rv8-huella">Se muestran {TAM} de {nf(ys.length)}, los más próximos primero.</p>}
      </details>
    );
  };
  return (
    <Modal title="Vencimientos" size="lg" onClose={onCerrar} footer={<button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>}>
      <div className="rv8-vencimientos">
        <p className="rv8-huella">Licencias, declaraciones y actividades con fecha «hasta». Los avisos no bloquean nada.</p>
        <p className="rv8-huella">Umbrales: licencias {u.licencias} y {u.licenciasPronto} días; declaraciones {u.declaraciones} días; actividades {u.actividades} días.</p>
        {!conLicencias && import.meta.env.DEV && (
          <p className="rv8-huella">Licencias de la empresa y de los proveedores, y actividades con fecha «hasta»: esperan sus fechas en la base. <MarcaPaquete21 /></p>
        )}
        {grupo('Vencido', 'vencido', true)}
        {grupo('Por vencer', 'por_vencer', true)}
        {grupo('Al día', 'al_dia', false)}
      </div>
    </Modal>
  );
}
