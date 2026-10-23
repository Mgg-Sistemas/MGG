/* ============================================================
   MGG · Retenciones · Impresión · Los comprobantes (IVA, ISLR, ISAE)

   Trasladados tal cual de la maqueta v8 (hojaCompIva, hojaCompIslr,
   hojaCompIsae, tablaComp, tablaRet): carta horizontal de 1056 × 816 px,
   cada campo en la posición medida sobre su ejemplar.

   - Firma y sello: una imagen; sin imagen, el recuadro queda en blanco.
   - ISAE: sin logo, el recuadro rotulado «Logo de la Alcaldía»; el N° se
     presenta «AAAAMM 9 dígitos»; la base con punto decimal y el % sin
     decimales fijos, como el ejemplar.
   ============================================================ */
import { Fragment } from 'react';
import { columnasComprobante, type DefColumna, type FormatoDocumento } from './formatos';
import { fechaVe, n2, n2PuntoDecimal, numeroIsae, pctIsae, totalesComprobante } from './numeros';
import type { ClaveTotal, DatosComprobante, FilaComprobante, ImagenImpresion, Impuesto, Orientacion, TotalesComprobante } from './tipos';
import './hojas.css';

export interface PropsHojaComprobante {
  datos: DatosComprobante;
  formato: FormatoDocumento;
}

/** Une las clases que valen (undefined si ninguna). */
export const cx = (...xs: (string | false | null | undefined)[]): string | undefined => xs.filter(Boolean).join(' ') || undefined;

