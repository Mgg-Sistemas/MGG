/* ============================================================
   MGG · Retenciones v8 · Reportes · La gráfica del análisis de un proveedor

   Traslado de v8HtmlAnalisis y v8SvgBarras (v8-14-analisis.js), repasada con
   la skill «dataviz» (la paleta, validada de nuevo el 20/10 en los dos temas):
   · barras por período apiladas por impuesto; el color sigue al impuesto (su
     lugar en el catálogo), nunca a su puesto en la gráfica; una trama
     direccional en el 2.º y 3.º impuesto (45° y 135°);
   · barras de 24 px como máximo, remate redondeado de 4 px arriba y base
     recta, 2 px de superficie entre tramos;
   · rejilla fina y recesiva en números redondos; rótulo directo solo en la
     barra mayor y la última; la tendencia, línea punteada de 2 px;
   · etiqueta flotante con el total primero, con el puntero y con el foco;
   · leyenda siempre, con el monto y el % de cada impuesto, y la tabla de los
     datos a la vista (el contraste del tema claro lo exige).
   ============================================================ */

import { useRef, useState } from 'react';
import { useAncho } from '../../impresion/useAncho';
import { money } from '@/shared/lib/format';
import { nombreImpuesto } from '../pendientesPorDocumento';
import { abreviar, ejeLimpio, tendencia, type SerieProveedor } from './analisis';
import './rv8-analisis.css';

const ORDEN_CATALOGO: Record<string, number> = { iva: 0, islr: 1, municipal: 2, regional: 3, igtf: 4 };
const TRAMAS = [null, 'r45', 'r135', null, null, null];
const claseImp = (k: string) => (ORDEN_CATALOGO[k] ?? 5) % 6;

