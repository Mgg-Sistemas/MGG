/* ============================================================
   MGG · Retenciones v8 · Reportes

   Traslado de la pestaña Reportes de la maqueta (sec-reportes y v8-14): a la
   izquierda, las plantillas; a la derecha, el constructor con el período,
   los filtros, la vista previa y las salidas. Con los datos de hoy (el libro):
   · Libro fiscal: «🖨 Imprimir lista / PDF» (el PDF de hoy), CSV y Excel;
   · las relaciones de IVA, ISLR y municipales: la hoja fiel al ejemplar, con
     su vista previa e «Imprimir»;
   · Retenido por proveedor y período (R3-19): la tabla cruzada, con CSV,
     Excel e impresión.
   Las plantillas propias y compartidas necesitan la base de Retenciones
   (paquete 2.1): solo en local, desactivadas y marcadas.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type ConceptoRetencion, type RetencionPracticada } from '../../datos/puerta';
import { datosRelacion } from '../../impresion/datosRelacion';
import { HojaRelacion, hojasDeRelacion } from '../../impresion/HojaRelacion';
import { nombreImagenRelacion } from '../../impresion/imagen';
import { PreviaRelacion } from '../../impresion/PreviaRelacion';
import { EjemploImpresion } from '../../impresion/EjemploImpresion';
import { BotonTxtIva } from '../TxtIva';
import { MarcaPaquete21 } from '../../comun/MarcaPaquete21';
import type { Impuesto } from '../../impresion/tipos';
import { VistaImpresion } from '../../impresion/VistaComprobante';
import { descargarCsv, descargarExcel, tablaLibro } from '../exportarLibro';
import { nombreImpuesto } from '../pendientesPorDocumento';
import { cruzada, etiquetaColumna, tablaCruzada, type Grano } from './cruzada';
import { Modal } from '@/shared/ui/Modal';
import { serieProveedor } from './analisis';
import { GraficaProveedor } from './GraficaProveedor';
import './rv8-reportes.css';
import './rv8-analisis.css';

type Plantilla = 'libro' | 'rel_iva' | 'rel_islr' | 'rel_isae' | 'cruzada';
type Atajo = 'mes' | 'mes_anterior' | 'ultimos_6' | 'ultimos_12' | 'rango';

const PLANTILLAS: { id: Plantilla; nombre: string; linea: string }[] = [
  { id: 'libro', nombre: 'Libro fiscal', linea: 'Una fila por retención, con sus totales.' },
  { id: 'rel_iva', nombre: 'Relación de retenciones de IVA', linea: 'La hoja del ejemplar, fiel.' },
  { id: 'rel_islr', nombre: 'Relación de retenciones de ISLR', linea: 'La hoja del ejemplar, fiel.' },
  { id: 'rel_isae', nombre: 'Relación de retenciones municipales', linea: 'La hoja del ejemplar, fiel.' },
  { id: 'cruzada', nombre: 'Retenido por proveedor y período', linea: 'Proveedores × períodos, con totales.' },
];
const ATAJOS: { id: Atajo; texto: string }[] = [
  { id: 'mes', texto: 'Este mes' }, { id: 'mes_anterior', texto: 'Mes anterior' },
  { id: 'ultimos_6', texto: 'Últimos 6 meses' }, { id: 'ultimos_12', texto: 'Últimos 12 meses' }, { id: 'rango', texto: 'Desde · hasta' },
];
const IMPUESTO_RELACION: Partial<Record<Plantilla, Impuesto>> = { rel_iva: 'iva', rel_islr: 'islr', rel_isae: 'isae' };

const iso = (d: Date) => d.toLocaleDateString('en-CA');
/** El rango de un atajo («últimos N meses» cuenta el mes en curso). */
export function rangoDeAtajo(atajo: Atajo, hoy: Date, desde: string, hasta: string): [string, string] {
  const y = hoy.getFullYear(), m = hoy.getMonth();
  if (atajo === 'mes') return [iso(new Date(y, m, 1)), iso(hoy)];
  if (atajo === 'mes_anterior') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (atajo === 'ultimos_6') return [iso(new Date(y, m - 5, 1)), iso(hoy)];
  if (atajo === 'ultimos_12') return [iso(new Date(y, m - 11, 1)), iso(hoy)];
  return [desde, hasta];
}
const fechaDe = (r: RetencionPracticada) => r.facturaFecha ?? r.createdAt.slice(0, 10);

