/* ============================================================
   MGG · Retenciones v8 · Los editores de ⚙ Parámetros

   La empresa, el régimen con sus valores, y un concepto del catálogo. Cada
   uno valida sus campos (validarParametros.ts), muestra el error bajo el
   campo y no deja guardar mientras haya alguno. Guardan por la puerta con
   las mismas funciones de hoy (guardarConfigRetencion, guardarConcepto).
   ============================================================ */

import { useState, type ReactNode } from 'react';
import { parseDecimal } from '@/shared/ui/DecimalInput';
import { SUJETOS, type ConceptoRetencion, type ConfigRetencion } from '../../retencionesCalculo';
import {
  hayErrores, validarConcepto, validarEmpresa, validarRegimen,
  type FormConcepto, type FormEmpresa, type FormRegimen,
} from './validarParametros';

const txt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

interface CampoProps { etiqueta: string; error?: string; children: ReactNode; ayuda?: string }
function Campo({ etiqueta, error, children, ayuda }: CampoProps) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      {children}
      {ayuda && !error && <small className="muted">{ayuda}</small>}
      {error && <small className="v8-reg-error">{error}</small>}
    </label>
  );
}

interface Pie { guardando: boolean; onCancelar: () => void; onGuardar: () => void }
function Botones({ guardando, onCancelar, onGuardar }: Pie) {
  return (
    <div className="v8-pa-botones">
      <button type="button" className="btn btn-ghost" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      <button type="button" className="btn btn-primary" onClick={onGuardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
    </div>
  );
}

/** Un guardado con su estado: el error vuelve como texto y la pantalla lo muestra. */
function useGuardar(onGuardar: () => Promise<void>) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await onGuardar(); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); } finally { setGuardando(false); }
  };
  return { guardando, error, guardar };
}

export function EditorEmpresa({ config, onGuardar, onCancelar }: { config: ConfigRetencion; onGuardar: (c: ConfigRetencion) => Promise<void>; onCancelar: () => void }) {
  const [f, setF] = useState<FormEmpresa>({
    razonSocial: config.razonSocial ?? '', rif: config.rif ?? '', direccionFiscal: config.direccionFiscal ?? '',
    municipio: config.municipio ?? '', estado: config.estado ?? '',
  });
  const [tocado, setTocado] = useState(false);
  const e = validarEmpresa(f);
  const { guardando, error, guardar } = useGuardar(() => onGuardar({
    ...config, razonSocial: f.razonSocial.trim(), rif: f.rif.trim().toUpperCase(), direccionFiscal: f.direccionFiscal.trim(),
    municipio: f.municipio.trim(), estado: f.estado.trim(),
  }));
  const err = (k: keyof FormEmpresa) => (tocado ? e[k] : undefined);
  const campo = (k: keyof FormEmpresa) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value }), 'aria-invalid': !!err(k), className: 'texto' });
  return (
    <div className="v8-pa-editor">
      <Campo etiqueta="Razón social" error={err('razonSocial')}><input {...campo('razonSocial')} maxLength={220} /></Campo>
      <Campo etiqueta="RIF" error={err('rif')} ayuda="Letra y 9 dígitos, por ejemplo J-12345678-9."><input {...campo('rif')} maxLength={14} /></Campo>
      <Campo etiqueta="Dirección fiscal" error={err('direccionFiscal')}><input {...campo('direccionFiscal')} maxLength={320} /></Campo>
      <Campo etiqueta="Municipio" error={err('municipio')}><input {...campo('municipio')} maxLength={110} /></Campo>
      <Campo etiqueta="Estado" error={err('estado')}><input {...campo('estado')} maxLength={110} /></Campo>
      {error && <div className="aviso-error" role="alert">{error}</div>}
      <Botones guardando={guardando} onCancelar={onCancelar} onGuardar={() => { setTocado(true); if (!hayErrores(e)) void guardar(); }} />
    </div>
  );
}

export function EditorRegimen({ config, onGuardar, onCancelar }: { config: ConfigRetencion; onGuardar: (c: ConfigRetencion) => Promise<void>; onCancelar: () => void }) {
  const [especial, setEspecial] = useState(config.esContribuyenteEspecial);
  const [f, setF] = useState<FormRegimen>({
    pctIvaGeneral: txt(config.pctIvaGeneral), pctIvaEspecial: txt(config.pctIvaEspecial), valorUt: txt(config.valorUt), pctIgtf: txt(config.pctIgtf),
  });
  const [tocado, setTocado] = useState(false);
  const e = validarRegimen(f);
  const { guardando, error, guardar } = useGuardar(() => onGuardar({
    ...config, esContribuyenteEspecial: especial,
    pctIvaGeneral: parseDecimal(f.pctIvaGeneral) ?? config.pctIvaGeneral, pctIvaEspecial: parseDecimal(f.pctIvaEspecial) ?? config.pctIvaEspecial,
    valorUt: parseDecimal(f.valorUt) ?? config.valorUt, pctIgtf: parseDecimal(f.pctIgtf) ?? config.pctIgtf,
  }));
  const err = (k: keyof FormRegimen) => (tocado ? e[k] : undefined);
  const campo = (k: keyof FormRegimen) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value }), 'aria-invalid': !!err(k), className: 'texto mono', inputMode: 'decimal' as const });
  return (
    <div className="v8-pa-editor">
      <label className="v8-pa-casilla">
        <input type="checkbox" checked={especial} onChange={(ev) => setEspecial(ev.target.checked)} /> Contribuyente especial: practica retención de IVA
      </label>
      <Campo etiqueta="IVA: % general" error={err('pctIvaGeneral')}><input {...campo('pctIvaGeneral')} /></Campo>
      <Campo etiqueta="IVA: % del art. 5" error={err('pctIvaEspecial')}><input {...campo('pctIvaEspecial')} /></Campo>
      <Campo etiqueta="Unidad tributaria (Bs)" error={err('valorUt')} ayuda="Sin ella no se calculan el mínimo ni el sustraendo del ISLR."><input {...campo('valorUt')} /></Campo>
      <Campo etiqueta="IGTF: %" error={err('pctIgtf')}><input {...campo('pctIgtf')} /></Campo>
      {error && <div className="aviso-error" role="alert">{error}</div>}
      <Botones guardando={guardando} onCancelar={onCancelar} onGuardar={() => { setTocado(true); if (!hayErrores(e)) void guardar(); }} />
    </div>
  );
}

