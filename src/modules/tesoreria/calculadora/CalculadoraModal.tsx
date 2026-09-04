/* ============================================================
   MGG · Tesorería · Calculadora

   Salió de TesoreriaPage.tsx (6.820 líneas), donde vivía entre las 3602 y 3866.

   El cálculo NO vive acá: lo hace `calcular()` de `@/shared/lib/calculo`, que es
   puro y se testea sin React. Este archivo junta las tasas que MGG ya tiene,
   se las pasa, y pinta el resultado.

   ESTO INFORMA, NO VALORA. Ninguna cuenta hecha acá se guarda en un documento
   ni decide cuánto vale una compra: es una herramienta de escritorio. Lo que
   valora sigue siendo el camino de siempre.
   ============================================================ */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { getTasaHoy, getTasasMercado, type TasasMercado } from '../tasas.repository';
import { calcular } from '@/shared/lib/calculo';
import { aceptaLetra, mapasDeCalculo, nombreDeCalculo, simboloDeCalculo } from './tasasParaCalculo';
/* Acá vivía `evalExpr`, un shunting-yard sobre números planos, hasta el
   04/09/2026. Hacía `replace(/,/g, '.')` sobre toda la expresión y leía con
   `parseFloat`, así que «2.000» —dos mil, con el separador de miles de acá—
   daba 2. Y no fallaba: devolvía el número equivocado con total confianza. */

const CALC_FMT = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 6 });

/**
 * Un resultado de la cinta, escrito.
 *
 * `Bs 80.739` y `1,25` son cosas distintas: lo primero es plata y lo segundo una
 * proporción. Mostrar las dos igual invita a leer una razón como si fuera un monto.
 */
const fmtResultado = (h: { result: number; enBs: boolean }) =>
  (h.enBs ? `Bs ${CALC_FMT(h.result)}` : CALC_FMT(h.result));

/**
 * El resultado, escrito de forma que el motor lo vuelva a leer EXACTAMENTE igual.
 *
 * `String(1234.567)` da «1234.567», y esa cadena releída es un millón doscientos
 * mil: el punto con tres dígitos detrás es separador de miles acá. O sea que
 * apretar «=» sobre un resultado de tres decimales lo multiplicaba por mil. Por
 * eso no se reusa `String()`: se escribe sin separador de miles y con coma
 * decimal, que es la única forma que el motor lee sin ambigüedad. `toFixed`
 * además evita la notación científica, que el motor no entiende.
 */
/**
 * Deja de un texto pegado solo lo que la calculadora puede leer.
 *
 * Un monto copiado de una tabla o de un correo viene con «Bs», con espacios que
 * no son espacios (el que separa los miles en es-VE es U+00A0), con saltos de
 * línea o con paréntesis de contabilidad. Pegarlo tal cual solo produce un error,
 * y pegar es de esas cosas que uno espera que funcionen.
 */