export function Reportes({ libro }: { libro: RetencionPracticada[] }) {
  const puerta = usePuerta();
  const [plantilla, setPlantilla] = useState<Plantilla>('libro');
  const [atajo, setAtajo] = useState<Atajo>('mes');
  const [desdeTxt, setDesde] = useState('');
  const [hastaTxt, setHasta] = useState('');
  const [tipos, setTipos] = useState<string[]>(['iva', 'islr', 'municipal']);
  const [grano, setGrano] = useState<Grano>('mes');
  const [moneda, setMoneda] = useState('Bs');
  const [empresa, setEmpresa] = useState('');
  const [conceptos, setConceptos] = useState<ConceptoRetencion[]>([]);
  const [vista, setVista] = useState<'relacion' | 'cruzada' | null>(null);
  const [analisis, setAnalisis] = useState<{ clave: string; nombre: string; rif: string } | null>(null);
  useEffect(() => {
    Promise.all([puerta.config(), puerta.conceptos(false)])
      .then(([c, cs]) => { setEmpresa(c.razonSocial ?? ''); setConceptos(cs); })
      .catch(() => { /* sin la configuración, la cabecera de la relación queda sin la razón social */ });
  }, [puerta]);

  const [desde, hasta] = rangoDeAtajo(atajo, new Date(), desdeTxt, hastaTxt);
  const rangoValido = !!desde && !!hasta && desde <= hasta;
  const tiposDelLibro = useMemo(() => [...new Set(libro.map((r) => r.tipo as string))], [libro]);
  const delLibro = useMemo(
    () => (rangoValido ? libro.filter((r) => tipos.includes(r.tipo) && fechaDe(r) >= desde && fechaDe(r) <= hasta) : []),
    [libro, tipos, desde, hasta, rangoValido],
  );
  const impRelacion = IMPUESTO_RELACION[plantilla];
  const relacion = useMemo(
    () => (impRelacion && rangoValido ? datosRelacion(libro, { impuesto: impRelacion, desde, hasta, empresa, generado: new Date(), conceptos }) : null),
    [impRelacion, rangoValido, libro, desde, hasta, empresa, conceptos],
  );
  const cruce = useMemo(
    () => (plantilla === 'cruzada' && rangoValido ? cruzada(libro, { desde, hasta, grano, moneda, tipos }) : null),
    [plantilla, rangoValido, libro, desde, hasta, grano, moneda, tipos],
  );
  const nombre = PLANTILLAS.find((p) => p.id === plantilla)?.nombre ?? '';
  const archivo = `${nombre.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, '-')}-${desde}-a-${hasta}`;
  const fallo = (texto: string) => (e: unknown) => toast(e instanceof Error ? e.message : texto, 'error');
  const tablaDelCruce = () => (cruce ? { ...tablaCruzada(cruce), numericas: new Set(cruce.columnas.map((_, i) => i + 2).concat(cruce.columnas.length + 2)) } : null);
  const alternar = (k: string) => setTipos((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));

  return (
    <div className="rv8-rep-layout">
      <aside className="rv8-rep-plantillas" aria-label="Plantillas de reporte">
        <h4>Del sistema</h4>
        {PLANTILLAS.map((p) => (
          <button key={p.id} type="button" className="rv8-pl" aria-current={plantilla === p.id} onClick={() => setPlantilla(p.id)}>
            {p.nombre}<small>{p.linea}</small>
          </button>
        ))}
        {import.meta.env.DEV && (
          <>
            <h4>Propias y compartidas</h4>
            <span className="rv8-con-marca"><button type="button" className="rv8-pl rv8-requiere-base" disabled>Guardar como plantilla…</button><MarcaPaquete21 /></span>
          </>
        )}
      </aside>

      <section className="rv8-rep-constructor">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{nombre}</h2>
        <EjemploImpresion />
        <BotonTxtIva libro={libro} />
        <div className="rv8-rep-filtros">
          <label className="rv8-campo"><span>Período del reporte</span>
            <select className="rv8-sel" value={atajo} onChange={(e) => setAtajo(e.target.value as Atajo)}>
              {ATAJOS.map((a) => <option key={a.id} value={a.id}>{a.texto}</option>)}
            </select>
          </label>
          {atajo === 'rango' && (
            <div className="rv8-campo"><span>Desde · hasta</span>
              <span className="rv8-rango">
                <input className="rv8-sel" type="date" aria-label="Desde" value={desdeTxt} onChange={(e) => setDesde(e.target.value)} />
                <input className="rv8-sel" type="date" aria-label="Hasta" value={hastaTxt} onChange={(e) => setHasta(e.target.value)} />
              </span>
              {!rangoValido && <small className="v8-reg-error">Indique el desde y el hasta (el desde no puede ser posterior).</small>}
            </div>
          )}
          {!impRelacion && (
            <div className="rv8-campo"><span>Impuestos</span>
              <div className="rv8-chips" role="group" aria-label="Impuestos">
                {tiposDelLibro.map((k) => <button key={k} type="button" className="rv8-chip" aria-pressed={tipos.includes(k)} onClick={() => alternar(k)}>{nombreImpuesto(k)}</button>)}
              </div>
            </div>
          )}
          {plantilla === 'cruzada' && (
            <>
              <label className="rv8-campo"><span>Columnas por</span>
                <select className="rv8-sel" value={grano} onChange={(e) => setGrano(e.target.value as Grano)}>
                  <option value="mes">Mes</option><option value="trimestre">Trimestre</option><option value="anio">Año</option>
                </select>
              </label>
              <label className="rv8-campo"><span>Moneda</span>
                <select className="rv8-sel" value={moneda} onChange={(e) => setMoneda(e.target.value)}><option value="Bs">Bs</option><option value="USD">$</option></select>
              </label>
            </>
          )}
        </div>

        {plantilla === 'libro' && (
          <>
            <p className="huella">{delLibro.length} retención(es) del {desde || '—'} al {hasta || '—'}.</p>
            <div className="rv8-rep-acciones">
              {puerta.imprimirLibro && (
                <button type="button" className="btn" disabled={!delLibro.length} onClick={() => { puerta.imprimirLibro?.(delLibro, { desde, hasta }).catch(fallo('No se pudo generar el libro en PDF.')); }}>🖨 Imprimir lista / PDF</button>
              )}
              <button type="button" className="btn" disabled={!delLibro.length} onClick={() => descargarCsv(tablaLibro(delLibro), `${archivo}.csv`)}>CSV</button>
              <button type="button" className="btn" disabled={!delLibro.length} onClick={() => { descargarExcel(tablaLibro(delLibro), nombre, `${archivo}.xlsx`).catch(fallo('No se pudo generar el Excel.')); }}>Excel</button>
            </div>
          </>
        )}

        {relacion && (
          <>
            <p className="huella">{relacion.filas.length} retención(es) practicada(s) con fecha de emisión del {desde} al {hasta}. La hoja es la del ejemplar: horizontal por defecto.</p>
            <div className="rv8-rep-acciones">
              <button type="button" className="btn btn-primary" disabled={!relacion.filas.length} onClick={() => setVista('relacion')}>Vista previa e impresión</button>
            </div>
          </>
        )}

        {cruce && (
          <>
            <p className="huella">{cruce.filas.length} proveedor(es) · {cruce.columnas.length} columna(s) · total {money(cruce.total, moneda)}{cruce.columnas.length > 12 ? '. Más de 12 columnas: conviene agrupar por trimestre o año.' : '.'}</p>
            <div className="rv8-rep-acciones">
              <button type="button" className="btn" disabled={!cruce.filas.length} onClick={() => setVista('cruzada')}>🖨 Imprimir</button>
              <button type="button" className="btn" disabled={!cruce.filas.length} onClick={() => { const t = tablaDelCruce(); if (t) descargarCsv(t, `${archivo}.csv`); }}>CSV</button>
              <button type="button" className="btn" disabled={!cruce.filas.length} onClick={() => { const t = tablaDelCruce(); if (t) descargarExcel(t, nombre, `${archivo}.xlsx`).catch(fallo('No se pudo generar el Excel.')); }}>Excel</button>
            </div>
            <div className="rv8-v8-tabla-scroll"><TablaCruzada cruce={cruce} moneda={moneda} onProveedor={setAnalisis} /></div>
          </>
        )}
      </section>

      {vista === 'relacion' && relacion && (
        <VistaImpresion titulo={nombre} marco={false} onCerrar={() => setVista(null)}
          hoja={(o) => <HojaRelacion datos={relacion} orientacion={o} />} previa={(o) => <PreviaRelacion datos={relacion} orientacion={o} />}
          imagen={{ nombre: nombreImagenRelacion(relacion.impuesto, relacion.desde), capturas: (o) => hojasDeRelacion(relacion, o) }} />
      )}
      {analisis && (
        <Modal title={`Análisis · ${analisis.nombre}`} size="xl" onClose={() => setAnalisis(null)}>
          <p className="huella">{analisis.rif} · {tipos.map(nombreImpuesto).join(', ')} · del {desde} al {hasta} · {moneda === 'USD' ? '$' : 'Bs'}</p>
          <GraficaProveedor id="analisis-prov" moneda={moneda} serie={serieProveedor(libro, analisis.clave, { desde, hasta, grano, moneda, tipos })} />
        </Modal>
      )}
      {vista === 'cruzada' && cruce && (
        <VistaImpresion titulo={nombre} marco={false} onCerrar={() => setVista(null)}
          hoja={() => <div style={{ padding: 24, color: '#000' }}><h3 style={{ margin: '0 0 8px' }}>{nombre} · {desde} al {hasta} · {moneda}</h3><TablaCruzada cruce={cruce} moneda={moneda} /></div>} />
      )}
    </div>
  );
}

