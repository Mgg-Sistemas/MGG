/* ============================================================
   MGG · Retenciones v8 · ⚙ Parámetros

   Traslado del panel «Parámetros de retenciones» de la maqueta v8: dos
   capas, Ajustes (lo de todos los días) y Ajustes avanzados (lo que cambia
   cálculos, números o fechas). Cada tarjeta abre su sección y «Volver»
   regresa a la portada.

   Hoy se muestran las secciones que tienen datos en la base, y se editan
   con lo que la base ya guarda (las mismas funciones que la pantalla de
   hoy, por la puerta), solo con permiso de escritura en Retenciones:
   · Ajustes › Datos de la empresa (retencion_config);
   · Ajustes avanzados › Régimen y valores compartidos (retencion_config) y
     el catálogo de conceptos de cada impuesto (retencion_conceptos): alta,
     edición, activar y desactivar.
   Motivos, entes y logos, perfiles, licencias, firma, otro sistema, avisos,
   reglas, períodos, numeración y formatos esperan a sus tablas y no se
   muestran.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { labelSujeto, type ConceptoRetencion, type ConfigRetencion } from '../../retencionesCalculo';
import { usePuerta } from '../datos/puerta';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { EditorConcepto, EditorEmpresa, EditorRegimen } from './editores';
import './parametros.css';

type Vista = 'portada' | 'empresa' | 'avanzados' | 'regimen' | `conceptos:${string}`;

const pct = (n: number) => `${n.toLocaleString('es-VE', { maximumFractionDigits: 4 })} %`;
const ut = (n: number) => (n > 0 ? `Bs ${n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Sin cargar');

interface Props {
  onCerrar: () => void;
  /** Con escritura en Retenciones, cada sección se edita. Sin ella, solo se consulta. */
  puedeEditar?: boolean;
}

