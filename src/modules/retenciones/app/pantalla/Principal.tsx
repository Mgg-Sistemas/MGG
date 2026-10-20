/* ============================================================
   MGG · Retenciones v8 · Pantalla principal

   Traslado de la maqueta v8 (35cbb02b): la cabecera con su descripción
   por pestaña, la fila de accesos y las pestañas de siempre (Por realizar,
   Realizadas y Libro fiscal). Lo que depende de datos que la base aún no
   tiene no se muestra: la tira «Período en curso», los chips de
   Vencimientos, Otro sistema e Impresión, y las pestañas Períodos y
   Reportes (capacidades de la puerta en false). La Vista agrupada, en
   agrupada/VistaAgrupada.tsx.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePuerta, type ConceptoRetencion, type ConfigRetencion, type RetencionItem, type RetencionPracticada } from '../datos/puerta';
import { documentosPendientes, impuestosQueAplican } from './pendientesPorDocumento';
import { LibroFiscalV8 } from './LibroFiscalV8';
import { PorRealizar } from './PorRealizar';
import { Realizadas } from './Realizadas';
import { VistaAgrupada } from '../agrupada/VistaAgrupada';
import { impuestosActivos } from '../agrupada/modeloAgrupada';
import { CabeceraLocal, PeriodoEnCurso } from './CabeceraLocal';
import './principal.css';
import './rv8-principal.css';

type Seccion = 'pendientes' | 'hechas' | 'libro' | 'agrupada';

const DESCRIPCION: Record<Seccion, string> = {
  pendientes: 'OC y compras con retenciones pendientes de registrar.',
  agrupada: 'Cada factura con su retención por impuesto: lo pendiente, lo registrado y lo que no aplica.',
  hechas: 'Facturas con retenciones registradas y sus comprobantes.',
  libro: 'Libro fiscal: una fila por retención.',
};

interface Props {
  /** Abre ⚙ Parámetros. Sin ella, el acceso no se muestra. */
  onParametros?: () => void;
  /** Abre el registro de una retención. Sin ella, los botones «Registrar» no se muestran. */
  onRegistrar?: (item: RetencionItem, impuesto: string) => void;
  /** Anula una retención del libro. Sin ella, «Anular» no se muestra. */
  onAnular?: (r: RetencionPracticada) => void;
  /** Adjunta el archivo a una retención. Sin ella, «Adjuntar» no se muestra. */
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** Registra una retención de un cliente. Sin ella, el botón del Libro no se muestra. */
  onRegistrarRecibida?: () => void;
}

interface Datos { pendientes: RetencionItem[]; libro: RetencionPracticada[]; config: ConfigRetencion; conceptos: ConceptoRetencion[] }

export function Principal({ onParametros, onRegistrar, onAnular, onAdjuntar, onRegistrarRecibida }: Props) {
  const puerta = usePuerta();
  const [sec, setSec] = useState<Seccion>('pendientes');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    setError(null);
    Promise.all([puerta.pendientes(), puerta.libro(), puerta.config(), puerta.conceptos(true)])
      .then(([pendientes, libro, config, conceptos]) => setDatos({ pendientes, libro, config, conceptos }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron leer las retenciones.'));
  }, [puerta]);
  useEffect(() => { cargar(); }, [cargar]);

  const impuestos = useMemo(() => (datos ? impuestosActivos(datos.config, datos.conceptos, datos.libro) : []), [datos]);
  const docs = useMemo(
    () => (datos ? documentosPendientes(datos.pendientes, datos.libro, (it) => impuestosQueAplican(it, datos.config, datos.conceptos)) : []),
    [datos],
  );

  return (
    <main className="page ret-v8">
      <header className="page-head">
        <div>
          <h1>🧾 Retenciones</h1>
          <p>{DESCRIPCION[sec]}</p>
        </div>
        <div className="cabeza-acciones">
          {import.meta.env.DEV && datos && <CabeceraLocal impuestos={impuestos} />}
          {onParametros && <button type="button" className="btn btn-ghost" onClick={onParametros}>⚙ Parámetros</button>}
          <nav className="view-toggle" aria-label="Pantallas del módulo">
            <button type="button" aria-current={sec === 'pendientes' ? 'page' : undefined} onClick={() => setSec('pendientes')}>
              Por realizar{datos ? ` (${docs.length})` : ''}
            </button>
            <button type="button" aria-current={sec === 'hechas' ? 'page' : undefined} onClick={() => setSec('hechas')}>Realizadas</button>
            <button type="button" aria-current={sec === 'libro' ? 'page' : undefined} onClick={() => setSec('libro')}>📒 Libro fiscal</button>
            <button type="button" aria-current={sec === 'agrupada' ? 'page' : undefined} onClick={() => setSec('agrupada')}>Vista agrupada</button>
            {/* Períodos y Reportes esperan a la base de Retenciones: solo en local, deshabilitados. */}
            {import.meta.env.DEV && <button type="button" disabled title="Requiere la base de Retenciones (paquete 2.1)">Períodos <span className="rv8-badge-n" /></button>}
            {import.meta.env.DEV && <button type="button" disabled title="Requiere la base de Retenciones (paquete 2.1)">Reportes</button>}
          </nav>
        </div>
      </header>

      {error && (
        <div className="aviso-error" role="alert">
          No se pudieron leer las retenciones: {error} <button type="button" className="mini" onClick={cargar}>Reintentar</button>
        </div>
      )}
      {!error && !datos && <p className="muted" role="status">Cargando…</p>}

      {import.meta.env.DEV && datos && <PeriodoEnCurso impuestos={impuestos} />}

      {datos && sec === 'pendientes' && <PorRealizar docs={docs} onRegistrar={onRegistrar} />}

      {datos && sec === 'agrupada' && (
        <VistaAgrupada pendientes={datos.pendientes} libro={datos.libro} config={datos.config} conceptos={datos.conceptos}
          onRegistrar={onRegistrar} onAnular={onAnular} onAdjuntar={onAdjuntar} />
      )}

      {datos && sec === 'hechas' && <Realizadas libro={datos.libro} onAnular={onAnular} onAdjuntar={onAdjuntar} />}

      {datos && sec === 'libro' && <LibroFiscalV8 libro={datos.libro} onAnular={onAnular} onAdjuntar={onAdjuntar} onRegistrarRecibida={onRegistrarRecibida} />}
    </main>
  );
}
