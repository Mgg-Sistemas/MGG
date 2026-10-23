/* ============================================================
   Golden Touch · Retenciones · Parámetros › Formatos de impresión (R8)

   El comprobante de cada impuesto, con versiones por fecha: textos
   (encabezado, nota legal, pie), rótulos, columnas de la tabla (rótulo, si
   se ve, orden y ancho) y orientación. Versión nueva desde una fecha,
   corregir la vigente con motivo, volver al diseño de fábrica, historial y
   vista previa con datos de muestra. Nada se borra.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import {
  DOCUMENTO_COMPROBANTE, corregirFormato, listFormatos, nuevaVersionFormato, volverAFabrica,
  type ContenidoFormato, type FormatoGuardado,
} from './formatos.repository';
import {
  CLAVES_TEXTO, NOMBRE_ROTULO, ROTULOS_FABRICA, aplicarFormato, columnasFabrica, faltaEnFormato, textosFabrica,
  type ColumnaFormato, type Orientacion,
} from './formatoComprobante';
import { retencionDeMuestra } from './formatoMuestra';
import { getConfigRetencion } from './retencionesFiscal.repository';
import { leerMonto, numeroATexto } from './validarCarga';
import { fechaCorta } from './parametrosR1';
import { AYUDA_ORDEN, ROTULO_ORDEN, rotuloAutor, rotuloImpuesto, rotuloMotivo, sinRotulo } from './rotulos';
import { ListaChecksAcordeon } from './SupuestosIvaAcordeon';
import type { TipoImpuesto } from './retencionesCalculo';

const IMPUESTOS: Array<{ clave: string; tipo: TipoImpuesto; nombre: string }> = ([
  ['IVA', 'iva'], ['ISLR', 'islr'], ['MUNICIPAL', 'municipal'], ['ESTADAL', 'regional'], ['IGTF', 'igtf'],
] as const).map(([clave, tipo]) => ({ clave, tipo, nombre: rotuloImpuesto(clave) }));
const NOMBRE_TEXTO: Record<string, string> = { encabezado: 'Encabezado (título)', nota_legal: 'Nota legal (bajo el título)', pie: 'Pie' };
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
const diaSiguiente = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** La versión vigente hoy de un impuesto, la que viene (desde futuro) y el historial. */
function versionesDe(todas: FormatoGuardado[], clave: string, hoy: string) {
  const mias = todas.filter((f) => f.impuestoClave === clave).sort((a, b) => b.desde.localeCompare(a.desde));
  const vigente = mias.find((f) => f.desde <= hoy && (!f.hasta || f.hasta >= hoy)) ?? null;
  const proxima = mias.find((f) => f.desde > hoy) ?? null;
  return { vigente, proxima, historial: mias };
}

type Edicion = { modo: 'nueva' | 'corregir' | 'fabrica'; imp: typeof IMPUESTOS[number]; base: FormatoGuardado | null; abierta: FormatoGuardado | null };