function TablaCruzada({ cruce, moneda, onProveedor }: {
  cruce: NonNullable<ReturnType<typeof cruzada>>; moneda: string;
  /** Tocar un proveedor abre su análisis (maqueta R3-19.3). Sin ella, el nombre es texto. */
  onProveedor?: (p: { clave: string; nombre: string; rif: string }) => void;
}) {
  const m = (v: number) => (v ? money(v, moneda) : '·');
  return (
    <table className="rv8-cruzada">
      <thead>
        <tr><th className="rv8-fijo">Proveedor</th>{cruce.columnas.map((k) => <th key={k} className="n">{etiquetaColumna(k, cruce.grano)}</th>)}<th className="n">Total</th></tr>
      </thead>
      <tbody>
        {cruce.filas.map((f) => (
          <tr key={f.clave}>
            <td className="rv8-fijo">
              {onProveedor ? <button type="button" className="rv8-prov" onClick={() => onProveedor(f)}>{f.nombre}</button> : f.nombre}
              <br /><small className="muted">{f.rif}</small>
            </td>
            {cruce.columnas.map((k) => <td key={k} className="n">{m(f.celdas[k] ?? 0)}</td>)}
            <td className="n"><b>{m(f.total)}</b></td>
          </tr>
        ))}
        <tr className="rv8-total"><td className="rv8-fijo">Total</td>{cruce.columnas.map((k) => <td key={k} className="n">{m(cruce.totalesColumna[k] ?? 0)}</td>)}<td className="n">{m(cruce.total)}</td></tr>
      </tbody>
    </table>
  );
}
