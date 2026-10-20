/* ============================================================
   MGG · Retenciones · Impresión · Las relaciones (IVA, ISLR, ISAE)

   Trasladada de v8HojaRelacion (v8-1-formatos.js): cada hoja del ejemplar es
   un grupo de columnas, y la 2.ª hoja repite las mismas filas (decisión del
   usuario, 09:37). Qué columna va en qué hoja lo dice el formato. Cada fila
   mide lo mismo en todas las hojas: un nombre largo ocupa dos líneas también
   en la hoja 2. La cabecera es la del ejemplar, sin «Generado por…»
   (decisión del usuario, 09:37). El «Código» es el RIF.
   ============================================================ */

import { Fragment } from 'react';
import { FORMATO_FABRICA, FORMATO_RELACION, HOJA_RELACION, MARGEN_DERECHO_RELACION, gruposRelacion, type DefColumna } from './formatos';
import { fechaHoraRelacion, fechaVe, n2, pctRelacion } from './numeros';
import type { DatosRelacion, FilaRelacion, Orientacion } from './tipos';
import './hojas.css';

const ANCHO_HOJA = 1056;

function valor(c: DefColumna, f: FilaRelacion): string {
  if (c.id === 'codigo') return f.rif;
  if (c.id === 'fecha') return fechaVe(f.fecha);
  if (c.id === 'pct') return pctRelacion(f.pct);
  const v = (f as unknown as Record<string, unknown>)[c.id];
  if (c.numero) return n2(Number(v) || 0);
  return v == null ? '' : String(v);
}

export function HojaRelacion({ datos: d, orientacion }: { datos: DatosRelacion; orientacion: Orientacion }) {
  const formato = FORMATO_FABRICA[FORMATO_RELACION[d.impuesto]];
  const x = formato.textos, hoja = HOJA_RELACION[d.impuesto];
  const grupos = gruposRelacion(FORMATO_RELACION[d.impuesto], formato);
  const util = ANCHO_HOJA - hoja.izq - MARGEN_DERECHO_RELACION;
  const alto = (f: FilaRelacion) => 21 + (Math.max(1, Math.ceil(f.nombre.length / hoja.nombre)) - 1) * 13;
  const entre = x.entre.replace('{desde}', fechaVe(d.desde)).replace('{hasta}', fechaVe(d.hasta));

  return (
    <div className={`rv8 ${orientacion}`}>
      {grupos.map((g, gi) => {
        const ancho = g.reduce((a, c) => a + c.ancho, 0), n = g.length + 1;
        const pct = (w: number) => `${((w / util) * 100).toFixed(3)}%`;
        return (
          <table key={gi} className={`rv8-t${gi ? ' rv8-salto' : ''}`}
            style={{ marginLeft: hoja.izq, width: `calc(100% - ${hoja.izq + MARGEN_DERECHO_RELACION}px)` }}>
            <colgroup>
              {g.map((c) => <col key={c.id} style={{ width: pct(c.ancho) }} />)}
              <col style={{ width: pct(Math.max(0, util - ancho)) }} />
            </colgroup>
            <thead>
              <tr className="rv8-margen"><td colSpan={n} style={{ height: hoja.arriba }} /></tr>
              <tr>
                <td colSpan={n} className="rv8-cabtd">
                  <div className="rv8-cab" style={{ lineHeight: `${hoja.linea}px` }}>
                    <div>{d.empresa}<br />{x.titulo}<br />{x.modo}<br /><span style={{ whiteSpace: 'pre' }}>{entre}</span></div>
                    <div className="der" style={{ paddingTop: hoja.linea / 2, lineHeight: `${hoja.linea * 2}px` }}>{x.fecha.replace('{fecha}', fechaHoraRelacion(d.generado))}</div>
                  </div>
                </td>
              </tr>
              <tr className="rv8-banda"><td colSpan={g.length}>{gi === 0 ? x.banda : ''}</td><td className="rv8-relleno" /></tr>
              <tr className="rv8-cols">
                {g.map((c) => <th key={c.id} className={c.numero ? 'n' : undefined}>{c.rotulo.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</th>)}
                <th className="rv8-relleno" />
              </tr>
            </thead>
            <tbody>
              {d.filas.map((f, i) => (
                <tr key={i} style={{ height: alto(f) }}>
                  {g.map((c) => <td key={c.id} className={c.numero ? 'n' : undefined}>{valor(c, f)}</td>)}
                  <td className="rv8-relleno" />
                </tr>
              ))}
              {g.some((c) => c.total) && (
                <tr className="rv8-tot">
                  {g.map((c) => <td key={c.id} className="n">{c.total ? n2(d.filas.reduce((a, f) => a + (Number((f as unknown as Record<string, unknown>)[c.id]) || 0), 0)) : ''}</td>)}
                  <td className="rv8-relleno" />
                </tr>
              )}
            </tbody>
            <tfoot><tr className="rv8-margen-pie"><td colSpan={n} /></tr></tfoot>
          </table>
        );
      })}
    </div>
  );
}
