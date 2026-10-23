/* ============================================================
   MGG · Retenciones v8 · «⬇ TXT del IVA» (botón y diálogo)

   El dlg-txt de la maqueta (v7-4-pantallas.js, R2-11): el período, el nombre
   del archivo, «Período como el otro sistema», la vista previa de las líneas
   (⇥ = tabulador), las 16 columnas y «Descargar TXT». Las líneas, de
   logica/txtIva.ts.
   Solo en local, con su marca propia: el formato está sin cotejar con un TXT
   real hasta que el usuario lo valide con el portal. «Período como el otro
   sistema» arranca con el interruptor retenciones.txt_iva.periodo_como_otro_sistema
   (BD, v8p-06; sin la fila, apagado); cambiarlo aquí no lo guarda.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { COLUMNAS_TXT, lineasTxtIva, nombreTxt, textoTxt } from '../logica/txtIva';
import { interruptorEncendido } from '../datos/interruptores';

/** El interruptor «Período como el otro sistema» (BD, v8p-06). */
export const INTERRUPTOR_PERIODO_TXT = 'retenciones.txt_iva.periodo_como_otro_sistema';
import { MARCA_SIN_COTEJAR, filasTxtDe, periodosTxt, sinTasaTxt, vistaPreviaTxt } from './txtDelLibro';
import './rv8-txt.css';

export function MarcaSinCotejar() {
  return <span className="rv8-marca21 rv8-marca-cotejar" title={MARCA_SIN_COTEJAR} aria-label={MARCA_SIN_COTEJAR}>sin cotejar</span>;
}

export function BotonTxtIva({ libro }: { libro: readonly RetencionPracticada[] }) {
  const [abierto, setAbierto] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <>
      <span className="rv8-con-marca">
        <button type="button" className="btn btn-ghost" onClick={() => setAbierto(true)}>⬇ TXT del IVA</button><MarcaSinCotejar />
      </span>
      {abierto && <DialogoTxt libro={libro} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

function DialogoTxt({ libro, onCerrar }: { libro: readonly RetencionPracticada[]; onCerrar: () => void }) {
  const puerta = usePuerta();
  const [empresa, setEmpresa] = useState<{ rif: string; razon: string } | null>(null);
  const periodos = useMemo(() => periodosTxt(libro), [libro]);
  const [clave, setClave] = useState(periodos[0]?.clave ?? '');
  const [comoOtro, setComoOtro] = useState(false);

  useEffect(() => {
    let vivo = true;
    // El interruptor de la base (v8p-06); sin la fila, apagado: el mes del período, como dice el instructivo
    void interruptorEncendido(INTERRUPTOR_PERIODO_TXT).then((v) => { if (vivo) setComoOtro(v); });
    puerta.config()
      .then((c) => { if (vivo) setEmpresa({ rif: c.rif ?? '', razon: c.razonSocial ?? '' }); })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.', 'error'));
    return () => { vivo = false; };
  }, [puerta]);

  const p = periodos.find((x) => x.clave === clave);
  const lineas = p && empresa ? lineasTxtIva(p, empresa.rif, filasTxtDe(libro, p), { periodoComoOtroSistema: comoOtro }) : [];
  const vacio = lineas.length === 1 && lineas[0][2] === '0';
  const sinTasa = p ? sinTasaTxt(libro, p) : 0;
  const falta = !empresa?.rif ? 'Falta el RIF de la empresa en ⚙ Parámetros › Datos de la empresa.' : sinTasa ? `${sinTasa} retención(es) en $ sin tasa: no se pueden pasar a Bs.` : null;
  const nombre = p && empresa ? nombreTxt(empresa.razon, p.periodo) : '';

  const descargar = () => {
    const url = URL.createObjectURL(new Blob([textoTxt(lineas)], { type: 'text/plain;charset=us-ascii' }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`TXT descargado: ${nombre}.`, 'success');
  };

  const footer = (
    <>
      <span className="rv8-txt-huella">ASCII, campos separados por tabulador (⇥), un tabulador al final de cada línea y fin de línea CRLF.</span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
      <button type="button" className="btn btn-primary" disabled={!lineas.length || !!falta} onClick={descargar}>Descargar TXT</button>
    </>
  );

  return (
    <Modal title="TXT del IVA para el portal" size="lg" onClose={onCerrar} footer={footer}>
      <p className="rv8-txt-aviso" role="note"><MarcaSinCotejar /> {MARCA_SIN_COTEJAR}</p>
      {!periodos.length ? <p className="rv8-txt-huella">No hay retenciones de IVA practicadas en el libro.</p> : (
        <>
          <label className="rv8-txt-campo"><span>Período</span>
            <select className="select" value={clave} onChange={(e) => setClave(e.target.value)}>
              {periodos.map((x) => <option key={x.clave} value={x.clave}>{x.texto}</option>)}
            </select>
          </label>
          {p && <p className="rv8-txt-sub">IVA · {p.texto} · {vacio ? 'sin operaciones: una línea con RIF, período y 14 ceros' : `${lineas.length} línea(s)`}</p>}
          {nombre && <p className="rv8-txt-huella">Archivo: <b className="mono">{nombre}</b> (el patrón de los archivos del otro sistema).</p>}
          <label className="rv8-txt-interruptor">
            <input type="checkbox" checked={comoOtro} onChange={(e) => setComoOtro(e.target.checked)} />
            <span>Período como el otro sistema
              <small>{comoOtro
                ? `Encendido: el campo 2 lleva el mes siguiente al período (${lineas[0]?.[1] ?? '—'}), como los archivos del otro sistema.`
                : `Apagado: el campo 2 lleva el mes del período declarado (${p?.periodo ?? '—'}), como dice el instructivo. Encendido, llevaría el mes siguiente.`}
                {' '}Arranca con el valor del interruptor; aquí solo cambia este archivo.</small>
            </span>
          </label>
          {falta && <p className="rv8-txt-falta" role="alert">{falta}</p>}
          <p className="rv8-txt-huella">El monto del documento es base + IVA y el exento va en 0: la retención no guarda el total de la factura.</p>
          <pre className="rv8-txt-previa" aria-label="Vista previa de las líneas">{vistaPreviaTxt(lineas, true)}</pre>
          <details><summary className="muted">Las 16 columnas</summary>
            <ol className="rv8-txt-cols">{COLUMNAS_TXT.map((c) => <li key={c}>{c}{c === 'N° de expediente' ? ' (va en «0»)' : ''}</li>)}</ol>
          </details>
        </>
      )}
    </Modal>
  );
}