type Tipo = ConceptoRetencion['tipo'];
export function EditorConcepto({ concepto, tipo, onGuardar, onCancelar }: {
  concepto: ConceptoRetencion | null; tipo: Tipo;
  onGuardar: (c: Partial<ConceptoRetencion> & { nombre: string; tipo: Tipo }) => Promise<void>; onCancelar: () => void;
}) {
  const c = concepto;
  const [f, setF] = useState<FormConcepto>({
    codigo: c?.codigo ?? '', nombre: c?.nombre ?? '', sujeto: c?.sujeto ?? 'todos', porcentaje: txt(c?.porcentaje), basePct: txt(c?.basePct ?? 100),
    baseMinimaUt: txt(c?.baseMinimaUt ?? 0), aplicaSustraendo: c?.aplicaSustraendo ?? false, fundamento: c?.fundamento ?? '', orden: txt(c?.orden ?? 0),
  });
  const [tocado, setTocado] = useState(false);
  const e = validarConcepto(f);
  const { guardando, error, guardar } = useGuardar(() => onGuardar({
    ...(c ? { id: c.id, activo: c.activo } : {}), tipo,
    codigo: f.codigo.trim() || null, nombre: f.nombre.trim(), sujeto: f.sujeto as ConceptoRetencion['sujeto'],
    porcentaje: parseDecimal(f.porcentaje) ?? 0, basePct: parseDecimal(f.basePct) ?? 100, baseMinimaUt: parseDecimal(f.baseMinimaUt) ?? 0,
    aplicaSustraendo: f.aplicaSustraendo, fundamento: f.fundamento.trim() || null, orden: parseDecimal(f.orden) ?? 0,
  }));
  const err = (k: keyof FormConcepto) => (tocado ? e[k] : undefined);
  const campo = (k: Exclude<keyof FormConcepto, 'aplicaSustraendo'>, mono = false) => ({
    value: f[k], onChange: (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value }), 'aria-invalid': !!err(k), className: mono ? 'texto mono' : 'texto',
  });
  return (
    <div className="v8-pa-editor">
      <h4 className="v8-pa-editor-t">{c ? `Editar «${c.nombre}»` : 'Nuevo concepto'}</h4>
      <Campo etiqueta="Código" error={err('codigo')}><input {...campo('codigo', true)} maxLength={12} /></Campo>
      <Campo etiqueta="Concepto" error={err('nombre')}><input {...campo('nombre')} maxLength={220} /></Campo>
      <Campo etiqueta="Sujeto" error={err('sujeto')}>
        <select className="select" value={f.sujeto} onChange={(ev) => setF({ ...f, sujeto: ev.target.value })}>
          {SUJETOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="%" error={err('porcentaje')}><input {...campo('porcentaje', true)} inputMode="decimal" /></Campo>
      <Campo etiqueta="% de la base" error={err('basePct')} ayuda="100 si se retiene sobre toda la base."><input {...campo('basePct', true)} inputMode="decimal" /></Campo>
      <Campo etiqueta="Mínimo (UT)" error={err('baseMinimaUt')} ayuda="0 si no tiene mínimo."><input {...campo('baseMinimaUt', true)} inputMode="decimal" /></Campo>
      <label className="v8-pa-casilla">
        <input type="checkbox" checked={f.aplicaSustraendo} onChange={(ev) => setF({ ...f, aplicaSustraendo: ev.target.checked })} /> Resta el sustraendo (% × UT × 83,3334)
      </label>
      <Campo etiqueta="Fundamento" error={err('fundamento')}><input {...campo('fundamento')} maxLength={320} /></Campo>
      <Campo etiqueta="Orden en la lista" error={err('orden')}><input {...campo('orden', true)} inputMode="numeric" /></Campo>
      {error && <div className="aviso-error" role="alert">{error}</div>}
      <Botones guardando={guardando} onCancelar={onCancelar} onGuardar={() => { setTocado(true); if (!hayErrores(e)) void guardar(); }} />
    </div>
  );
}
