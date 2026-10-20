/* ============================================================
   MGG · Retenciones v8 · Marcar declarado y reabrir un período

   `dlg-declarar` de la maqueta v8 (l. 1576-1590): fecha, planilla, N° de
   declaración, monto enterado (obligatorio; 0 si no hubo operaciones) y
   observación. Reabrir: en la maqueta pide el motivo con un `prompt`; aquí,
   un diálogo con el motivo obligatorio. Guardan con
   retencion_periodo_declarar y retencion_periodo_reabrir (la base decide el
   permiso y vuelve a comprobar cada regla).
   ============================================================ */

import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { money } from '@/shared/lib/format';
import type { Declaracion, PasoInicial, PeriodoRetencion } from '../datos/periodos';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { fechaVe } from '../pantalla/realizadasYLibro';
import { etiquetaPeriodo } from './modeloPeriodos';
import { validarDeclaracion, validarPasoInicial } from './validarDeclaracion';

const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });

export function DeclararDialogo({ p, onGuardar, onCerrar }: {
  p: PeriodoRetencion; onGuardar: (d: Declaracion) => Promise<void>; onCerrar: () => void;
}) {
  const [d, setD] = useState({
    fecha: hoyIso(), planilla: p.tipo === 'iva' ? '99035' : '', numero: '',
    monto: p.retenidoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), observacion: '',
  });
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarDeclaracion(d, p.hasta, hoyIso());
  const campo = (k: keyof typeof d) => ({ value: d[k], onChange: (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value })), 'aria-invalid': tocado && !!v.errores[k] });
  const err = (k: keyof typeof d) => (tocado && v.errores[k] ? <small className="rv8-error-campo" role="alert">{v.errores[k]}</small> : null);
  const guardar = async () => {
    setTocado(true);
    if (!v.declaracion) return;
    setGuardando(true); setError(null);
    try { await onGuardar(v.declaracion); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo marcar el período como declarado.'); setGuardando(false); }
  };
  return (
    <Modal title="Marcar período como declarado" size="sm" onClose={onCerrar} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      <div className="rv8-periodos-dlg">
        <p className="rv8-muted">{nombreImpuesto(p.tipo)} · {etiquetaPeriodo(p)} · vence el {fechaVe(p.vence)}</p>
        {p.retencionesVigentes === 0 && <p className="rv8-nota-modal">Período sin operaciones: la declaración se presenta igualmente (art. 15).</p>}
        <label className="rv8-campo"><span>Fecha de la declaración</span><input className="rv8-fecha" type="date" min={p.hasta} max={hoyIso()} {...campo('fecha')} />{err('fecha')}</label>
        <label className="rv8-campo"><span>Planilla</span><input className="rv8-texto" maxLength={20} {...campo('planilla')} />{err('planilla')}</label>
        <label className="rv8-campo"><span>N° de declaración</span><input className="rv8-texto" maxLength={30} {...campo('numero')} />{err('numero')}</label>
        <label className="rv8-campo"><span>Monto enterado (Bs, obligatorio; 0 si no hubo operaciones)</span><input className="rv8-texto" inputMode="decimal" {...campo('monto')} />{err('monto')}</label>
        <label className="rv8-campo"><span>Observación</span><input className="rv8-texto" placeholder="Sin observación" maxLength={300} {...campo('observacion')} />{err('observacion')}</label>
        <p className="rv8-huella">Al guardar, las retenciones registradas del período pasan a «Declarada». Queda registro de usuario y fecha.</p>
        {p.retenidoBs > 0 && <p className="rv8-huella">Retenido en el período: {money(p.retenidoBs, 'Bs')}{p.retenidoUsd ? ` · ${money(p.retenidoUsd, 'USD')}` : ''}.</p>}
        {error && <div className="aviso-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

export function ReabrirDialogo({ p, onGuardar, onCerrar }: { p: PeriodoRetencion; onGuardar: (motivo: string) => Promise<void>; onCerrar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorMotivo = !motivo.trim() ? 'Motivo de la reapertura requerido.' : motivo.trim().length > 300 ? 'Hasta 300 caracteres.' : null;
  const guardar = async () => {
    setTocado(true);
    if (errorMotivo) return;
    setGuardando(true); setError(null);
    try { await onGuardar(motivo.trim()); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo reabrir el período.'); setGuardando(false); }
  };
  return (
    <Modal title="Reabrir el período" size="sm" onClose={onCerrar} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Reabriendo…' : 'Reabrir'}</button>
    </>}>
      <div className="rv8-periodos-dlg">
        <p className="rv8-muted">{nombreImpuesto(p.tipo)} · {etiquetaPeriodo(p)} · declarado el {fechaVe(p.declaradoEn)}</p>
        <label className="rv8-campo"><span>Motivo de la reapertura de {nombreImpuesto(p.tipo)} {etiquetaPeriodo(p)}</span>
          <textarea className="rv8-texto" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-invalid={tocado && !!errorMotivo} />
          {tocado && errorMotivo && <small className="rv8-error-campo" role="alert">{errorMotivo}</small>}
        </label>
        <p className="rv8-huella">Las retenciones del período vuelven a «Registrada». La declaración anterior queda en el historial del período.</p>
        {error && <div className="aviso-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

/* ───────── El paso inicial (`dlg-arranque` de la maqueta, l. 1607-1622) ───────── */
export function PasoInicialDialogo({ k, onGuardar, onCerrar }: { k: string; onGuardar: (p: PasoInicial) => Promise<void>; onCerrar: () => void }) {
  const [d, setD] = useState({ inicio: '', nombre: '', ultimo: '', anteriores: true });
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = validarPasoInicial(d, hoyIso());
  const err = (c: keyof typeof d) => (tocado && v.errores[c] ? <small className="rv8-error-campo" role="alert">{v.errores[c]}</small> : null);
  const guardar = async () => {
    setTocado(true);
    if (!v.paso) return;
    setGuardando(true); setError(null);
    try { await onGuardar(v.paso); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo guardar el paso inicial.'); setGuardando(false); }
  };
  const siguiente = /^\d{1,14}$/.test(d.ultimo.trim()) ? String(Number(d.ultimo.trim()) + 1) : null;
  return (
    <Modal title="Paso inicial: período en curso" size="sm" onClose={onCerrar} footer={<>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      <div className="rv8-periodos-dlg">
        <p className="rv8-muted">{nombreImpuesto(k)}</p>
        <p className="rv8-nota-modal">Para alinearse con el otro sistema. Sin este paso, el impuesto no se usa en el registro.</p>
        <label className="rv8-campo"><span>Inicio del período en curso</span>
          <input className="rv8-fecha" type="date" min="2020-01-01" max={hoyIso()} value={d.inicio} onChange={(e) => setD((x) => ({ ...x, inicio: e.target.value }))} aria-invalid={tocado && !!v.errores.inicio} />
          <small className="rv8-huella">El cierre sale de la periodicidad del impuesto (quincena o mes).</small>{err('inicio')}</label>
        <label className="rv8-campo"><span>Nombre del período en el otro sistema</span>
          <input className="rv8-texto" maxLength={60} placeholder="Ej.: Octubre 2026, 1.ª quincena" value={d.nombre} onChange={(e) => setD((x) => ({ ...x, nombre: e.target.value }))} />{err('nombre')}</label>
        <label className="rv8-campo"><span>Último N° de comprobante emitido por el otro sistema en esta serie</span>
          <input className="rv8-texto" inputMode="numeric" style={{ fontFamily: 'var(--font-mono)' }} value={d.ultimo} onChange={(e) => setD((x) => ({ ...x, ultimo: e.target.value }))} aria-invalid={tocado && !!v.errores.ultimo} />
          <small className="rv8-huella">{siguiente ? `MGG empieza en el ${siguiente}.` : 'MGG empieza en el siguiente.'}</small>{err('ultimo')}</label>
        <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: '.85rem' }}>
          <input type="checkbox" checked={d.anteriores} onChange={(e) => setD((x) => ({ ...x, anteriores: e.target.checked }))} /> Los períodos anteriores se declararon en el otro sistema
        </label>
        <p className="rv8-huella">Un período no cruza de un mes a otro. Si el otro sistema tiene uno que lo cruza, se registra como dos.</p>
        {error && <div className="aviso-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
