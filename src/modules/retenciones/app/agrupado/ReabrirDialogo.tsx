/* ============================================================
   MGG · Retenciones v8 · Reabrir para corregir la compra (diálogo)

   El dlg-v8-reabrir de la maqueta (v8-15-reabrir.js, R3-20) con sus tres
   modos: reabrir (con motivo), bloqueado (declarada: primero el período) y
   revisar (comparar la compra de hoy con la de la reapertura y registrar de
   nuevo, anular y rehacer, o confirmar sin cambios). Lo abren las acciones de
   la casilla en la Vista agrupada.
   Reabrir y revisar necesitan la base de Retenciones (11b): sin su función,
   el botón va desactivado con la marca 2.1. Sin la capacidad, solo en local.
   ============================================================ */

import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import type { RetencionPracticada } from '../datos/puerta';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { ESTADOS_REABRIR, botonRevisar, cambiosCompra, validarMotivo, type FotoCompra, type TipoCorreccion } from './reabrir';
import './rv8-agrupado.css';

const fmt = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Base {
  r: RetencionPracticada;
  /** Para el subtítulo: «Proveedor · Compra CD-… · Factura … · Comprobante N° …». */
  proveedor: string;
  /** La base tiene reabrir (capacidad): se muestra también en producción. */
  disponible?: boolean;
  onCerrar: () => void;
}

export type PropsReabrir = Base & (
  | { modo: 'reabrir'; impresa: boolean; correccion: { tipo: TipoCorreccion; texto: string }; onReabrir?: (motivo: string) => Promise<void> }
  | { modo: 'bloqueado'; periodo: string | null; onIrPeriodos?: () => void }
  | {
      modo: 'revisar'; reapertura: { cuando: string; motivo: string; foto: FotoCompra & { pct: number } };
      ahora: FotoCompra & { pct: number; retenido: number }; correccion: { tipo: TipoCorreccion; texto: string };
      onRevisar?: () => Promise<void>;
    }
);

export function ReabrirDialogo(props: PropsReabrir) {
  if (!import.meta.env.DEV && !props.disponible) return null;
  return <Dialogo {...props} />;
}

function Estados() {
  return <ul className="rv8-rb-estados">{ESTADOS_REABRIR.map(([t, d]) => <li key={t}><b>{t}</b> {d}</li>)}</ul>;
}