function limpiarPegado(texto: string): string {
  return (texto ?? '')
    .replace(/ /g, ' ')
    .replace(/[×✕✖]/g, '×')
    .replace(/[÷]/g, '÷')
    .replace(/[^\d.,+\-*/()%×÷$€\sA-Za-zÁÉÍÓÚáéíóúÑñ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function paraReusar(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

export function CalculadoraModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ expr: string; result: number; enBs: boolean; leida: string }[]>([]);
  const [exporting, setExporting] = useState(false);
  // Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). Carga sus tasas.
  const [usdConv, setUsdConv] = useState('');
  const [mercadoCalc, setMercadoCalc] = useState<TasasMercado | null>(null);
  const [bcvEur, setBcvEur] = useState<number | null>(null);
  // `cargando` evita el aviso más desconcertante posible: en el primer render
  // ninguna tasa llegó todavía, así que la pantalla anunciaba que HOY no hay
  // tasa de ninguna moneda. Es falso y dura menos de un segundo, pero es lo
  // primero que se lee al abrir.
  const [cargandoTasas, setCargandoTasas] = useState(true);
  useEffect(() => {
    let vivo = true;
    Promise.allSettled([getTasasMercado(), getTasaHoy()]).then(([mercado, hoy]) => {
      if (!vivo) return;
      setMercadoCalc(mercado.status === 'fulfilled' ? mercado.value : null);
      // El euro vive en `getTasaHoy()`, no en las tasas de mercado. Estaba
      // disponible desde siempre y la calculadora no lo usaba.
      setBcvEur(hoy.status === 'fulfilled' ? hoy.value.eur : null);
      setCargandoTasas(false);
    });
    return () => { vivo = false; };
  }, []);
  const bcv = mercadoCalc?.bcvUsd ?? null;
  const binance = mercadoCalc?.usdtVes ?? null;
  const fmtBs = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ── El motor y sus tasas ──
     Se rearma cuando llegan las tasas: hasta entonces solo entiende bolívares,
     que es la verdad —sin tasa no se puede convertir— en vez de inventar una. */
  const mapas = useMemo(() => mapasDeCalculo({
    bcvUsd: bcv, bcvEur, usdtVes: binance, copPorUsd: mercadoCalc?.copUsd ?? null,
  }), [bcv, bcvEur, binance, mercadoCalc]);

  /**
   * Evalúa una cuenta. Devuelve también si el resultado es DINERO, porque un
   * monto y una proporción no se muestran igual: `1,25` es una razón y
   * `Bs 1.234,56` es plata.
   */
  const evaluar = useCallback((texto: string) => {
    const r = calcular(texto, mapas.alias, mapas.enBolivares, nombreDeCalculo, simboloDeCalculo);
    if (!r) return null;
    return { bs: r.valor.bs, enBs: r.valor.dim === 1, leida: r.comoSeLeyo };
  }, [mapas]);

  const press = useCallback((val: string) => {
    setError(null);
    if (val === 'C') { setExpr(''); setResult('0'); return; }
    if (val === '⌫') { setExpr((e) => e.slice(0, -1)); return; }
    if (val === '=') {
      /* Los efectos (guardar en la cinta, fijar el resultado) van ACÁ y no dentro
         del updater de `setExpr`. Un updater tiene que ser una función pura de
         estado a estado: React lo invoca dos veces en desarrollo para detectar
         justamente esto, y con los efectos adentro cada «=» agregaba DOS
         renglones idénticos a la cinta. */
      const cur = expr.trim();
      if (!cur) return;
      try {
        const r = evaluar(cur);
        if (!r) return;
        setResult(CALC_FMT(r.bs));
        setHistory((h) => [{ expr: cur, result: r.bs, enBs: r.enBs, leida: r.leida }, ...h].slice(0, 200));
        // Si el resultado es dinero, vuelve al renglón CON su unidad. Sin el
        // «bs», seguir operando lo trataría como número suelto y la cuenta
        // siguiente tomaría la moneda del otro sumando: 80.739 pasaría a ser
        // dólares y el error sería de tres órdenes de magnitud.
        setExpr(r.enBs ? `${paraReusar(r.bs)} bs` : paraReusar(r.bs));
      } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
      return;
    }
    setExpr((e) => e + val);
  }, [evaluar, expr]);

  /* Resultado en vivo mientras se escribe (sin presionar =).
     `incompleta` distingue «todavía no cierra» de «no hay nada escrito», y no es
     un detalle: antes, con la cuenta a medias el visor caía al resultado
     ANTERIOR y mostraba un número viejo como si fuera el de la cuenta en curso.
     En una calculadora de plata, un número que no corresponde es peor que
     ninguno — así que mientras no cierre se muestra un guion. */
  const preview = useMemo(() => {
    const cur = expr.trim();
    if (!cur) return null;
    try {
      const r = evaluar(cur);
      return r ? { texto: r.enBs ? `Bs ${CALC_FMT(r.bs)}` : CALC_FMT(r.bs), leida: r.leida } : null;
    } catch { return { texto: '—', leida: '', incompleta: true }; }
  }, [expr, evaluar]);

  // Soporte de teclado.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // El listener vive en `window`, así que tambien oye lo que se escribe en el
      // campo del conversor USD→Bs que está más abajo en este mismo modal. Sin
      // esta guarda, teclear «9.50» ahí lo mandaba TAMBIÉN a la expresión de la
      // calculadora. Ya pasaba con los dígitos; al aceptar letras sería peor.
      const dest = ev.target as HTMLElement | null;
      if (dest && (/^(INPUT|TEXTAREA|SELECT)$/.test(dest.tagName) || dest.isContentEditable)) return;

      const k = ev.key;

      /* Copiar y pegar. El visor es un div, así que el navegador no los ofrece
         solo: hay que atenderlos. Copiar da el RESULTADO —que es lo que uno
         quiere llevarse a otra parte— y pegar limpia lo que venga, porque un
         monto copiado de una tabla trae «Bs», espacios raros y hasta saltos. */
      if (ev.ctrlKey || ev.metaKey) {
        const t = k.toLowerCase();
        if (t === 'c') {
          ev.preventDefault();
          const texto = (expr.trim() && preview ? preview.texto : result).replace(/^Bs\s*/, '');
          navigator.clipboard?.writeText(texto).then(
            () => toast('Resultado copiado', 'success'),
            () => toast('No se pudo copiar', 'error'),
          );
        } else if (t === 'v') {
          ev.preventDefault();
          navigator.clipboard?.readText().then(
            (txt) => { const limpio = limpiarPegado(txt); if (limpio) press(limpio); },
            () => toast('No se pudo pegar', 'error'),
          );
        }
        return;
      }
      // El resto de los atajos (Alt+Tab y compañía) no son teclas de la cuenta.
      if (ev.altKey) return;

      // ANCLADO. Sin los delimitadores, /[0-9]/ pregunta si la tecla CONTIENE un
      // dígito: «F2», «F3» y «F12» pasaban la prueba y se insertaban enteras en
      // la cuenta.
      if (/^[0-9]$/.test(k)) press(k);
      // Se escribe lo que se teclea: el motor entiende coma y punto, y ver en
      // pantalla algo distinto de lo que uno puso es la forma de desconfiar.
      else if (k === '.' || k === ',') press(k);
      else if (k === '+') press('+');
      else if (k === '-') press('-');
      else if (k === '*') press('×');
      else if (k === '/') press('÷');
      else if (k === '(' || k === ')') press(k);
      else if (k === 'Enter' || k === '=') { ev.preventDefault(); press('='); }
      else if (k === 'Backspace') press('⌫');
      else if (k === 'Escape') { press('C'); }
      else if (k === '%') press('%');
      // Las monedas se escriben con letras y símbolos. Sin esto, «100 $» no se
      // puede teclear y el motor de monedas queda inalcanzable: el visor es un
      // div, así que TODO lo que se escribe pasa por acá.
      // La barra también activa el botón que quedó con el foco tras un clic, así
      // que sin preventDefault se repetía la última tecla apretada con el mouse.
      else if (k === ' ') { ev.preventDefault(); press(' '); }
      else if (k === '$' || k === '€') press(k);
      // Solo entran las letras que pueden llegar a formar una moneda del
      // catálogo. Dejar pasar cualquiera permite escribir «asdf», que no puede
      // terminar en otra cosa que un error del que uno se entera tarde.
      else if (k.length === 1 && /\p{L}/u.test(k)) { if (aceptaLetra(expr, k, mapas.alias)) press(k); }
      else return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `expr` y `mapas` entran a propósito: el filtro de letras mira lo que ya
    // está escrito, y sin ellos el manejador se quedaría con una copia vieja y
    // rechazaría teclas válidas. Resuscribir un listener por tecla no se nota.
  }, [press, expr, mapas, preview, result]);

  async function exportarPdf() {
    if (!history.length) { setError('No hay operaciones para exportar.'); return; }
    setExporting(true);
    try {
      const [{ jsPDF }, autoTableMod, logoMod] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'), import('@/shared/lib/pdfLogo'),
      ]);
      const autoTable = autoTableMod.default;
      const logo = await logoMod.loadLogoDataUrl().catch(() => null);
      const doc = new jsPDF({ unit: 'pt', format: 'letter' });
      const PAGE_W = doc.internal.pageSize.getWidth();
      const MARGIN = 42.52; let y = MARGIN;
      const LOGO = 60; const TX = logo ? MARGIN + LOGO + 14 : MARGIN;
      if (logo) { try { doc.addImage(logo, 'JPEG', MARGIN, y, LOGO, LOGO); } catch { /* logo opcional */ } }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
      doc.text('CALCULADORA · OPERACIONES', TX, y + 18);
      doc.setFontSize(10); doc.setFont('helvetica', 'normal');
      doc.text(`Generado: ${dateTime(new Date().toISOString())}`, TX, y + 36);
      y += Math.max(LOGO, 42) + 8;
      doc.setDrawColor(255, 138, 0); doc.setLineWidth(1.5); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 14;
      doc.setFontSize(9);
      doc.text('Mineral Group Guayana C.A. · Sistema de Gestión de Inventarios', MARGIN, y);
      doc.text(actor, PAGE_W - MARGIN, y, { align: 'right' });
      // Más viejas arriba (orden cronológico).
      const filas = history.slice().reverse().map((h, idx) => [String(idx + 1), h.expr, fmtResultado(h)]);
      autoTable(doc, {
        startY: y + 8,
        head: [['#', 'Operación', 'Resultado']],
        body: filas,
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
        headStyles: { fillColor: [255, 138, 0], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 30, halign: 'right' }, 1: { cellWidth: 'auto', font: 'courier' }, 2: { cellWidth: 140, halign: 'right', fontStyle: 'bold' } },
      });
      doc.save('calculadora-operaciones.pdf');
      toast('PDF de operaciones descargado.', 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally { setExporting(false); }
  }

  const KEYS: { label: string; val: string; kind: 'num' | 'op' | 'act' | 'eq' }[] = [
    { label: 'C', val: 'C', kind: 'act' }, { label: '⌫', val: '⌫', kind: 'act' }, { label: '%', val: '%', kind: 'op' }, { label: '÷', val: '÷', kind: 'op' },
    { label: '7', val: '7', kind: 'num' }, { label: '8', val: '8', kind: 'num' }, { label: '9', val: '9', kind: 'num' }, { label: '×', val: '×', kind: 'op' },
    { label: '4', val: '4', kind: 'num' }, { label: '5', val: '5', kind: 'num' }, { label: '6', val: '6', kind: 'num' }, { label: '−', val: '-', kind: 'op' },
    { label: '1', val: '1', kind: 'num' }, { label: '2', val: '2', kind: 'num' }, { label: '3', val: '3', kind: 'num' }, { label: '+', val: '+', kind: 'op' },
    { label: '(', val: '(', kind: 'op' }, { label: '0', val: '0', kind: 'num' }, { label: ')', val: ')', kind: 'op' }, { label: ',', val: ',', kind: 'num' },
  ];

  /* Las monedas salen del CATÁLOGO DE TASAS, no de una lista escrita a mano:
     una moneda aparece el día que tiene tasa y desaparece sola si la pierde.
     Sin estos botones el motor de monedas solo sería alcanzable tecleando. */
  const MONEDAS = [...mapas.enBolivares.keys()].map((c) => ({ codigo: c, simbolo: simboloDeCalculo(c) }));

  return (
    <Modal title="Calculadora" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={exportarPdf} disabled={exporting || !history.length}>
          {exporting ? 'Generando…' : '🧾 Exportar PDF'}
        </button>
      </>
    }>
      {/* El Modal del sistema es de pantalla completa (96vw × 94vh) y sirve para
          las pantallas con tablas. Una calculadora no tiene con qué llenar eso:
          estirada a 1.200px los botones quedan enormes y el ojo no encuentra
          dónde apoyarse. Se acota el ancho y se centra.

          Las dos columnas salen con `auto-fit` + `minmax`, sin media query: en
          un teléfono cae sola a una columna en el orden correcto, y en escritorio
          el espacio de sobra lo ocupa la cinta en vez de estirar el teclado. */}
      <div style={{
        display: 'grid', gap: '1rem', alignItems: 'start',
        // `min(300px, 100%)` y no `300px` a secas: con el mínimo fijo, en un
        // teléfono angosto la columna no puede achicarse por debajo de 300px y
        // la pantalla se desborda a lo ancho. Con `min()` cede cuando hace falta.
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
        maxWidth: 880, margin: '0 auto',
      }}>
      <div>
      {/* Visor: expresión + resultado en vivo. */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: 0, textAlign: 'right', minHeight: 60 }}>
        <div className="mono" style={{ fontSize: '.95rem', color: 'var(--text-muted, #9aa4b2)', minHeight: '1.2rem', wordBreak: 'break-all' }}>{expr || ' '}</div>
        <strong className="mono" style={{ fontSize: '1.7rem', color: 'var(--text, #fff)', display: 'block', wordBreak: 'break-all' }}>
          {expr && preview != null ? preview.texto : result}
        </strong>
        {/* CÓMO SE LEYÓ LA CUENTA. El motor anterior interpretaba mal una
            expresión con monedas y devolvía un número con total confianza; ver
            la cuenta reescrita es la única forma de enterarse de que se entendió
            otra cosa. Solo aparece cuando difiere de lo tecleado. */}
        {preview?.leida && preview.leida.replace(/\s+/g, '') !== expr.trim().replace(/\s+/g, '') && (
          <div className="dim mono" style={{ fontSize: '.72rem', marginTop: '.15rem', wordBreak: 'break-all' }}>
            se leyó: {preview.leida}
          </div>
        )}
      </div>
      {error && <div className="muted" style={{ color: 'var(--danger)', fontSize: '.82rem', margin: '.35rem 0' }}>{error}</div>}
      {/* Las monedas sin tasa no se ofrecen: convertir a algo sin tasa no da un
          número, da un error, y ofrecerlo enseña a chocarse. Pero hay que decir
          por qué faltan, o parece que la calculadora no las conoce. */}
      {!cargandoTasas && mapas.sinTasa.length > 0 && (
        <div className="dim" style={{ fontSize: '.72rem', margin: '.3rem 0' }}>
          Sin tasa hoy, no se pueden usar: {mapas.sinTasa.map(nombreDeCalculo).join(', ')}
        </div>
      )}

      {/* Monedas. Van ANTES del teclado numérico porque el orden natural es
          «cuánto» y después «de qué»: se teclea el monto y se le pone la unidad. */}
      {MONEDAS.length > 1 && (
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.6rem' }}>
          {MONEDAS.map((m) => (
            <button key={m.codigo} type="button" className="btn btn-ghost btn-sm"
              onClick={() => press(` ${m.simbolo} `)}
              title={`Agregar ${nombreDeCalculo(m.codigo)}`}
              style={{ justifyContent: 'center', fontWeight: 700, color: 'var(--primary, #ff8a00)', flex: '1 1 0', minWidth: 46, minHeight: 34 }}>
              {m.simbolo}
            </button>
          ))}
        </div>
      )}

      {/* Teclado. `.btn` es inline-flex SIN justify-content, así que al estirarse
          en una celda de grilla la etiqueta se pega a la izquierda — que es como
          se veía. Se centra acá; 44px de alto es el mínimo cómodo para el dedo. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.5rem', marginTop: '.6rem' }}>
        {KEYS.map((k) => (
          <button key={k.label} type="button"
            className={k.kind === 'eq' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => press(k.val)}
            style={{
              justifyContent: 'center', padding: '0', minHeight: 46,
              fontSize: '1.05rem', fontWeight: 700,
              ...(k.kind === 'op' ? { color: 'var(--primary, #ff8a00)' } : {}),
              ...(k.kind === 'act' ? { color: 'var(--danger)' } : {}),
            }}>
            {k.label}
          </button>
        ))}
      </div>
      {/* La tecla más grande de la calculadora es la que se aprieta al final. */}
      <button type="button" className="btn btn-primary" onClick={() => press('=')}
        style={{ justifyContent: 'center', width: '100%', minHeight: 46, marginTop: '.5rem', fontSize: '1.1rem', fontWeight: 800 }}>
        =
      </button>

      </div>

      {/* Columna de referencia: lo que se consulta, no lo que se aprieta. */}
      <div>
      {/* Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '.84rem' }}>💵 USD → Bs</strong>
          <span className="muted" style={{ fontSize: '.78rem' }}>Monto $</span>
          <input className="input mono" type="number" min={0} step="any" style={{ width: 120 }}
            value={usdConv} onChange={(e) => setUsdConv(e.target.value)} placeholder="9.50" />
        </div>
        {(() => {
          const usd = Number(usdConv) || 0;
          const enBcv = bcv != null ? usd * bcv : null;
          const enBin = binance != null ? usd * binance : null;
          const margen = bcv != null && binance != null && binance > 0 ? ((binance - bcv) / binance) * 100 : null;
          const ahorroBs = enBcv != null && enBin != null ? enBin - enBcv : null;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.5rem', marginTop: '.5rem' }}>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>A BCV {bcv != null ? `(${fmtBs(bcv)})` : ''}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{enBcv != null ? `Bs ${fmtBs(enBcv)}` : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>A BINANCE {binance != null ? `(${fmtBs(binance)})` : ''}</div>
                <div className="mono" style={{ fontWeight: 700 }}>{enBin != null ? `Bs ${fmtBs(enBin)}` : '—'}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: '.66rem' }}>MARGEN DE AHORRO</div>
                <div className="mono" style={{ fontWeight: 700, color: margen != null && margen > 0 ? 'var(--success)' : 'var(--text-muted, #9aa4b2)' }}>
                  {margen != null ? `${fmtBs(margen)} %` : '—'}
                  {ahorroBs != null && ahorroBs > 0 && <span className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}> · ahorro Bs {fmtBs(ahorroBs)}</span>}
                </div>
              </div>
            </div>
          );
        })()}
        {(bcv == null || binance == null) && <div className="muted" style={{ fontSize: '.7rem', marginTop: '.3rem' }}>Si una tasa no aparece, actualizala desde Tesorería (↻).</div>}
        <div className="muted" style={{ fontSize: '.68rem', marginTop: '.35rem' }}>Margen = cuánto ahorrás pagando a BCV vs Binance: (Binance − BCV) ÷ Binance.</div>
      </div>

      {/* Cinta de operaciones (resultado junto a la operación). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '.8rem' }}>
        <strong style={{ fontSize: '.84rem' }}>Operaciones ({history.length})</strong>
        {history.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setHistory([])}>Limpiar</button>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginTop: '.3rem' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <tbody>
            {!history.length && <tr><td className="muted" style={{ textAlign: 'center' }}>Sin operaciones aún.</td></tr>}
            {history.map((h, idx) => (
              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setExpr(h.enBs ? `${paraReusar(h.result)} bs` : paraReusar(h.result))}
                title="Usar este resultado">
                <td className="mono" style={{ color: 'var(--text-muted, #9aa4b2)' }}>{h.expr}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text, #fff)' }}>= {fmtResultado(h)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
      </div>
    </Modal>
  );
}