/** Un rótulo de varias líneas (lista, o texto separado por «|»). */
function Lineas({ texto }: { texto: string | string[] | undefined }) {
  const ls = Array.isArray(texto) ? texto : String(texto ?? '').split('|');
  return <>{ls.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</>;
}

/** Un rótulo numerado del ISAE: el «(n)» del principio, en negrita. */
function RotuloNumerado({ texto }: { texto: string | undefined }) {
  const m = /^(\(\d+\))([\s\S]*)$/.exec(texto ?? '');
  return m ? <><b>{m[1]}</b>{m[2]}</> : <>{texto}</>;
}

/** La firma y el sello: la imagen guardada; sin imagen, el recuadro en blanco. */
function Firma({ formato, firma }: { formato: FormatoDocumento; firma?: ImagenImpresion | null }) {
  return formato.firma && firma?.src
    ? <img className="hv8-firma" src={firma.src} alt={firma.alt ?? 'Firma y sello del agente de retención'} />
    : <span className="hv8-firma vacia" aria-hidden="true" />;
}

const valorFila = (fila: FilaComprobante, id: string): unknown => (fila as unknown as Record<string, unknown>)[id];
const texto = (v: unknown): string => (v == null ? '' : String(v));

/** Lo que dice una celda de la tabla del IVA o del ISAE. */
export function celdaComprobante(c: DefColumna, fila: FilaComprobante, impuesto: Impuesto): string {
  if (c.id === 'fecha') return fechaVe(fila.fecha);
  if (!c.numero) return texto(valorFila(fila, c.id));
  // El ISAE del ejemplar escribe el % sin decimales fijos («2.5») y la base con punto decimal («55.550.14»)
  if (impuesto === 'isae' && c.id === 'alic') return pctIsae(fila.alicIsae);
  const v = Number(valorFila(fila, c.id)) || 0;
  return impuesto === 'isae' && c.id === 'base' ? n2PuntoDecimal(v) : n2(v);
}

function totalCelda(c: DefColumna, tot: TotalesComprobante, impuesto: Impuesto): string {
  const v = tot[c.id as ClaveTotal] ?? 0;
  return impuesto === 'isae' && c.id === 'base' ? n2PuntoDecimal(v) : n2(v);
}

/** La tabla del IVA y del ISAE: el rótulo en un solo recuadro, cada dato con su línea, los totales sueltos y en negrita. */
function TablaComprobante({ impuesto, datos, formato, totales }: PropsHojaComprobante & { impuesto: 'iva' | 'isae'; totales: TotalesComprobante }) {
  const cols = columnasComprobante(impuesto === 'iva' ? 'comp_iva' : 'comp_isae', formato);
  const ancho = cols.reduce((a, c) => a + c.ancho, 0);
  return (
    <table className={`hv8-t ${impuesto}`} style={{ width: ancho }}>
      <colgroup>{cols.map((c) => <col key={c.id} style={{ width: c.ancho }} />)}</colgroup>
      <thead>
        <tr>{cols.map((c) => <th key={c.id} className={cx(c.rotuloCentrado && 'hc')}><Lineas texto={c.rotulo} /></th>)}</tr>
      </thead>
      <tbody>
        {datos.filas.map((f, i) => (
          <tr key={i}>
            {cols.map((c) => <td key={c.id} className={cx(c.numero && 'n', c.centrado && 'c', c.negrita && 'b')}>{celdaComprobante(c, f, impuesto)}</td>)}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>{cols.map((c) => <td key={c.id} className="n">{c.total ? totalCelda(c, totales, impuesto) : ''}</td>)}</tr>
      </tfoot>
    </table>
  );
}

/** El recuadro aparte del impuesto retenido. */
function TablaRetenido({ rotulo, datos, totales }: { rotulo: string | undefined; datos: DatosComprobante; totales: TotalesComprobante }) {
  return (
    <table className="hv8-t hv8-rett">
      <thead><tr><th className="hc"><Lineas texto={rotulo} /></th></tr></thead>
      <tbody>{datos.filas.map((f, i) => <tr key={i}><td className="n">{n2(f.retenido)}</td></tr>)}</tbody>
      <tfoot><tr><td className="n">{n2(totales.retenido)}</td></tr></tfoot>
    </table>
  );
}

/** Comprobante de retención de IVA (1 hoja). */
export function HojaComprobanteIva({ datos: d, formato }: PropsHojaComprobante) {
  const x = formato.textos;
  const tot = totalesComprobante(d.filas, d.totales);
  return (
    <div className="hv8 hv8-iva">
      <p className="a b" style={{ top: 26, left: 0, width: '100%', textAlign: 'center' }}>{x.leg1}</p>
      <p className="a" style={{ top: 41, left: 120, width: 816, textAlign: 'center', fontSize: 12, lineHeight: '15.5px' }}>{x.leg2}<br />{x.leg3}</p>
      <p className="a" style={{ top: 79, left: 80, width: 842, textAlign: 'center', lineHeight: '13.5px', fontSize: 11.2 }}>{x.art}</p>
      <h1 className="a hv8-tit" style={{ top: 110, left: 0, width: '100%', textAlign: 'center' }}>{x.titulo}</h1>
      <div className="a caja c" style={{ top: 133, left: 272, width: 203, height: 40, paddingTop: 5 }}>{x.nroComp}<br /><b>{d.numero}</b></div>
      <div className="a caja c" style={{ top: 133, left: 537, width: 186, height: 40, paddingTop: 5 }}>{x.fecha}<br /><b>{fechaVe(d.fecha)}</b></div>
      <div className="a caja" style={{ top: 133, left: 761, width: 186, height: 40, paddingTop: 5 }}>
        <span style={{ paddingLeft: 28 }}>{x.periodo}</span><br />
        <b style={{ paddingLeft: 3 }}>{`${x.anio} ${d.periodo.anio}`}</b>
        <b style={{ marginLeft: 32 }}>{`${x.mes} ${d.periodo.mes}`}</b>
      </div>
      <div className="a caja" style={{ top: 174, left: 27, width: 1004, height: 80 }}>
        <b className="a" style={{ top: 7, left: 30 }}>{x.agNombre}</b>
        <span className="a" style={{ top: 23, left: 29 }}>{d.agente.razon}</span>
        <b className="a" style={{ top: 43, left: 30 }}>{x.agDir}</b>
        <span className="a" style={{ top: 58, left: 29 }}>{d.agente.direccion}</span>
        <b className="a" style={{ top: 7, left: 539 }}>{x.agRif}</b>
        <span className="a" style={{ top: 22, left: 539 }}>{d.agente.rif}</span>
      </div>
      <div className="a caja" style={{ top: 257, left: 27, width: 1004, height: 80 }}>
        <b className="a" style={{ top: 7, left: 30 }}>{x.sjNombre}</b>
        <span className="a" style={{ top: 22, left: 29 }}>{d.sujeto.nombre}</span>
        <b className="a" style={{ top: 43, left: 30 }}>{x.sjDir}</b>
        <span className="a recorte" style={{ top: 58, left: 29, width: 820 }}>{d.sujeto.direccion}</span>
        <b className="a" style={{ top: 7, left: 539 }}>{x.sjRif}</b>
        <span className="a" style={{ top: 22, left: 539 }}>{d.sujeto.rif}</span>
      </div>
      <div className="a" style={{ top: 369, left: 12 }}><TablaComprobante impuesto="iva" datos={d} formato={formato} totales={tot} /></div>
      <div className="a hv8-ret" style={{ top: 369, left: 955, width: 84 }}><TablaRetenido rotulo={x.retenido} datos={d} totales={tot} /></div>
      <p className="a b" style={{ top: 467, left: 60, width: 880, textAlign: 'center', lineHeight: '14px' }}>{x.pie}</p>
      <div className="a caja" style={{ top: 700, left: 27, width: 1004, height: 59 }}>
        <b className="a" style={{ top: 9, left: 8, fontSize: 12, whiteSpace: 'pre' }}>{`${x.fechaEmision}  ${fechaVe(d.fecha)}`}</b>
        <span className="a" style={{ top: 8, left: 262 }}><Firma formato={formato} firma={d.firma} /></span>
        <span className="a divisor" style={{ left: 499 }} />
        <b className="a" style={{ top: 9, left: 510, fontSize: 12 }}>{x.fechaEntrega}</b>
      </div>
      <p className="a" style={{ top: 773, left: 12 }}>{d.agente.razon}</p>
    </div>
  );
}

/** Comprobante de retención de ISLR (1 hoja). */
export function HojaComprobanteIslr({ datos: d, formato }: PropsHojaComprobante) {
  const x = formato.textos;
  const tot = totalesComprobante(d.filas, d.totales);
  const cols = columnasComprobante('comp_islr', formato);
  const usado = cols.reduce((a, c) => a + c.ancho, 0);
  const celda = (c: DefColumna, f: FilaComprobante) =>
    c.id === 'fecha' ? fechaVe(f.fecha) : c.numero || c.id === 'pct' ? n2(Number(valorFila(f, c.id)) || 0) : texto(valorFila(f, c.id));
  return (
    <div className="hv8 hv8-islr">
      <h1 className="a hv8-tit" style={{ top: 22, left: 110, fontSize: 17 }}>{x.titulo}</h1>
      {x.subtitulo && (
        <p className="a" style={{ top: 47, left: 110, fontSize: 10, color: '#333', maxWidth: 850 }}>{x.subtitulo}</p>
      )}
      <div className="a caja" style={{ top: 72, left: 553, width: 430, height: 64 }}>
        <span className="a" style={{ top: 5, left: 6 }}>{x.nroComp}</span>
        <b className="a" style={{ top: 5, left: 229 }}>{d.numero}</b>
        <span className="a" style={{ top: 27, left: 6 }}>{x.periodo}</span>
        <b className="a" style={{ top: 28, left: 145 }}>{`${x.anio} ${d.periodo.anio}`}</b>
        <b className="a" style={{ top: 43, left: 145 }}>{`${x.mes} ${d.periodo.mes}`}</b>
        <span className="a" style={{ top: 27, left: 243 }}>{x.fecha}</span>
        <b className="a" style={{ top: 28, left: 294 }}>{fechaVe(d.fecha)}</b>
      </div>
      <div className="a caja" style={{ top: 139, left: 12, width: 971, height: 84 }}>
        <b className="a" style={{ top: 8, left: 11 }}>{x.agNombre}</b>
        <span className="a" style={{ top: 24, left: 11 }}>{d.agente.razon}</span>
        <b className="a" style={{ top: 44, left: 11 }}>{x.agDir}</b>
        <span className="a" style={{ top: 60, left: 11 }}>{d.agente.direccion}</span>
        <b className="a" style={{ top: 8, left: 383 }}>{x.agRif}</b>
        <span className="a" style={{ top: 23, left: 383 }}>{d.agente.rif}</span>
      </div>
      <div className="a caja" style={{ top: 225, left: 12, width: 971, height: 80 }}>
        <b className="a" style={{ top: 8, left: 11 }}>{x.sjNombre}</b>
        <span className="a" style={{ top: 24, left: 11 }}>{d.sujeto.nombre}</span>
        <b className="a" style={{ top: 44, left: 11 }}>{x.sjDir}</b>
        <span className="a recorte" style={{ top: 60, left: 11, width: 710 }}>{d.sujeto.direccion}</span>
        <b className="a" style={{ top: 8, left: 383 }}>{x.sjRif}</b>
        <span className="a" style={{ top: 23, left: 383 }}>{d.sujeto.rif}</span>
      </div>
      <p className="a" style={{ top: 313, left: 23 }}>{x.porConcepto}</p>
      <table className="a hv8-islr-t" style={{ top: 329, left: 12, width: 971 }}>
        <colgroup>
          {cols.map((c) => <col key={c.id} style={{ width: c.ancho }} />)}
          <col style={{ width: Math.max(0, 971 - usado) }} />
        </colgroup>
        <thead>
          <tr>
            {cols.map((c) => <th key={c.id} className={cx(c.numero && 'n', c.rotuloCentrado && 'hc', c.sangria && 'pl')}>{c.rotulo[0]}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {d.filas.map((f, i) => (
            <tr key={i}>
              {cols.map((c) => <td key={c.id} className={cx(c.numero && 'n', c.sangria && 'pl')}>{celda(c, f)}</td>)}
              <td />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            {cols.map((c, i) => {
              // «Total...» va en la celda que precede al monto base
              const antesDeBase = cols[i + 1]?.id === 'base';
              return (
                <td key={c.id} className={cx((c.numero || antesDeBase) && 'n')}>
                  {c.id === 'base' || c.id === 'retenido' ? n2(tot[c.id]) : antesDeBase ? <span className="tot">{x.total}</span> : ''}
                </td>
              );
            })}
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="a caja" style={{ top: 698, left: 12, width: 395, height: 60, fontSize: 12.7 }}>
        <b className="a" style={{ top: 6, left: 11 }}>{x.agente}</b>
        <span className="a" style={{ top: 23, left: 11 }}>{x.por}</span>
        <span className="a" style={{ top: 39, left: 11 }}>{d.agente.rif}</span>
        <span className="a" style={{ top: 6, left: 188 }}><Firma formato={formato} firma={d.firma} /></span>
      </div>
      <div className="a caja" style={{ top: 698, left: 409, width: 574, height: 60, fontSize: 12.7 }}>
        <b className="a" style={{ top: 6, left: 8 }}>{x.sujeto}</b>
        <span className="a" style={{ top: 23, left: 8 }}>{`${x.por} ${d.sujeto.nombre}`}</span>
        <span className="a" style={{ top: 39, left: 8 }}>{d.sujeto.rif}</span>
      </div>
      <p className="a" style={{ top: 772, left: 12, fontSize: 10 }}>{d.agente.razon}</p>
    </div>
  );
}

/** Comprobante de retención de ISAE (1 hoja). */
export function HojaComprobanteIsae({ datos: d, formato }: PropsHojaComprobante) {
  const x = formato.textos;
  const tot = totalesComprobante(d.filas, d.totales);
  const logo = formato.logoEnte && d.logoEnte?.src ? d.logoEnte : null;
  return (
    <div className="hv8 hv8-isae">
      <div className={cx('a hv8-logo', !logo && 'vacio')} style={{ top: 40, left: 50, width: 150, height: 67 }}>
        {logo ? <img src={logo.src} alt={logo.alt ?? 'Logo de la Alcaldía'} /> : 'Logo de la Alcaldía'}
      </div>
      <h1 className="a hv8-tit" style={{ top: 31, left: 225, fontSize: 18 }}>{x.titulo}</h1>
      <p className="a" style={{ top: 52, left: 225, width: 705, lineHeight: '14px' }}>{x.ordenanza}</p>
      <div className="a caja" style={{ top: 125, left: 18, width: 406, height: 90 }}>
        <b className="a" style={{ top: 7, left: 9 }}><span className="pq">{x.r2}</span> {x.agNombre}</b>
        <span className="a" style={{ top: 23, left: 9 }}>{d.agente.razon}</span>
        <b className="a" style={{ top: 39, left: 9 }}>{x.agDir}</b>
        <span className="a" style={{ top: 55, left: 9, width: 392, lineHeight: '15px' }}>{d.agente.direccion}</span>
      </div>
      <div className="a caja" style={{ top: 117, left: 429, width: 255, height: 39, padding: '3px 4px' }}>
        <RotuloNumerado texto={x.r3} /><br /><b className="c" style={{ display: 'block' }}>{d.agente.licencia ?? ''}</b>
      </div>
      <div className="a caja" style={{ top: 117, left: 735, width: 201, height: 39, padding: '3px 2px' }}>
        {x.r1}<br /><b style={{ paddingLeft: 32 }}>{numeroIsae(d.numero, d.fecha)}</b>
      </div>
      <div className="a caja" style={{ top: 165, left: 429, width: 186, height: 39, padding: '3px 4px' }}><b>{x.r4}</b><br />{d.agente.rif}</div>
      <div className="a caja" style={{ top: 165, left: 650, width: 185, height: 39, padding: '3px 8px' }}>{x.r5}<br /><b>{fechaVe(d.fecha)}</b></div>
      <div className="a caja" style={{ top: 165, left: 843, width: 184, height: 39, padding: '3px 6px' }}>
        <RotuloNumerado texto={x.r11} /><br />
        <b style={{ whiteSpace: 'pre' }}>{`${x.anio}  ${d.periodo.anio}`}</b>
        <b style={{ marginLeft: 24, whiteSpace: 'pre' }}>{`${x.mes}   ${d.periodo.mes}`}</b>
      </div>
      <div className="a caja" style={{ top: 213, left: 18, width: 1022, height: 82 }}>
        <b className="a" style={{ top: 6, left: 4 }}>{x.r7}</b>
        <span className="a" style={{ top: 22, left: 4 }}>{d.sujeto.nombre}</span>
        <b className="a" style={{ top: 6, left: 549 }}>{x.r9}</b>
        <span className="a" style={{ top: 22, left: 549 }}>{d.sujeto.rif}</span>
        <b className="a" style={{ top: 41, left: 4 }}>{x.r12}</b>
        <span className="a recorte" style={{ top: 57, left: 4, width: 800 }}>{d.sujeto.direccion}</span>
        <div className="a caja" style={{ top: 28, left: 805, width: 103, height: 40, padding: '2px 3px' }}>
          <RotuloNumerado texto={x.r8} /><br /><b>{d.sujeto.licencia ?? ''}</b>
        </div>
        <div className="a caja" style={{ top: 28, left: 913, width: 96, height: 40, padding: '2px 3px' }}>
          <b style={{ paddingLeft: 14 }}>{x.id}</b><br /><b>{d.sujeto.idMunicipal ?? ''}</b>
        </div>
      </div>
      <div className="a caja c hv8-compras" style={{ top: 323, left: 727, width: 224, height: 26 }}>{x.compras}</div>
      <div className="a" style={{ top: 353, left: 18 }}><TablaComprobante impuesto="isae" datos={d} formato={formato} totales={tot} /></div>
      <div className="a hv8-ret" style={{ top: 353, left: 955, width: 74 }}><TablaRetenido rotulo={x.retenido} datos={d} totales={tot} /></div>
      <div className="a caja" style={{ top: 698, left: 12, width: 513, height: 60, fontSize: 12.7 }}>
        <b className="a" style={{ top: 6, left: 9 }}>{x.agente}</b>
        <span className="a" style={{ top: 23, left: 9, whiteSpace: 'pre' }}>{`${x.por}  ${d.agente.razon}`}</span>
        <span className="a" style={{ top: 39, left: 9 }}>{d.agente.rif}</span>
        <span className="a" style={{ top: 6, left: 275 }}><Firma formato={formato} firma={d.firma} /></span>
      </div>
      <div className="a caja" style={{ top: 698, left: 527, width: 513, height: 60, fontSize: 12.7 }}>
        <b className="a" style={{ top: 6, left: 9 }}>{x.sujeto}</b>
        <span className="a" style={{ top: 23, left: 9 }}>{`${x.por} ${d.sujeto.nombre}`}</span>
        <span className="a" style={{ top: 39, left: 9 }}>{d.sujeto.rif}</span>
        <span className="a" style={{ top: 45, right: 4, fontSize: 8 }}>{x.firmaSujeto}</span>
      </div>
      <p className="a" style={{ top: 771, left: 13, fontSize: 12.7 }}>{d.agente.razon}</p>
    </div>
  );
}

const HOJAS = { iva: HojaComprobanteIva, islr: HojaComprobanteIslr, isae: HojaComprobanteIsae } as const;

/** La hoja del comprobante de su impuesto. */
export function HojaComprobante({ datos, formato }: PropsHojaComprobante) {
  const Hoja = HOJAS[datos.impuesto];
  return <Hoja datos={datos} formato={formato} />;
}

/** El comprobante en su hoja carta; en vertical, la misma hoja reducida al ancho. */
export function PaginaComprobante({ datos, formato, orientacion }: PropsHojaComprobante & { orientacion: Orientacion }) {
  return (
    <div className={`hv8-pagina ${orientacion}`}>
      <div className="hv8-escala"><HojaComprobante datos={datos} formato={formato} /></div>
    </div>
  );
}
