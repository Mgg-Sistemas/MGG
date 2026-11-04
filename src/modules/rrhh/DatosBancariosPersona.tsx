/* ============================================================
   Golden Touch · RRHH · Datos bancarios del trabajador (03/11/2026)

   Segmento de la ficha: pago móvil y transferencia (Bs), Binance y TRC20 (USDT).
   Como la carga familiar, en una persona que YA existe cada cambio se guarda en
   el momento; en un alta todavía no hay dónde guardarlo y se pide guardar primero.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { useRealtime } from '@/shared/lib/useRealtime';
import { BANCOS_VE } from '@/shared/lib/bancos';
import { TIPOS_CUENTA, datosDeCuenta, errorCuenta, infoTipo, textoCuenta, type CuentaPago, type TipoCuentaPago } from './datosBancarios';
import { guardarCuentasPago, listCuentasPago } from './personal.repository';

const nuevoId = () => Math.random().toString(36).slice(2, 10);

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast('Copiado', 'success');
  } catch { toast('No se pudo copiar', 'error'); }
}

export function DatosBancariosPersona({ personalId, canWrite }: { personalId: string | null; canWrite: boolean }) {
  const [cuentas, setCuentas] = useState<CuentaPago[]>([]);
  const [form, setForm] = useState<CuentaPago | null>(null);
  const [borrar, setBorrar] = useState<CuentaPago | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async () => {
    if (!personalId) { setCuentas([]); return; }
    setCuentas(await listCuentasPago(personalId).catch(() => []));
  }, [personalId]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['personal'], () => { void recargar(); });

  async function guardarLista(lista: CuentaPago[], aviso: string) {
    if (!personalId) return;
    setOcupado(true);
    try {
      await guardarCuentasPago(personalId, lista);
      setCuentas(lista);
      toast(aviso, 'success');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron guardar los datos bancarios', 'error');
      return false;
    } finally { setOcupado(false); }
  }

  async function guardarForm() {
    if (!form) return;
    const mal = errorCuenta(form);
    if (mal) { toast(mal, 'warning'); return; }
    const existe = cuentas.some((c) => c.id === form.id);
    let lista = existe ? cuentas.map((c) => (c.id === form.id ? form : c)) : [...cuentas, form];
    // Una sola principal: la primera que se carga lo es; marcar otra le quita la marca a las demás.
    if (form.principal) lista = lista.map((c) => ({ ...c, principal: c.id === form.id }));
    else if (!lista.some((c) => c.principal)) lista = lista.map((c, i) => ({ ...c, principal: i === 0 }));
    if (await guardarLista(lista, existe ? 'Datos bancarios actualizados' : 'Forma de pago agregada')) setForm(null);
  }

  if (!personalId) {
    return <small className="muted">Guarda primero la ficha; después se cargan aquí el pago móvil, la transferencia, Binance o TRC20.</small>;
  }

  const set = (cambio: Partial<CuentaPago>) => setForm((f) => (f ? { ...f, ...cambio } : f));
  const campo = (label: string, valor: string | null | undefined, onChange: (v: string) => void, extra?: { placeholder?: string; mono?: boolean; inputMode?: 'numeric' | 'tel' | 'text' }) => (
    <div className="form-row" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <input className={`input${extra?.mono ? ' mono' : ''}`} value={valor ?? ''} placeholder={extra?.placeholder}
        inputMode={extra?.inputMode} onChange={(e) => onChange(e.target.value)} autoComplete="off"
        // Va dentro del formulario de la ficha: Enter no debe guardar la ficha entera.
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
    </div>
  );

  return (
    <div>
      {!cuentas.length && !form && <small className="muted" style={{ display: 'block', marginBottom: '.5rem' }}>Sin datos bancarios cargados.</small>}

      <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {cuentas.map((c) => {
          const i = infoTipo(c.tipo);
          return (
            <div key={c.id} className="card" style={{ margin: 0, padding: '.6rem .75rem', borderColor: c.principal ? 'var(--brand, #ff8a00)' : undefined }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.4rem', marginBottom: '.35rem' }}>
                <strong>{i.icono} {i.label} <span className="muted" style={{ fontWeight: 400 }}>· {i.moneda}</span></strong>
                {c.principal && <span className="badge warning">Principal</span>}
              </div>
              {datosDeCuenta(c).map((d) => (
                <div key={d.etiqueta} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.4rem', fontSize: '.85rem' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><span className="muted">{d.etiqueta}:</span> <span className="mono">{d.valor}</span></span>
                  <button type="button" className="btn btn-ghost btn-xs" title={`Copiar ${d.etiqueta}`} onClick={() => void copiar(d.valor)}>📋</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.45rem' }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => void copiar(textoCuenta(c))}>📋 Copiar todo</button>
                {canWrite && <>
                  <button type="button" className="btn btn-ghost btn-xs" disabled={ocupado} onClick={() => setForm({ ...c })}>✎ Editar</button>
                  <button type="button" className="btn btn-ghost btn-xs" disabled={ocupado} onClick={() => setBorrar(c)}>🗑 Quitar</button>
                </>}
              </div>
            </div>
          );
        })}
      </div>

      {canWrite && !form && (
        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.55rem' }}>
          {TIPOS_CUENTA.map((t) => (
            <button key={t.tipo} type="button" className="btn btn-ghost btn-sm" disabled={ocupado}
              onClick={() => setForm({ id: nuevoId(), tipo: t.tipo as TipoCuentaPago, principal: !cuentas.length })}>
              ＋ {t.icono} {t.label} <span className="muted">({t.moneda})</span>
            </button>
          ))}
        </div>
      )}

      {form && (
        <div className="card" style={{ marginTop: '.6rem', padding: '.7rem .85rem' }}>
          <div className="card-title" style={{ marginBottom: '.5rem' }}>{infoTipo(form.tipo).icono} {infoTipo(form.tipo).label} · {infoTipo(form.tipo).moneda}</div>
          <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            {(form.tipo === 'pago_movil' || form.tipo === 'transferencia') && (
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Banco</label>
                <SearchSelect value={form.banco ?? ''} onChange={(v) => set({ banco: v || null })} placeholder="🔍 Busca el banco…"
                  options={BANCOS_VE.map((b) => ({ value: b.codigo, label: `${b.codigo} · ${b.nombre}` }))} />
              </div>
            )}
            {form.tipo === 'pago_movil' && <>
              {campo('Teléfono', form.telefono, (v) => set({ telefono: v }), { placeholder: '0414-1234567', inputMode: 'tel' })}
              {campo('Cédula', form.cedula, (v) => set({ cedula: v }), { placeholder: 'V-12345678' })}
            </>}
            {form.tipo === 'transferencia' && <>
              {campo('Número de cuenta (20 dígitos)', form.cuenta, (v) => set({ cuenta: v }), { placeholder: '0134-0000-00-0000000000', mono: true, inputMode: 'numeric' })}
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Tipo de cuenta</label>
                <select className="select" value={form.tipo_cuenta ?? 'corriente'} onChange={(e) => set({ tipo_cuenta: e.target.value as 'corriente' | 'ahorro' })}>
                  <option value="corriente">Corriente</option>
                  <option value="ahorro">Ahorro</option>
                </select>
              </div>
              {campo('Titular', form.titular, (v) => set({ titular: v }))}
              {campo('Cédula / RIF del titular', form.cedula, (v) => set({ cedula: v }), { placeholder: 'V-12345678' })}
            </>}
            {form.tipo === 'binance' && campo('Usuario, correo o Binance ID', form.usuario, (v) => set({ usuario: v }))}
            {form.tipo === 'trc20' && campo('Dirección de billetera TRC20 (TRON)', form.direccion, (v) => set({ direccion: v.trim() }), { placeholder: 'T…', mono: true })}
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', marginTop: '.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.principal} onChange={(e) => set({ principal: e.target.checked })} /> Forma de pago principal
          </label>
          {errorCuenta(form) && <small className="muted" style={{ display: 'block', marginTop: '.3rem' }}>⚠ {errorCuenta(form)}</small>}
          <div style={{ display: 'flex', gap: '.4rem', justifyContent: 'flex-end', marginTop: '.55rem' }}>
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => setForm(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" disabled={ocupado || !!errorCuenta(form)} onClick={() => void guardarForm()}>
              {ocupado ? 'Guardando…' : '✓ Guardar'}
            </button>
          </div>
        </div>
      )}

      {borrar && (
        <ConfirmDialog
          title="Quitar forma de pago"
          message={`¿Quitar «${infoTipo(borrar.tipo).label}» de los datos bancarios?`}
          confirmText="Quitar"
          danger
          onCancel={() => setBorrar(null)}
          onConfirm={async () => {
            const lista = cuentas.filter((c) => c.id !== borrar.id);
            if (lista.length && !lista.some((c) => c.principal)) lista[0] = { ...lista[0], principal: true };
            await guardarLista(lista, 'Forma de pago quitada');
            setBorrar(null);
          }}
        />
      )}
    </div>
  );
}
