/* ============================================================
   MGG · Retenciones v8 · Pantalla principal

   Traslado de la maqueta v8 (35cbb02b): la cabecera con su descripción
   por pestaña, la fila de accesos y las pestañas de siempre (Por realizar,
   Realizadas, Libro fiscal, Vista agrupada, Períodos y Reportes). Lo que
   depende de la base de Retenciones (paquete 2.1) solo sale en local,
   deshabilitado y marcado: la tira «Período en curso» y los botones de
   Vencimientos, Otro sistema e Impresión. Períodos se muestra en
   producción cuando la base tiene los períodos (retencion_periodos_v).
   ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePuerta, type ConceptoRetencion, type ConfigRetencion, type RetencionItem, type RetencionPracticada } from '../datos/puerta';
import { documentosPendientes, impuestosQueAplican } from './pendientesPorDocumento';
import { LibroFiscalV8 } from './LibroFiscalV8';
import { PorRealizar } from './PorRealizar';
import { Realizadas } from './Realizadas';
import { documentoParaRegistrar, semillaDeAnulada, type SemillaRegistro } from './registrarDeNuevo';
import type { FacturaRealizada } from './realizadasYLibro';
import { AvisoRegimen } from '../parametros/AvisoRegimen';
import type { Foco } from '../agrupada/VistaAgrupada';
import { VistaAgrupada } from '../agrupada/VistaAgrupada';
import { Periodos } from '../periodos/Periodos';
import { avisosPeriodos } from '../periodos/modeloPeriodos';
import type { Declaracion, PasoInicial, PeriodoRetencion } from '../datos/periodos';
import { Reportes } from './reportes/Reportes';
import { impuestosActivos } from '../agrupada/modeloAgrupada';
import { BotonVencimientos, CabeceraLocal, PeriodoEnCurso } from './CabeceraLocal';
import { UMBRALES_DEFECTO, type AvisoVencimiento, type Umbrales } from '../datos/vencimientos';
import { resumenVencimientos, vencimientos, type Ficha } from '../vencimientos/modeloVencimientos';
import { VencimientosDialogo } from '../vencimientos/VencimientosDialogo';
import { PerfilFiscal } from '../perfil/PerfilFiscal';
import type { ProveedorPerfil } from '../perfil/PerfilProveedorDialogo';
import type { EstadoFila } from '../periodos/modeloPeriodos';
import './principal.css';
import './rv8-principal.css';

type Seccion = 'pendientes' | 'hechas' | 'libro' | 'agrupada' | 'periodos' | 'reportes';

const DESCRIPCION: Record<Seccion, string> = {
  pendientes: 'OC y compras con retenciones pendientes de registrar.',
  agrupada: 'Cada factura con su retención por impuesto: lo pendiente, lo registrado y lo que no aplica.',
  hechas: 'Facturas con retenciones registradas y sus comprobantes.',
  libro: 'Libro fiscal: una fila por retención.',
  periodos: 'Períodos de declaración por impuesto: lo que vence, lo declarado y lo reabierto.',
  reportes: 'Reportes del libro, con filtros, agrupación y columnas.',
};

interface Props {
  /** Abre ⚙ Parámetros. Sin ella, el acceso no se muestra. */
  onParametros?: () => void;
  /** Abre el registro de una retención (con la semilla de una anulada, en «Registrar de nuevo»). Sin ella, los botones «Registrar» no se muestran. */
  onRegistrar?: (item: RetencionItem, impuesto: string, semilla?: SemillaRegistro) => void;
  /** Abre el detalle de la OC o de la compra directa. Sin ella, «Ver OC» no se muestra. */
  onVerOc?: (item: RetencionItem) => void;
  /** Marca un período como declarado y lo reabre. Sin ellas, los botones de Períodos no se muestran. */
  onDeclararPeriodo?: (p: PeriodoRetencion, d: Declaracion) => Promise<void>;
  onReabrirPeriodo?: (p: PeriodoRetencion, motivo: string) => Promise<void>;
  /** Guarda el paso inicial de un impuesto. */
  onPasoInicial?: (k: string, p: PasoInicial) => Promise<void>;
  /** Abre Parámetros en el régimen (el aviso «Configure desde cuándo…»). */
  onConfigurarRegimen?: () => void;
  /** Anula una retención del libro. Sin ella, «Anular» no se muestra. */
  onAnular?: (r: RetencionPracticada) => void;
  /** Adjunta el archivo a una retención. Sin ella, «Adjuntar» no se muestra. */
  onAdjuntar?: (r: RetencionPracticada, archivo: File) => void;
  /** Registra una retención de un cliente. Sin ella, el botón del Libro no se muestra. */
  onRegistrarRecibida?: () => void;
}

interface Datos { pendientes: RetencionItem[]; libro: RetencionPracticada[]; config: ConfigRetencion; conceptos: ConceptoRetencion[] }

