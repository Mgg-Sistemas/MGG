/* ============================================================
   MGG · Retenciones v8 · Registrar una retención recibida

   La que nos practica un cliente. Los números se copian de SU comprobante:
   no hay cálculo. Guarda con la misma registrarRetencion de la pantalla de
   hoy (dirección «recibida», documento «manual»), que también controla el
   doble registro, y adjunta el PDF del cliente con la misma
   adjuntarComprobante. Cada campo valida bajo sí mismo
   (validarRecibida.ts); el monto no se rellena solo: «base × %» se ofrece
   con un botón.
   ============================================================ */

import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { parseDecimal } from '@/shared/ui/DecimalInput';
import { money } from '@/shared/lib/format';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { periodoDe, quincenaDe } from '../../retencionesCalculo';
import { faltaEnLaCarga } from '../../validarCarga';
import { usePuerta } from '../datos/puerta';
import { avisoMonto, sugerenciaMonto, validarRecibida, type FormRecibida } from './validarRecibida';
import { revisarRif } from './validarRif';
import './registro.css';

const VACIO: FormRecibida = {
  tipo: 'iva', cliente: '', rif: '', numero: '', factura: '', control: '', fecha: '', moneda: 'Bs',
  base: '', iva: '', pct: '75', monto: '', observacion: '', archivo: null,
};

