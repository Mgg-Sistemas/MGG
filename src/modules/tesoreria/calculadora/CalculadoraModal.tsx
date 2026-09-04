/* ============================================================
   MGG · Tesorería · Calculadora

   Sale de TesoreriaPage.tsx (6.820 líneas), donde vivía entre las líneas
   3602 y 3866. Se mueve SIN cambiar una sola línea de lógica: lo que hay que
   corregir va después, en su propio commit, para que el diff se pueda leer.
   ============================================================ */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { getTasasMercado, type TasasMercado } from '../tasas.repository';
/* ───────────── Calculadora (cinta de operaciones · export PDF) ───────────── */

/** Evalúa una expresión aritmética simple (+ − × ÷, decimales, paréntesis) sin usar eval. */
function evalExpr(input: string): number {
  const s = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.');
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i++; continue; }
    if ('+-*/()'.includes(ch)) {
      // Menos unario: al inicio o tras un operador / '(' → se trata como 0 - n.
      if (ch === '-' && (tokens.length === 0 || '+-*/('.includes(tokens[tokens.length - 1]))) tokens.push('0');
      tokens.push(ch); i++; continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = ch; i++;
      while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i++; }
      tokens.push(num); continue;
    }
    throw new Error('Operación inválida.');
  }
  // Shunting-yard → RPN.
  const out: string[] = []; const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const t of tokens) {
    if (/^[0-9.]+$/.test(t)) out.push(t);
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      if (!ops.length) throw new Error('Paréntesis desbalanceados.');
      ops.pop();
    } else {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop()!);
      ops.push(t);
    }
  }
  while (ops.length) { const o = ops.pop()!; if (o === '(') throw new Error('Paréntesis desbalanceados.'); out.push(o); }
  // Evaluar RPN.
  const st: number[] = [];
  for (const t of out) {
    if (/^[0-9.]+$/.test(t)) { const n = Number(t); if (!isFinite(n)) throw new Error('Número inválido.'); st.push(n); }
    else {
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Operación incompleta.');
      let r: number;
      switch (t) {
        case '+': r = a + b; break;
        case '-': r = a - b; break;
        case '*': r = a * b; break;
        case '/': if (b === 0) throw new Error('División entre 0.'); r = a / b; break;
        default: throw new Error('Operador inválido.');
      }
      st.push(r);
    }
  }
  if (st.length !== 1 || !isFinite(st[0])) throw new Error('Operación inválida.');
  return Math.round(st[0] * 1e6) / 1e6;
}

const CALC_FMT = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 6 });