function Dialogo(p: PropsReabrir) {
  const [motivo, setMotivo] = useState('');
  const [intento, setIntento] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = p.r;
  const sub = `${p.proveedor} · Compra ${r.docCodigo ?? '—'} · Factura ${r.facturaNumero || 'sin número'} · Comprobante N° ${r.numeroComprobante ?? '—'}`;
  const correr = (f: () => Promise<void>) => {
    setOcupado(true); setError(null);
    f().then(p.onCerrar).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo completar.')).finally(() => setOcupado(false));
  };
  const accion = (texto: string, f?: () => Promise<void>, bloquea = false) => (f
    ? <button type="button" className="btn btn-primary" disabled={ocupado || bloquea} onClick={() => correr(f)}>{texto}</button>
    : <span className="rv8-con-marca"><button type="button" className="btn btn-primary" disabled>{texto}</button><MarcaPaquete21 /></span>);

  if (p.modo === 'bloqueado') {
    return (
      <Modal title="Reabrir la retención para corregir la compra" size="md" onClose={p.onCerrar}
        footer={<button type="button" className="btn btn-ghost" onClick={p.onCerrar}>Cancelar</button>}>
        <p className="rv8-ag-sub">{sub}</p>
        <Estados />
        <p className="rv8-rb-fuerte" role="alert"><b>Primero reabra el período.</b> Esta retención está declarada{p.periodo ? ` (IVA · ${p.periodo})` : ''}: no se reabre sola, igual que no se anula una declarada.</p>
        {p.onIrPeriodos && <p><button type="button" className="btn btn-ghost" onClick={p.onIrPeriodos}>Ir a los períodos de IVA</button></p>}
      </Modal>
    );
  }

  if (p.modo === 'reabrir') {
    const falta = validarMotivo(motivo);
    const onReabrir = p.onReabrir;
    return (
      <Modal title="Reabrir la retención para corregir la compra" size="md" onClose={p.onCerrar}
        footer={<><button type="button" className="btn btn-ghost" onClick={p.onCerrar}>Cancelar</button>
          {accion('Reabrir', onReabrir ? () => { setIntento(true); return falta ? Promise.reject(new Error(falta)) : onReabrir(motivo.trim()); } : undefined)}</>}>
        <p className="rv8-ag-sub">{sub}</p>
        <Estados />
        <p>Esta retención está <b>finalizada</b>. Al reabrirla:</p>
        <ul className="rv8-rb-efectos">
          <li>La compra deja de estar finalizada: Compras puede volver a montarla (IVA, % y moneda).</li>
          <li>La retención queda «Reabierta, pendiente de revisar» hasta que se registre de nuevo o se confirme sin cambios.</li>
          <li>{p.impresa ? `Ya está impresa. Si al revisarla cambia el monto: ${p.correccion.texto}` : 'Todavía no está impresa: si cambia el monto, se corrige con el mismo N°.'}</li>
          <li>Queda en el historial: quién, cuándo y el motivo.</li>
        </ul>
        <label className="rv8-rb-campo"><span>Motivo (obligatorio)</span>
          <textarea className="texto" rows={2} value={motivo} placeholder="Por ejemplo: el proveedor corrigió el IVA de la factura"
            onChange={(e) => setMotivo(e.target.value)} onBlur={() => setIntento(true)} />
        </label>
        {intento && falta && <p className="rv8-ag-error" role="alert">{falta}</p>}
        {error && !falta && <p className="rv8-ag-error" role="alert">{error}</p>}
      </Modal>
    );
  }

  const { reapertura: ra, ahora } = p;
  const cambios = cambiosCompra(ra.foto, ahora);
  const igual = Math.round(ahora.retenido * 100) === Math.round(r.montoRetenido * 100) && !cambios.length;
  const fila = (t: string, a: number, b: number) => (
    <tr className={Math.round(a * 100) !== Math.round(b * 100) ? 'rv8-rb-cambia' : undefined}><th scope="row">{t}</th><td className="n">{fmt(a)}</td><td className="n">{fmt(b)}</td></tr>
  );
  return (
    <Modal title="Revisar la retención reabierta" size="md" onClose={p.onCerrar}
      footer={<><button type="button" className="btn btn-ghost" onClick={p.onCerrar}>Cancelar</button>{accion(botonRevisar(igual, p.correccion.tipo), p.onRevisar)}</>}>
      <p className="rv8-ag-sub">{sub}</p>
      <p>Se compara la compra de hoy con la que había al reabrir ({ra.cuando}, motivo: {ra.motivo}).</p>
      <div className="rv8-ag-scroll">
        <table className="rv8-rb-t">
          <thead><tr><th /><th className="n">Al reabrir</th><th className="n">Ahora</th></tr></thead>
          <tbody>
            {fila('Total de la compra', ra.foto.total, ahora.total)}{fila('IVA de la factura', ra.foto.iva, ahora.iva)}
            {fila('% de retención', ra.foto.pct, ahora.pct)}{fila('Retenido', r.montoRetenido, ahora.retenido)}
          </tbody>
        </table>
      </div>
      {cambios.length > 0 && <p className="rv8-rb-media" role="status"><b>Compras cambió la compra:</b> {cambios.join('; ')}.</p>}
      {igual
        ? <p className="rv8-rb-ok">La compra no cambió y el retenido es el mismo: se confirma sin cambios y la compra vuelve a quedar finalizada.</p>
        : <p className="rv8-rb-media" role="status">{p.correccion.texto}</p>}
      <p className="rv8-ag-nota">Al registrar, la compra vuelve a quedar finalizada y queda en el historial.</p>
      {error && <p className="rv8-ag-error" role="alert">{error}</p>}
    </Modal>
  );
}