export function Parametros({ onCerrar, puedeEditar = false }: Props) {
  const puerta = usePuerta();
  const { user } = useSession();
  const [vista, setVista] = useState<Vista>('portada');
  const [config, setConfig] = useState<ConfigRetencion | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<null | 'empresa' | 'regimen' | 'nuevo' | string>(null);

  const cargar = useCallback(() => {
    Promise.all([puerta.config(), puerta.conceptos(false)])
      .then(([c, cs]) => { setConfig(c); setConceptos(cs); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo leer la configuración fiscal.'));
  }, [puerta]);
  useEffect(() => { cargar(); }, [cargar]);

  const ir = (v: Vista) => { setVista(v); setEditando(null); };
  const guardarConfig = async (c: ConfigRetencion) => {
    await puerta.guardarConfig(c, user?.email ?? 'sistema');
    toast('Parámetros guardados.', 'success'); setEditando(null); cargar();
  };
  const guardarConcepto = async (c: Partial<ConceptoRetencion> & { nombre: string; tipo: ConceptoRetencion['tipo'] }) => {
    await puerta.guardarConcepto(c);
    toast(c.id ? 'Concepto guardado.' : 'Concepto creado.', 'success'); setEditando(null); cargar();
  };
  const activar = (c: ConceptoRetencion) => {
    puerta.activarConcepto(c.id, !c.activo)
      .then(() => { toast(c.activo ? 'Concepto desactivado.' : 'Concepto activado.', 'success'); cargar(); })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo cambiar el concepto.', 'error'));
  };

  const tiposConCatalogo = [...new Set(conceptos.map((c) => c.tipo as string))];
  const volver = (a: Vista) => <button type="button" className="v7-volver" onClick={() => ir(a)}>‹ Volver</button>;
  const botonEditar = (que: string) => (puedeEditar && editando == null
    ? <button type="button" className="mini v8-pa-editar" onClick={() => setEditando(que)}>Editar</button> : null);

  const footer = (
    <>
      <span className="huella v8-pa-pie">{puedeEditar ? 'Edición: administración, o escritura en Retenciones.' : 'Consulta: sin permiso de escritura en Retenciones.'}</span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
    </>
  );

  return (
    <Modal title="⚙ Parámetros de retenciones" size="lg" onClose={onCerrar} footer={footer}>
      <div className="ret-v8 v8-parametros">
        {error && <div className="aviso-error" role="alert">No se pudo leer la configuración fiscal: {error}</div>}
        {!config && !error && <p className="muted" role="status">Cargando…</p>}

        {config && vista === 'portada' && (
          <>
            <p className="huella v7-capa-d">Configuración del módulo, en dos capas: Ajustes y Ajustes avanzados.</p>
            <h3 className="v7-capa-t">Ajustes</h3>
            <p className="huella v7-capa-d">Mantenimiento de todos los días. No cambian cuánto se retiene, cómo se numera ni cuándo se declara.</p>
            <div className="v7-pa-grid">
              <button type="button" className="v7-pa-btn" onClick={() => ir('empresa')}>
                <span className="t">Datos de la empresa</span>
                <span className="d">Los datos del agente de retención que van en cada comprobante.</span>
                <span className="r">{config.rif ? `RIF ${config.rif}` : 'RIF sin cargar'}{config.razonSocial ? ` · ${config.razonSocial}` : ''}</span>
              </button>
            </div>
            <button type="button" className="v7-pa-avanzados" onClick={() => ir('avanzados')}>
              <span className="t">Ajustes avanzados</span>
              <span className="d">Lo de toda la empresa (régimen y valores compartidos) y el catálogo de conceptos de cada impuesto.</span>
              <span className="r">Cambian cálculos · {1 + tiposConCatalogo.length} sección(es)</span>
            </button>
          </>
        )}

        {config && vista === 'empresa' && (
          <>
            {volver('portada')}
            <h3 className="v7-sec-t">Datos de la empresa {botonEditar('empresa')}</h3>
            {editando === 'empresa'
              ? <EditorEmpresa config={config} onGuardar={guardarConfig} onCancelar={() => setEditando(null)} />
              : (
                <dl className="v7-que">
                  <dt>Razón social</dt><dd>{config.razonSocial || 'Sin cargar'}</dd>
                  <dt>RIF</dt><dd className="mono">{config.rif || 'Sin cargar'}</dd>
                  <dt>Dirección fiscal</dt><dd>{config.direccionFiscal || 'Sin cargar'}</dd>
                  <dt>Municipio</dt><dd>{config.municipio || 'Sin cargar'}</dd>
                  <dt>Estado</dt><dd>{config.estado || 'Sin cargar'}</dd>
                </dl>
              )}
          </>
        )}

        {config && vista === 'avanzados' && (
          <>
            {volver('portada')}
            <h3 className="v7-sec-t">Ajustes avanzados</h3>
            <p className="huella">Cambian cálculos, números o fechas de declaración.</p>
            <div className="v7-pa-grid">
              <button type="button" className="v7-pa-btn" onClick={() => ir('regimen')}>
                <span className="t">Régimen y valores compartidos</span>
                <span className="d">La condición de agente de retención y los valores que usan varios impuestos.</span>
                <span className="r">{config.esContribuyenteEspecial ? 'Contribuyente especial' : 'No es contribuyente especial'} · UT {ut(config.valorUt)}</span>
              </button>
              {tiposConCatalogo.map((t) => {
                const xs = conceptos.filter((c) => c.tipo === t);
                return (
                  <button key={t} type="button" className="v7-pa-btn" onClick={() => ir(`conceptos:${t}`)}>
                    <span className="t">Conceptos de {nombreImpuesto(t)}</span>
                    <span className="d">El catálogo con el que se elige el % de cada línea.</span>
                    <span className="r">{xs.filter((c) => c.activo).length} activo(s) de {xs.length}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {config && vista === 'regimen' && (
          <>
            {volver('avanzados')}
            <h3 className="v7-sec-t">Régimen y valores compartidos {botonEditar('regimen')}</h3>
            {editando === 'regimen'
              ? <EditorRegimen config={config} onGuardar={guardarConfig} onCancelar={() => setEditando(null)} />
              : (
                <dl className="v7-que">
                  <dt>Condición</dt><dd>{config.esContribuyenteEspecial ? 'Contribuyente especial: practica retención de IVA' : 'No es contribuyente especial: no practica retención de IVA'}</dd>
                  <dt>IVA: % general</dt><dd>{pct(config.pctIvaGeneral)}</dd>
                  <dt>IVA: % del art. 5</dt><dd>{pct(config.pctIvaEspecial)}</dd>
                  <dt>Unidad tributaria</dt><dd>{ut(config.valorUt)}{config.valorUt > 0 ? '' : ' · sin ella no se calculan el mínimo ni el sustraendo del ISLR'}</dd>
                  <dt>IGTF</dt><dd>{pct(config.pctIgtf)}</dd>
                </dl>
              )}
          </>
        )}

        {config && vista.startsWith('conceptos:') && (() => {
          const t = vista.slice('conceptos:'.length) as ConceptoRetencion['tipo'];
          const xs = conceptos.filter((c) => c.tipo === t).sort((a, b) => a.orden - b.orden);
          const enEdicion = editando && editando !== 'nuevo' ? xs.find((c) => c.id === editando) ?? null : null;
          return (
            <>
              {volver('avanzados')}
              <h3 className="v7-sec-t">
                Conceptos de {nombreImpuesto(t)}{' '}
                {puedeEditar && editando == null && <button type="button" className="mini v8-pa-editar" onClick={() => setEditando('nuevo')}>+ Nuevo concepto</button>}
              </h3>
              {(editando === 'nuevo' || enEdicion) && (
                <EditorConcepto key={editando ?? ''} concepto={enEdicion} tipo={t} onGuardar={guardarConcepto} onCancelar={() => setEditando(null)} />
              )}
              <div className={`lista-sis v8-pa-conceptos${puedeEditar ? ' con-acciones' : ''}`}>
                <div className="fila-sis cab">
                  <span>Código</span><span>Concepto</span><span>Sujeto</span><span className="n">%</span><span className="n">Base</span><span>Mínimo y sustraendo</span><span>Estado</span>{puedeEditar && <span />}
                </div>
                {xs.map((c) => (
                  <div key={c.id} className="fila-sis">
                    <span data-l="Código" className="mono">{c.codigo || '—'}</span>
                    <span data-l="Concepto">{c.nombre}{c.fundamento && <small>{c.fundamento}</small>}</span>
                    <span data-l="Sujeto">{labelSujeto(c.sujeto)}</span>
                    <span data-l="%" className="n">{pct(c.porcentaje)}</span>
                    <span data-l="Base" className="n">{pct(c.basePct)}</span>
                    <span data-l="Mínimo y sustraendo">{c.baseMinimaUt > 0 ? `${c.baseMinimaUt.toLocaleString('es-VE')} UT` : 'Sin mínimo'}{c.aplicaSustraendo ? ' · con sustraendo' : ''}</span>
                    <span data-l="Estado"><span className={`pill ${c.activo ? 'ok' : 'inactivo'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></span>
                    {puedeEditar && (
                      <span className="acc">
                        <button type="button" className="mini" disabled={editando != null} onClick={() => setEditando(c.id)}>Editar</button>
                        <button type="button" className="mini" disabled={editando != null} onClick={() => activar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </div>
    </Modal>
  );
}
