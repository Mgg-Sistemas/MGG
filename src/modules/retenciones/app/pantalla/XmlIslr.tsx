/* ============================================================
   MGG · Retenciones v8 · «⬇ XML de ISLR» (botón y diálogo)

   Genera el archivo XML oficial para la declaración informativa de
   retenciones de ISLR ante el portal del SENIAT (Decreto 1.808).
   Muestra el período mensual, nombre de archivo, resumen de retenciones,
   validaciones pendientes y descarga en formato XML (ISO-8859-1).
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { periodosXml, prepararXmlIslr } from './xmlDelLibro';
import './rv8-txt.css';

export function BotonXmlIslr({ libro }: { libro: readonly RetencionPracticada[] }) {
  const [abierto, setAbierto] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setAbierto(true)}>
        ⬇ XML de ISLR
      </button>
      {abierto && <DialogoXmlIslr libro={libro} onCerrar={() => setAbierto(false)} />}
    </>
  );
}

export function DialogoXmlIslr({
  libro,
  onCerrar,
  periodoInicial,
}: {
  libro: readonly RetencionPracticada[];
  onCerrar: () => void;
  periodoInicial?: string;
}) {
  const puerta = usePuerta();
  const [empresa, setEmpresa] = useState<{ rif: string; razon: string } | null>(null);
  const periodos = useMemo(() => periodosXml(libro), [libro]);
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState(
    () => (periodoInicial && periodos.some((x) => x.periodo === periodoInicial)
      ? periodoInicial
      : periodos[0]?.periodo ?? '')
  );

  useEffect(() => {
    let vivo = true;
    puerta
      .config()
      .then((c) => {
        if (vivo) setEmpresa({ rif: c.rif ?? '', razon: c.razonSocial ?? '' });
      })
      .catch((e: unknown) =>
        toast(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.', 'error')
      );
    return () => {
      vivo = false;
    };
  }, [puerta]);

  const p = periodos.find((x) => x.periodo === periodoSeleccionado);
  const resultado =
    p && empresa
      ? prepararXmlIslr(libro, p.periodo, { rif: empresa.rif, razonSocial: empresa.razon })
      : null;

  const descargar = () => {
    if (!resultado) return;
    const blob = new Blob([resultado.contenido], { type: 'application/xml;charset=iso-8859-1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultado.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`XML descargado: ${resultado.nombre}.`, 'success');
  };

  const footer = (
    <>
      <span className="rv8-txt-huella">
        Codificación ISO-8859-1, estructura oficial SENIAT según Decreto 1.808.
      </span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        Cerrar
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={!resultado || resultado.faltan.length > 0}
        onClick={descargar}
      >
        Descargar XML
      </button>
    </>
  );

  return (
    <Modal title="XML de ISLR para el portal SENIAT" size="lg" onClose={onCerrar} footer={footer}>
      {!periodos.length ? (
        <p className="rv8-txt-huella">No hay retenciones de ISLR practicadas en el libro.</p>
      ) : (
        <>
          <label className="rv8-txt-campo">
            <span>Período fiscal (Mes)</span>
            <select
              className="select"
              value={periodoSeleccionado}
              onChange={(e) => setPeriodoSeleccionado(e.target.value)}
            >
              {periodos.map((x) => (
                <option key={x.periodo} value={x.periodo}>
                  {x.texto}
                </option>
              ))}
            </select>
          </label>

          {resultado && (
            <>
              <p className="rv8-txt-sub">
                ISLR · {p?.texto} ·{' '}
                {resultado.lineas === 0
                  ? 'sin operaciones'
                  : `${resultado.lineas} retención(es)`}
              </p>
              <p className="rv8-txt-huella">
                Archivo: <b className="mono">{resultado.nombre}</b>
              </p>

              {resultado.faltan.length > 0 && (
                <div className="rv8-txt-falta" role="alert">
                  <p><b>Observaciones antes de descargar:</b></p>
                  <ul>
                    {resultado.faltan.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="rv8-txt-huella">
                Vista previa del archivo XML generado:
              </p>
              <pre className="rv8-txt-previa" aria-label="Vista previa del XML">
                {resultado.contenido}
              </pre>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