export function ParametrosFormatos({ puedeEditar }: { puedeEditar: boolean }) {
  const [formatos, setFormatos] = useState<FormatoGuardado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editar, setEditar] = useState<Edicion | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);
  const hoy = hoyVenezuela();

  const cargar = useCallback(async () => {
    try { setFormatos(await listFormatos(DOCUMENTO_COMPROBANTE)); setError(null); }
    catch (e) { setError(mensaje(e, 'No se pudieron leer los formatos.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_formatos'], () => { void cargar(); });

  return (
    <div>
      <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>
        Cómo se imprime el comprobante de cada impuesto. Cada versión vale desde su fecha: el comprobante usa la vigente a su fecha de emisión.
        Sin versión, se imprime con el diseño de fábrica.
      </p>
      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!formatos && !error && <p className="muted">Leyendo los formatos…</p>}
      {formatos && (
        <table className="table" style={{ fontSize: '.84rem', width: '100%' }}>
          <thead><tr><th>Comprobante</th><th>Vigente hoy</th><th>Próxima</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {IMPUESTOS.map((imp) => {
              const { vigente, proxima, historial: h } = versionesDe(formatos, imp.clave, hoy);
              const abierta = h.find((f) => !f.hasta) ?? null;
              return (
                <tr key={imp.clave}>
                  <td><strong>{imp.nombre}</strong></td>
                  <td>
                    {!vigente || vigente.deFabrica ? 'De fábrica' : `Desde el ${fechaCorta(vigente.desde)}`}
                    {vigente && <div className="muted" style={{ fontSize: '.74rem' }}>{rotuloMotivo(vigente.motivo)} · {rotuloAutor(vigente.actualizadoPor)}</div>}
                  </td>
                  <td>{proxima ? `${proxima.deFabrica ? 'De fábrica' : 'Versión nueva'} desde el ${fechaCorta(proxima.desde)}` : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {h.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistorial(historial === imp.clave ? null : imp.clave)}>Historial</button>}
                    {puedeEditar && (
                      <>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditar({ modo: 'nueva', imp, base: abierta, abierta })}>Versión nueva</button>
                        {abierta && !abierta.deFabrica && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditar({ modo: 'corregir', imp, base: abierta, abierta })}>Corregir</button>}
                        {abierta && !abierta.deFabrica && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditar({ modo: 'fabrica', imp, base: null, abierta })}>Volver a fábrica</button>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {formatos && historial && (
        <div className="card" style={{ marginTop: '.6rem' }}>
          <strong style={{ fontSize: '.88rem' }}>Historial · {IMPUESTOS.find((i) => i.clave === historial)?.nombre}</strong>
          <table className="table" style={{ fontSize: '.8rem', width: '100%', marginTop: '.4rem' }}>
            <thead><tr><th>Vigencia</th><th>Contenido</th><th>Motivo</th><th>Quién</th></tr></thead>
            <tbody>
              {versionesDe(formatos, historial, hoy).historial.map((f) => (
                <tr key={f.id}>
                  <td>{fechaCorta(f.desde)} – {f.hasta ? fechaCorta(f.hasta) : 'sin fin'}</td>
                  <td>{f.deFabrica ? 'De fábrica' : `${f.orientacion === 'vertical' ? 'Vertical' : 'Horizontal'}${f.textos ? ` · textos: ${Object.keys(f.textos).length}` : ''}${f.rotulos ? ` · rótulos: ${Object.keys(f.rotulos).length}` : ''}${f.columnas ? ' · columnas propias' : ''}`}</td>
                  <td>{rotuloMotivo(f.motivo)}{f.fuente && <div className="muted">{f.fuente}</div>}</td>
                  <td>{rotuloAutor(f.actualizadoPor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <EditorFormato edicion={editar} hoy={hoy} onClose={() => setEditar(null)} onHecho={() => { setEditar(null); void cargar(); }} />}
    </div>
  );
}

interface FilaColumna { campo: string; rotulo: string; visible: boolean; orden: string; ancho: string }

function EditorFormato({ edicion, hoy, onClose, onHecho }: { edicion: Edicion; hoy: string; onClose: () => void; onHecho: () => void }) {
  const { modo, imp, base, abierta } = edicion;
  const minDesde = abierta ? diaSiguiente(abierta.desde) : '2000-01-01';
  const [desde, setDesde] = useState(modo === 'corregir' && abierta ? abierta.desde : (hoy > minDesde ? hoy : minDesde));
  const [motivo, setMotivo] = useState('');
  const [fuente, setFuente] = useState(modo === 'corregir' ? base?.fuente ?? '' : '');
  const [orientacion, setOrientacion] = useState<Orientacion>(base && !base.deFabrica ? base.orientacion : 'horizontal');
  const [textos, setTextos] = useState<Record<string, string>>(() => Object.fromEntries(CLAVES_TEXTO.map((k) => [k, String(base?.textos?.[k] ?? '')])));
  const [rotulos, setRotulos] = useState<Record<string, string>>(() => Object.fromEntries(Object.keys(ROTULOS_FABRICA).map((k) => [k, String(base?.rotulos?.[k] ?? '')])));
  const [columnas, setColumnas] = useState<FilaColumna[]>(() => {
    const aplicado = aplicarFormato(imp.tipo, base);
    const propias = new Map(aplicado.columnas.map((c) => [c.campo, c]));
    return columnasFabrica(imp.tipo).map((c) => {
      const p = propias.get(c.campo);
      return { campo: c.campo, rotulo: p?.rotulo ?? c.rotulo, visible: !!p, orden: String(p?.orden ?? c.orden), ancho: p?.ancho ? numeroATexto(p.ancho) : '' };
    });
  });
  const [guardando, setGuardando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const fabrica = textosFabrica(imp.tipo);

  // El nombre de fábrica de cada columna, para los avisos de una columna sin rótulo (nunca el campo interno).
  const rotuloFabrica = useMemo(() => new Map(columnasFabrica(imp.tipo).map((c) => [c.campo, c.rotulo])), [imp.tipo]);
  // Las columnas escritas → las del formato (orden y ancho leídos; lo ilegible frena).
  const leidas = useMemo((): { cols: ColumnaFormato[]; error: string | null } => {
    const cols: ColumnaFormato[] = [];
    for (const c of columnas) {
      const orden = leerMonto(c.orden);
      if (orden == null || !Number.isInteger(orden) || orden < 0) return { cols, error: `La posición de la columna «${c.rotulo || (rotuloFabrica.get(c.campo) ?? sinRotulo(c.campo))}» va como número entero.` };
      const ancho = c.ancho.trim() ? leerMonto(c.ancho) : null;
      if (c.ancho.trim() && ancho == null) return { cols, error: `No se entiende el ancho de «${c.rotulo || (rotuloFabrica.get(c.campo) ?? sinRotulo(c.campo))}».` };
      cols.push({ campo: c.campo, rotulo: c.rotulo, visible: c.visible, orden, ancho });
    }
    return { cols, error: null };
  }, [columnas, rotuloFabrica]);

  const contenido = (): ContenidoFormato => ({ orientacion, textos, rotulos, columnas: leidas.cols, fuente });
  const falta = modo === 'fabrica'
    ? faltaEnFormato({ desde, motivo, columnas: [] })
    : leidas.error ?? faltaEnFormato({ desde, motivo, columnas: leidas.cols });
  const fueraDeRango = modo !== 'corregir' && desde < minDesde ? `La versión nueva tiene que empezar después del ${fechaCorta(abierta?.desde ?? '')}.` : null;

  async function vistaPrevia() {
    if (leidas.error) { setFalla(leidas.error); return; }
    try {
      const [{ verComprobanteRetencionPdf }, config] = await Promise.all([import('./comprobanteRetencionPdf'), getConfigRetencion()]);
      const borrador = modo === 'fabrica' ? null : { orientacion, textos, rotulos, columnas: leidas.cols };
      await verComprobanteRetencionPdf(retencionDeMuestra(imp.tipo, hoy), config, borrador);
    } catch (e) { setFalla(mensaje(e, 'No se pudo armar la vista previa.')); }
  }

  async function guardar() {
    const motivoFalla = fueraDeRango ?? falta;
    if (motivoFalla) { setFalla(motivoFalla); return; }
    setGuardando(true); setFalla(null);
    try {
      if (modo === 'fabrica') await volverAFabrica(imp.clave, DOCUMENTO_COMPROBANTE, desde, motivo);
      else if (modo === 'corregir' && abierta) await corregirFormato(abierta.id, abierta.desde, motivo, contenido());
      else await nuevaVersionFormato(imp.clave, DOCUMENTO_COMPROBANTE, desde, motivo, contenido());
      toast(modo === 'fabrica' ? 'El comprobante vuelve al diseño de fábrica desde esa fecha.' : modo === 'corregir' ? 'Formato corregido.' : 'Versión nueva guardada.', 'success');
      onHecho();
    } catch (e) { setFalla(mensaje(e, 'No se pudo guardar el formato.')); setGuardando(false); }
  }

  const titulo = `${modo === 'nueva' ? 'Versión nueva' : modo === 'corregir' ? 'Corregir la vigente' : 'Volver a fábrica'} · comprobante de ${imp.nombre}`;
  return (
    <Modal title={titulo} size="lg" onClose={onClose}
      footer={(
        <>
          <span className="hint" style={{ marginRight: 'auto', color: 'var(--danger)', fontSize: '.8rem' }}>{falla ?? fueraDeRango ?? falta ?? ''}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void vistaPrevia()} disabled={guardando}>Vista previa</button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 160px' }}>
          <label>Desde</label>
          <input className="input" type="date" value={desde} min={modo === 'corregir' ? undefined : minDesde} max="2100-12-31"
            disabled={modo === 'corregir'} onChange={(e) => setDesde(e.target.value)} />
          <small className="hint muted">{modo === 'corregir' ? 'La vigente conserva su fecha.' : abierta ? `Después del ${fechaCorta(abierta.desde)}: la vigente cierra el día antes.` : 'Desde esta fecha se imprime así.'}</small>
        </div>
        {modo !== 'fabrica' && (
          <div className="form-row" style={{ flex: '1 1 160px' }}>
            <label>Orientación</label>
            <select className="select" value={orientacion} onChange={(e) => setOrientacion(e.target.value === 'vertical' ? 'vertical' : 'horizontal')}>
              <option value="horizontal">Horizontal (la de fábrica)</option>
              <option value="vertical">Vertical</option>
            </select>
          </div>
        )}
      </div>

      {modo === 'fabrica' ? (
        <p className="muted" style={{ fontSize: '.84rem' }}>Desde esa fecha, el comprobante de {imp.nombre} se imprime con el diseño del sistema. La versión actual queda en el historial.</p>
      ) : (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: '.4rem 0' }}>
            <legend style={{ fontWeight: 600, fontSize: '.86rem' }}>Textos <span className="muted" style={{ fontWeight: 400 }}>(vacío = el de fábrica)</span></legend>
            {CLAVES_TEXTO.map((k) => (
              <div className="form-row" key={k}>
                <label>{NOMBRE_TEXTO[k]}</label>
                <textarea className="input" rows={k === 'pie' ? 2 : 1} value={textos[k] ?? ''} placeholder={fabrica[k] || '—'}
                  onChange={(e) => setTextos((t) => ({ ...t, [k]: e.target.value }))} />
              </div>
            ))}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: '.4rem 0' }}>
            <legend style={{ fontWeight: 600, fontSize: '.86rem' }}>Rótulos <span className="muted" style={{ fontWeight: 400 }}>(vacío = el de fábrica)</span></legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.4rem .6rem' }}>
              {Object.keys(ROTULOS_FABRICA).map((k) => (
                <div className="form-row" key={k} style={{ margin: 0 }}>
                  <label style={{ fontSize: '.78rem' }}>{NOMBRE_ROTULO[k]}</label>
                  <input className="input" value={rotulos[k] ?? ''} placeholder={ROTULOS_FABRICA[k]} onChange={(e) => setRotulos((r) => ({ ...r, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </fieldset>
          <div style={{ margin: '.4rem 0' }}>
            <ListaChecksAcordeon
              titulo="Columnas de la tabla del comprobante"
              conteoMarcados={columnas.filter((c) => c.visible).length}
              conteoTotal={columnas.length}
              inicialAbierto={true}
            >
              <table className="table" style={{ fontSize: '.8rem', width: '100%' }}>
                <thead><tr><th>Se ve</th><th>Rótulo</th><th>{ROTULO_ORDEN}</th><th>Ancho (pt)</th></tr></thead>
                <tbody>
                  {columnas.map((c, i) => (
                    <tr key={c.campo}>
                      <td><input type="checkbox" checked={c.visible} aria-label={`Mostrar ${c.rotulo}`} onChange={(e) => setColumnas((xs) => xs.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)))} /></td>
                      <td><input className="input" value={c.rotulo} onChange={(e) => setColumnas((xs) => xs.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)))} /></td>
                      <td><input className="input mono" style={{ width: 60 }} inputMode="numeric" value={c.orden} onChange={(e) => setColumnas((xs) => xs.map((x, j) => (j === i ? { ...x, orden: e.target.value } : x)))} /></td>
                      <td><input className="input mono" style={{ width: 70 }} inputMode="decimal" value={c.ancho} placeholder="auto" onChange={(e) => setColumnas((xs) => xs.map((x, j) => (j === i ? { ...x, ancho: e.target.value } : x)))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <small className="hint muted">{ROTULO_ORDEN}: {AYUDA_ORDEN.charAt(0).toLowerCase()}{AYUDA_ORDEN.slice(1)}</small>
            </ListaChecksAcordeon>
          </div>
        </>
      )}

      <div className="form-row">
        <label>Motivo</label>
        <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué cambia: queda en el historial" />
      </div>
      {modo !== 'fabrica' && (
        <div className="form-row">
          <label>Fuente</label>
          <input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Providencia, ordenanza o instrucción que lo pide" />
        </div>
      )}
    </Modal>
  );
}