export function RecibidaDialogo({ onCerrar, onRegistrada }: { onCerrar: () => void; onRegistrada: () => void }) {
  const puerta = usePuerta();
  const { user } = useSession();
  const { appUser } = usePermissions();
  const [f, setF] = useState<FormRecibida>(VACIO);
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e = validarRecibida(f);
  const err = (k: keyof FormRecibida) => (tocado ? e[k] : undefined);
  const set = (x: Partial<FormRecibida>) => setF((v) => ({ ...v, ...x }));
  const sug = sugerenciaMonto(f);
  const aviso = avisoMonto(f);
  const avisoRif = revisarRif(f.rif).aviso;

  const registrar = async () => {
    setTocado(true);
    if (Object.values(e).some(Boolean)) return;
    const falta = faltaEnLaCarga({ tipo: f.tipo, facturaNumero: f.factura, facturaFecha: f.fecha });
    if (falta) { setError(falta); return; }
    setGuardando(true); setError(null);
    try {
      const r = await puerta.registrar({
        tipo: f.tipo, direccion: 'recibida', docKind: 'manual',
        contraparteNombre: f.cliente.trim(), contraparteRif: f.rif.trim().toUpperCase(),
        facturaNumero: f.factura.trim(), facturaControl: f.control.trim() || null, facturaFecha: f.fecha,
        periodo: periodoDe(f.fecha), quincena: f.tipo === 'iva' ? quincenaDe(f.fecha) : null,
        numeroComprobante: f.numero.trim(), moneda: f.moneda,
        baseImponible: parseDecimal(f.base) ?? 0, impuesto: f.tipo === 'iva' ? parseDecimal(f.iva) ?? 0 : 0,
        porcentaje: parseDecimal(f.pct) ?? 0, montoRetenido: parseDecimal(f.monto) ?? 0,
        observacion: f.observacion.trim() || null, actor: user?.email ?? 'sistema', actorName: appUser?.nombre ?? null,
      });
      if (f.archivo) await puerta.adjuntarComprobante(r.id, f.archivo).catch(() => toast('La retención quedó, pero el PDF del cliente no subió.', 'error'));
      toast(`Retención recibida registrada · ${money(r.montoRetenido, r.moneda)}`, 'success');
      onRegistrada();
    } catch (x: unknown) {
      setError(x instanceof Error ? x.message : 'No se pudo registrar.');
    } finally {
      setGuardando(false);
    }
  };

  const campo = (k: Exclude<keyof FormRecibida, 'archivo' | 'tipo' | 'moneda'>, mono = false) => ({
    value: f[k], onChange: (ev: { target: { value: string } }) => set({ [k]: ev.target.value } as Partial<FormRecibida>),
    'aria-invalid': !!err(k), className: mono ? 'texto mono' : 'texto',
  });
  const errorDe = (k: keyof FormRecibida) => (err(k) ? <small className="v8-reg-error">{err(k)}</small> : null);

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={registrar} disabled={guardando}>{guardando ? 'Registrando…' : 'Registrar'}</button>
    </>
  );

  return (
    <Modal title="Registrar una retención de un cliente" size="lg" onClose={onCerrar} footer={footer}>
      <div className="ret-v8 v8-registro">
<<<<<<< HEAD
        <p className="v8-reg-sub">Retención de clientes (la empresa es sujeto retenido). Los datos se copian del comprobante del cliente: no se calculan.</p>
=======
        <p className="v8-reg-sub">La que nos practicó un cliente al pagarnos. Los datos se copian de su comprobante: no se calculan.</p>
>>>>>>> feature/retenciones-v8-recibidas
        <div className="v8-reg-campos">
          <label className="campo">
            <span>Impuesto</span>
            <select className="select" value={f.tipo} onChange={(ev) => set({ tipo: ev.target.value as FormRecibida['tipo'] })}>
              <option value="iva">IVA</option><option value="islr">ISLR</option><option value="municipal">ISAE</option>
            </select>
          </label>
          <label className="campo"><span>Cliente</span><input {...campo('cliente')} maxLength={220} />{errorDe('cliente')}</label>
          <label className="campo"><span>RIF del cliente</span><input {...campo('rif', true)} maxLength={14} placeholder="J-12345678-9" />{errorDe('rif')}{!err('rif') && avisoRif && <small className="v8-reg-aviso">{avisoRif}</small>}</label>
          <label className="campo"><span>N° del comprobante del cliente</span><input {...campo('numero', true)} maxLength={24} />{errorDe('numero')}</label>
          <label className="campo"><span>N° de factura de la empresa</span><input {...campo('factura')} maxLength={24} />{errorDe('factura')}</label>
          <label className="campo"><span>N° de control</span><input {...campo('control')} maxLength={24} />{errorDe('control')}</label>
          <label className="campo">
            <span>Fecha de la factura</span>
            <input {...campo('fecha')} type="date" max={new Date().toLocaleDateString('en-CA')} />
            {!err('fecha') && f.fecha && <small className="muted">Período {periodoDe(f.fecha)}{f.tipo === 'iva' ? ` · quincena ${quincenaDe(f.fecha)}` : ''}</small>}
            {errorDe('fecha')}
          </label>
          <label className="campo">
            <span>Moneda</span>
            <select className="select" value={f.moneda} onChange={(ev) => set({ moneda: ev.target.value as FormRecibida['moneda'] })}>
              <option value="Bs">Bs</option><option value="USD">$</option>
            </select>
          </label>
          <label className="campo"><span>Base imponible</span><input {...campo('base', true)} inputMode="decimal" />{errorDe('base')}</label>
          {f.tipo === 'iva' && <label className="campo"><span>IVA de la factura</span><input {...campo('iva', true)} inputMode="decimal" />{errorDe('iva')}</label>}
          <label className="campo"><span>% retenido</span><input {...campo('pct', true)} inputMode="decimal" />{errorDe('pct')}</label>
          <label className="campo">
            <span>Monto retenido</span>
            <input {...campo('monto', true)} inputMode="decimal" />
            {sug != null && !f.monto && (
              <button type="button" className="mini" onClick={() => set({ monto: String(sug).replace('.', ',') })}>Usar {f.tipo === 'iva' ? 'IVA' : 'base'} × %: {money(sug, f.moneda)}</button>
            )}
            {errorDe('monto')}
            {!err('monto') && aviso && <small className="v8-reg-aviso">{aviso}</small>}
          </label>
          <label className="campo">
            <span>PDF del cliente (PDF o imagen)</span>
            <input className="texto" type="file" accept="application/pdf,image/*" onChange={(ev) => set({ archivo: ev.target.files?.[0] ?? null })} aria-invalid={!!e.archivo} />
            {f.archivo && !e.archivo && <small className="muted">{f.archivo.name}</small>}
            {e.archivo && <small className="v8-reg-error">{e.archivo}</small>}
          </label>
          <label className="campo"><span>Observación</span><input {...campo('observacion')} maxLength={320} />{errorDe('observacion')}</label>
        </div>
        {error && <div className="aviso-error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