export function CalculadoraModal({ actor, onClose }: { actor: string; onClose: () => void }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ expr: string; result: number }[]>([]);
  const [exporting, setExporting] = useState(false);
  // Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). Carga sus tasas.
  const [usdConv, setUsdConv] = useState('');
  const [mercadoCalc, setMercadoCalc] = useState<TasasMercado | null>(null);
  useEffect(() => { getTasasMercado().then(setMercadoCalc).catch(() => setMercadoCalc(null)); }, []);
  const bcv = mercadoCalc?.bcvUsd ?? null;
  const binance = mercadoCalc?.usdtVes ?? null;
  const fmtBs = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const press = useCallback((val: string) => {
    setError(null);
    if (val === 'C') { setExpr(''); setResult('0'); return; }
    if (val === '⌫') { setExpr((e) => e.slice(0, -1)); return; }
    if (val === '=') {
      setExpr((e) => {
        const cur = e.trim();
        if (!cur) return e;
        try {
          const r = evalExpr(cur);
          setResult(CALC_FMT(r));
          setHistory((h) => [{ expr: cur, result: r }, ...h].slice(0, 200));
          return String(r);
        } catch (err) { setError(err instanceof Error ? err.message : 'Error'); return e; }
      });
      return;
    }
    setExpr((e) => e + val);
  }, []);

  // Resultado en vivo mientras se escribe (sin presionar =).
  const preview = useMemo(() => {
    const cur = expr.trim();
    if (!cur) return null;
    try { return CALC_FMT(evalExpr(cur)); } catch { return null; }
  }, [expr]);

  // Soporte de teclado.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const k = ev.key;
      if (/[0-9]/.test(k)) press(k);
      else if (k === '.' || k === ',') press('.');
      else if (k === '+') press('+');
      else if (k === '-') press('-');
      else if (k === '*') press('×');
      else if (k === '/') press('÷');
      else if (k === '(' || k === ')') press(k);
      else if (k === 'Enter' || k === '=') { ev.preventDefault(); press('='); }
      else if (k === 'Backspace') press('⌫');
      else if (k === 'Escape') { press('C'); }
      else return;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

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
      const filas = history.slice().reverse().map((h, idx) => [String(idx + 1), h.expr, CALC_FMT(h.result)]);
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
    { label: 'C', val: 'C', kind: 'act' }, { label: '⌫', val: '⌫', kind: 'act' }, { label: '(', val: '(', kind: 'op' }, { label: ')', val: ')', kind: 'op' },
    { label: '7', val: '7', kind: 'num' }, { label: '8', val: '8', kind: 'num' }, { label: '9', val: '9', kind: 'num' }, { label: '÷', val: '÷', kind: 'op' },
    { label: '4', val: '4', kind: 'num' }, { label: '5', val: '5', kind: 'num' }, { label: '6', val: '6', kind: 'num' }, { label: '×', val: '×', kind: 'op' },
    { label: '1', val: '1', kind: 'num' }, { label: '2', val: '2', kind: 'num' }, { label: '3', val: '3', kind: 'num' }, { label: '−', val: '-', kind: 'op' },
    { label: '0', val: '0', kind: 'num' }, { label: '.', val: '.', kind: 'num' }, { label: '=', val: '=', kind: 'eq' }, { label: '+', val: '+', kind: 'op' },
  ];

  return (
    <Modal title="Calculadora" size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={exportarPdf} disabled={exporting || !history.length}>
          {exporting ? 'Generando…' : '🧾 Exportar PDF'}
        </button>
      </>
    }>
      {/* Visor: expresión + resultado en vivo. */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: 0, textAlign: 'right', minHeight: 60 }}>
        <div className="mono" style={{ fontSize: '.95rem', color: 'var(--muted)', minHeight: '1.2rem', wordBreak: 'break-all' }}>{expr || ' '}</div>
        <strong className="mono" style={{ fontSize: '1.7rem', color: 'var(--text, #fff)', display: 'block', wordBreak: 'break-all' }}>
          {expr && preview != null ? preview : result}
        </strong>
      </div>
      {error && <div className="muted" style={{ color: 'var(--danger)', fontSize: '.82rem', margin: '.35rem 0' }}>{error}</div>}

      {/* Teclado. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem', marginTop: '.6rem' }}>
        {KEYS.map((k) => (
          <button key={k.label} type="button"
            className={k.kind === 'eq' ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => press(k.val)}
            style={{
              padding: '.7rem 0', fontSize: '1.05rem', fontWeight: 700,
              ...(k.kind === 'op' ? { color: 'var(--brand, #ff8a00)' } : {}),
              ...(k.kind === 'act' ? { color: 'var(--danger)' } : {}),
            }}>
            {k.label}
          </button>
        ))}
      </div>

      {/* Conversor rápido USD → Bs (BCV / Binance + margen de ahorro). */}
      <div className="card" style={{ padding: '.6rem .8rem', marginTop: '.7rem' }}>
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
                <div className="mono" style={{ fontWeight: 700, color: margen != null && margen > 0 ? 'var(--success)' : 'var(--muted)' }}>
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
              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setExpr(String(h.result))} title="Usar este resultado">
                <td className="mono" style={{ color: 'var(--muted)' }}>{h.expr}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text, #fff)' }}>= {CALC_FMT(h.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