export function Principal({ onParametros, onRegistrar, onVerOc, onConfigurarRegimen, onDeclararPeriodo, onReabrirPeriodo, onPasoInicial, onAnular, onAdjuntar, onRegistrarRecibida }: Props) {
  const puerta = usePuerta();
  const [sec, setSec] = useState<Seccion>('pendientes');
  // «Ver en vista agrupada»: la Vista agrupada con solo ese documento o esa factura (`estado.foco` de la maqueta).
  const [foco, setFoco] = useState<Foco | null>(null);
  const irAgrupada = (f: Foco) => { setFoco(f); setSec('agrupada'); };
  const verDocumento = (item: RetencionItem) => irAgrupada({ etiqueta: item.ocCodigo ?? 'el documento', prueba: (f) => f.docKind === item.kind && f.docId === item.id });
  const verFactura = (x: FacturaRealizada) => {
    const ids = new Set(x.todas.map((r) => r.id));
    irAgrupada({ etiqueta: `Factura ${x.facturaNumero ?? '—'}`, prueba: (f) => Object.values(f.casillas).some((c) => !!c.retencion && ids.has(c.retencion.id)) });
  };
  const registrarDeNuevo = (r: RetencionPracticada) => {
    const it = datos && documentoParaRegistrar(r, datos.pendientes);
    if (it && onRegistrar) onRegistrar(it, r.tipo, semillaDeAnulada(r));
  };
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Períodos: null mientras la base de Retenciones no los tenga (la pestaña solo sale en local, vacía y marcada).
  const [periodos, setPeriodos] = useState<PeriodoRetencion[] | null>(null);
  const [paso, setPaso] = useState<Record<string, string | null>>({});
  const [umbrales, setUmbrales] = useState<Umbrales>(UMBRALES_DEFECTO);
  // Vencimientos: las licencias y actividades (null = la base no las tiene) y el diálogo.
  const [avisos, setAvisos] = useState<AvisoVencimiento[] | null>(null);
  const [verVenc, setVerVenc] = useState(false);
  const [perInicial, setPerInicial] = useState<{ k: string; est: '' | EstadoFila } | undefined>(undefined);
  const [perfil, setPerfil] = useState<ProveedorPerfil | null>(null);
  const cerrarPerfil = useCallback(() => setPerfil(null), []);

  const cargar = useCallback(() => {
    setError(null);
    Promise.all([puerta.pendientes(), puerta.libro(), puerta.config(), puerta.conceptos(true)])
      .then(([pendientes, libro, config, conceptos]) => setDatos({ pendientes, libro, config, conceptos }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudieron leer las retenciones.'));
  }, [puerta]);
  useEffect(() => { cargar(); }, [cargar]);

  const impuestos = useMemo(() => (datos ? impuestosActivos(datos.config, datos.conceptos, datos.libro) : []), [datos]);
  useEffect(() => {
    if (!puerta.periodos || !impuestos.length) return;
    let vivo = true;
    void puerta.periodos().then((ps) => { if (vivo) setPeriodos(ps); });
    void puerta.pasoInicial?.(impuestos).then((x) => { if (vivo) setPaso(x); });
    void puerta.umbralesAvisos?.().then((u) => { if (vivo) setUmbrales(u); });
    void puerta.avisosVencimiento?.().then((a) => { if (vivo) setAvisos(a); });
    return () => { vivo = false; };
  }, [puerta, impuestos]);
  const vencidos = periodos ? avisosPeriodos(periodos, impuestos, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' })).vencidos : 0;
  const verPeriodos = periodos != null || import.meta.env.DEV;
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
  const listaVenc = useMemo(() => (periodos ? vencimientos(periodos, avisos ?? [], impuestos, hoy, umbrales) : []), [periodos, avisos, impuestos, hoy, umbrales]);
  const rv = resumenVencimientos(listaVenc);
  // Vencimientos funciona cuando la base tiene los períodos; sin ella, solo en local, deshabilitado.
  const botonVenc = periodos != null ? <BotonVencimientos n={rv.vencido + rv.porVencer} rojo={rv.vencido > 0} onAbrir={() => setVerVenc(true)} /> : undefined;
  const irFicha = (f: Ficha) => {
    setVerVenc(false);
    if (f.tipo === 'periodo') { setPerInicial({ k: f.k, est: f.est }); setSec('periodos'); }
    else if (f.tipo === 'empresa') onParametros?.();
    else if (f.proveedorId) setPerfil({ id: f.proveedorId, razonSocial: f.nombre, rif: f.rif ?? '', direccion: null });
  };
  const docs = useMemo(
    () => (datos ? documentosPendientes(datos.pendientes, datos.libro, (it) => impuestosQueAplican(it, datos.config, datos.conceptos)) : []),
    [datos],
  );

  return (
    <main className="page ret-v8">
      {onConfigurarRegimen && <div style={{ margin: '.6rem 0' }}><AvisoRegimen onConfigurar={onConfigurarRegimen} /></div>}
      <header className="page-head">
        <div>
          <h1>🧾 Retenciones</h1>
          <p>{DESCRIPCION[sec]}</p>
        </div>
        <div className="cabeza-acciones">
          {import.meta.env.DEV ? datos && <CabeceraLocal impuestos={impuestos} vencimientos={botonVenc} /> : botonVenc}
          {onParametros && <button type="button" className="btn btn-ghost" onClick={onParametros}>⚙ Parámetros</button>}
          <nav className="view-toggle" aria-label="Pantallas del módulo">
            <button type="button" aria-current={sec === 'pendientes' ? 'page' : undefined} onClick={() => setSec('pendientes')}>
              Por realizar{datos ? ` (${docs.length})` : ''}
            </button>
            <button type="button" aria-current={sec === 'hechas' ? 'page' : undefined} onClick={() => setSec('hechas')}>Realizadas</button>
            <button type="button" aria-current={sec === 'libro' ? 'page' : undefined} onClick={() => setSec('libro')}>📒 Libro fiscal</button>
            <button type="button" aria-current={sec === 'agrupada' ? 'page' : undefined} onClick={() => setSec('agrupada')}>Vista agrupada</button>
            {/* Períodos: con la base de Retenciones; sin ella, solo en local (vacía y marcada). */}
            {verPeriodos && <button type="button" aria-current={sec === 'periodos' ? 'page' : undefined} onClick={() => { setPerInicial(undefined); setSec('periodos'); }}>Períodos <span className="rv8-badge-n">{vencidos || ''}</span></button>}
            <button type="button" aria-current={sec === 'reportes' ? 'page' : undefined} onClick={() => setSec('reportes')}>Reportes</button>
          </nav>
        </div>
      </header>

      {error && (
        <div className="aviso-error" role="alert">
          No se pudieron leer las retenciones: {error} <button type="button" className="mini" onClick={cargar}>Reintentar</button>
        </div>
      )}
      {!error && !datos && <p className="muted" role="status">Cargando…</p>}

      {/* En local, un solo aviso; cada pieza que espera a la base lleva su pastilla «2.1». */}
      {import.meta.env.DEV && datos && <p className="rv8-huella rv8-aviso-local">En local: lo marcado con «2.1» o deshabilitado y con borde de puntos requiere la base de Retenciones (paquete 2.1).</p>}
      {import.meta.env.DEV && datos && <PeriodoEnCurso impuestos={impuestos} />}

      {datos && sec === 'pendientes' && <PorRealizar docs={docs} onRegistrar={onRegistrar} onVerOc={onVerOc} onVerAgrupada={verDocumento} />}

<<<<<<< HEAD
      {datos && sec === 'agrupada' && (
        <VistaAgrupada pendientes={datos.pendientes} libro={datos.libro} config={datos.config} conceptos={datos.conceptos}
          onRegistrar={onRegistrar} onAnular={onAnular} onAdjuntar={onAdjuntar} foco={foco} onQuitarFoco={() => setFoco(null)} />
      )}

      {datos && sec === 'hechas' && <Realizadas libro={datos.libro} onAnular={onAnular} onAdjuntar={onAdjuntar} onVerAgrupada={verFactura}
        onRegistrarDeNuevo={onRegistrar ? registrarDeNuevo : undefined} />}

      {datos && sec === 'libro' && <LibroFiscalV8 libro={datos.libro} onAnular={onAnular} onAdjuntar={onAdjuntar} onRegistrarRecibida={onRegistrarRecibida} />}

      {datos && sec === 'periodos' && verPeriodos && (
        <Periodos key={perInicial ? `${perInicial.k}:${perInicial.est}` : 'todos'} inicial={perInicial} periodos={periodos} paso={paso} impuestos={impuestos} onDeclarar={periodos ? onDeclararPeriodo : undefined} onReabrir={periodos ? onReabrirPeriodo : undefined}
          onPasoInicial={periodos ? onPasoInicial : undefined} umbral={umbrales.declaraciones} />
      )}

      {verVenc && <VencimientosDialogo xs={listaVenc} umbrales={umbrales} conLicencias={avisos != null} onFicha={irFicha} onCerrar={() => setVerVenc(false)} />}
      {perfil && datos && <PerfilFiscal proveedor={perfil} libro={datos.libro} puedeEditar={!!onRegistrar} onCerrar={cerrarPerfil} />}

      {datos && sec === 'reportes' && <Reportes libro={datos.libro} />}
=======
      {datos && sec === 'libro' && <LibroFiscalV8 libro={datos.libro} onAnular={onAnular} onAdjuntar={onAdjuntar} onRegistrarRecibida={onRegistrarRecibida} />}
>>>>>>> feature/retenciones-v8-recibidas
    </main>
  );
}