export function GraficaProveedor({ serie: s, moneda, id }: { serie: SerieProveedor; moneda: string; id: string }) {
  const [activa, setActiva] = useState<number | null>(null);
  // Como la maqueta: el ancho del diálogo, entre 300 y 800 px
  const raiz = useRef<HTMLDivElement>(null);
  const ancho = Math.max(300, Math.min(800, useAncho(raiz, 760) - 24));
  const m = (v: number) => money(v, moneda);
  const tend = tendencia(s.por.map((x) => x.tot));
  const n = s.por.length;
  if (!s.nRet || !n) return <div ref={raiz}><p className="rv8-g-res">Sin retenciones a este proveedor en el rango.</p></div>;

  const izq = 52, paso = Math.max(12, Math.min(56, Math.floor((ancho - 64) / n))), barra = Math.min(24, Math.max(6, Math.round(paso * 0.6)));
  const H = 204, top = 22, alto = H - top - 40, W = izq + n * paso + 10;
  const { tope, paso: pt } = ejeLimpio(Math.max(...s.por.map((x) => x.tot), 0));
  const Y = (v: number) => top + alto - (Math.min(v, tope) / tope) * alto;
  const cada = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - izq) / 58))));
  const iMax = s.por.reduce((a, x, i) => (x.tot > s.por[a].tot ? i : a), 0);
  const rotular = new Set([iMax, n - 1].filter((i) => s.por[i].tot > 0));
  const marcas: number[] = [];
  for (let v = 0; v <= tope + 1e-9; v += pt) marcas.push(v);
  const centro = (i: number) => izq + i * paso + paso / 2;
  const con = s.por.filter((x) => x.tot).length;
  const punto = activa != null ? s.por[activa] : null;

  return (
    <div className="rv8-analisis" ref={raiz}>
      <p className="rv8-g-res">Total retenido: <b>{m(s.total)}</b> en {s.nRet} retención(es), con retenciones en {con} de {n} período(s).</p>
      <ul className="rv8-g-leyenda" aria-label="Total por impuesto">
        {s.ks.map((k) => (
          <li key={k}>
            <svg className="rv8-g-muestra" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect width="12" height="12" rx="2" className={`rv8-g-c${claseImp(k)}`} />
              {TRAMAS[claseImp(k)] && <rect width="12" height="12" rx="2" fill={`url(#${id}-${TRAMAS[claseImp(k)]})`} />}
            </svg>
            <span>{nombreImpuesto(k)}</span><b>{m(s.totK[k] ?? 0)}</b><small>{s.total ? Math.round(((s.totK[k] ?? 0) / s.total) * 100) : 0} %</small>
          </li>
        ))}
        {tend.pendiente != null && (
          <li><svg viewBox="0 0 22 14" width="22" height="14" aria-hidden="true"><line x1="1" y1="7" x2="21" y2="7" className="rv8-g-tend" /></svg><span>Tendencia</span></li>
        )}
      </ul>
      <div className="rv8-g-marco">
        <svg className="rv8-g" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="group" aria-label="Retenido por período, apilado por impuesto">
          <defs>
            <pattern id={`${id}-r45`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.6" height="6" className="rv8-g-trama" /></pattern>
            <pattern id={`${id}-r135`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="1.6" height="6" className="rv8-g-trama" /></pattern>
          </defs>
          {marcas.map((v) => (
            <g key={v}>
              <line x1={izq} x2={W - 6} y1={Y(v)} y2={Y(v)} className="rv8-g-rej" />
              <text x={izq - 6} y={Y(v) + 3.5} textAnchor="end" className="rv8-g-eje">{abreviar(v)}</text>
            </g>
          ))}
          {s.por.map((x, i) => {
            const x0 = centro(i) - barra / 2, base = top + alto;
            let y = base, primero = true;
            const tramos = s.ks.filter((k) => x.v[k]).map((k) => {
              const h = ((x.v[k] ?? 0) / tope) * alto, hv = Math.max(1, primero ? h : h - 2);
              y -= h; primero = false;
              return { k, y, hv };
            });
            const txt = `${x.largo}: ${s.ks.filter((k) => x.v[k]).map((k) => `${nombreImpuesto(k)} ${m(x.v[k])}`).join('; ') || 'sin retenciones'}${x.tot ? `; total ${m(x.tot)}` : ''}`;
            return (
              <g key={x.clave}>
                <g className="rv8-g-barra" tabIndex={0} role="img" aria-label={txt}
                  onPointerEnter={() => setActiva(i)} onPointerLeave={() => setActiva(null)} onFocus={() => setActiva(i)} onBlur={() => setActiva(null)}>
                  {x.tot > 0 && <clipPath id={`${id}-c${i}`}><rect x={x0} y={y} width={barra} height={base - y + 6} rx="4" /></clipPath>}
                  <rect x={izq + i * paso} y={top} width={paso} height={alto} className="rv8-g-zona" />
                  <g clipPath={x.tot > 0 ? `url(#${id}-c${i})` : undefined}>
                    {tramos.map((t) => (
                      <g key={t.k}>
                        <rect x={x0} y={t.y} width={barra} height={t.hv} className={`rv8-g-c${claseImp(t.k)}`} />
                        {TRAMAS[claseImp(t.k)] && <rect x={x0} y={t.y} width={barra} height={t.hv} fill={`url(#${id}-${TRAMAS[claseImp(t.k)]})`} />}
                      </g>
                    ))}
                  </g>
                </g>
                {rotular.has(i) && Y(x.tot) - 5 > 10 && <text x={centro(i)} y={y - 5} textAnchor="middle" className="rv8-g-val">{abreviar(x.tot)}</text>}
                {i % cada === 0 && <text x={centro(i)} y={H - 22} textAnchor="middle" className="rv8-g-eje">{x.et}</text>}
              </g>
            );
          })}
          {tend.pendiente != null && (
            <line x1={centro(0)} y1={Y(Math.max(0, tend.ordenada))} x2={centro(n - 1)} y2={Y(Math.max(0, tend.ordenada + tend.pendiente * (n - 1)))} className="rv8-g-tend" />
          )}
        </svg>
        {punto && activa != null && (
          <div className="rv8-g-tip" aria-hidden="true" style={{ left: Math.max(4, Math.min(centro(activa) - 70, W - 150)) }}>
            <b>{punto.tot ? m(punto.tot) : 'Sin retenciones'}</b>
            <div className="rv8-g-tip-per">{punto.largo}</div>
            {s.ks.filter((k) => punto.v[k]).map((k) => (
              <div key={k} className="rv8-g-tip-fila"><span className={`rv8-g-tip-clave rv8-g-k${claseImp(k)}`} /><span className="rv8-g-tip-val">{m(punto.v[k])}</span><span>{nombreImpuesto(k)}</span></div>
            ))}
          </div>
        )}
      </div>
      <p className="rv8-g-ayuda">Pasar el puntero por una barra, o enfocarla con Tab, muestra sus montos.</p>
      <p className="rv8-g-tend-txt"><b>Tendencia:</b> {tend.texto}</p>
      <div className="rv8-g-tabla">
        <table>
          <caption>Los datos de la gráfica</caption>
          <thead><tr><th scope="col">Período</th>{s.ks.map((k) => <th key={k} scope="col" className="n">{nombreImpuesto(k)}</th>)}<th scope="col" className="n">Total</th></tr></thead>
          <tbody>
            {s.por.map((x) => (
              <tr key={x.clave}><th scope="row">{x.largo}</th>{s.ks.map((k) => <td key={k} className="n">{x.v[k] ? m(x.v[k]) : '·'}</td>)}<td className="n"><b>{x.tot ? m(x.tot) : '·'}</b></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
