/* ============================================================
   Golden Touch · Retenciones · Parámetros › Impuestos y reglas (R2)
   La ficha de cada impuesto (nombre, ente, estado, serie, «Operación N°»,
   exportación) y su versión vigente (periodicidad, vencimiento, plazo de
   entrega, convivencia y base legal), con «Nueva versión desde…», «Corregir»
   e historial. La numeración y los períodos viven en la ficha. Debajo, los
   conceptos del ISLR (los pasa quien cablea).
   ============================================================ */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { listEntes, type Ente } from './entes.repository';
import {
  EXPORTA, PERIODICIDADES, VENCE_SI_INHABIL, corregirVersion, crearImpuesto, faltaEnImpuesto, faltaEnVersion,
  guardarImpuesto, historialImpuesto, listImpuestos, nuevaVersion, plazoEntrega, versionDeFecha,
  type CambioHistorial, type DatosVersion, type Exporta, type FichaImpuesto, type FormatoSerie, type Impuesto,
  type ModoSerie, type Periodicidad, type VenceSiInhabil, type VersionImpuesto,
} from './impuestos.repository';
import { desdeMinimo, fechaCorta } from './parametrosR1';
import { cambiosTexto, lineaHistorial, resumenVersion } from './parametrosR2';
import { AYUDA_ORDEN, ROTULO_ORDEN, rotuloAutor, rotuloMotivo, rotuloSerie } from './rotulos';
import { r4Disponible } from './clasificaciones.repository';
import { ParametrosClasificaciones } from './ParametrosClasificaciones';
import { r5Disponible } from './tarifas.repository';
import { ParametrosTarifas } from './ParametrosTarifas';
import { r7Disponible } from './reglas.repository';
import { ParametrosReglas } from './ParametrosReglas';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { numeroATexto } from './validarCarga';
import { ENTEROS_IMPUESTO, faltaEnEnteros, leerEntero, normalizarClaveImpuesto, pistaClave } from './parametrosNumeros';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
const etiqueta = <K extends string>(xs: { key: K; label: string }[], k: K) => xs.find((x) => x.key === k)?.label ?? k;

const VERSION_VACIA: DatosVersion = {
  periodicidad: 'mensual', venceDia: null, venceSiInhabil: 'siguiente_habil', plazoEntregaDias: 2, plazoDiasHabiles: true,
  convive: false, otroSistemaNombre: null, otroSistemaEnTotales: false, baseLegal: null, fuente: null,
};
const datosDe = (v: VersionImpuesto | null): DatosVersion => (v ? {
  periodicidad: v.periodicidad, venceDia: v.venceDia, venceSiInhabil: v.venceSiInhabil, plazoEntregaDias: v.plazoEntregaDias,
  plazoDiasHabiles: v.plazoDiasHabiles, convive: v.convive, otroSistemaNombre: v.otroSistemaNombre,
  otroSistemaEnTotales: v.otroSistemaEnTotales, baseLegal: v.baseLegal, fuente: v.fuente,
} : { ...VERSION_VACIA });
const fichaDe = (i: Impuesto): FichaImpuesto => ({
  clave: i.clave, nombre: i.nombre, enteId: i.enteId, admitePracticada: i.admitePracticada, admiteSufrida: i.admiteSufrida,
  numera: i.numera, serieFormato: i.serieFormato, serieModo: i.serieModo, serieInicial: i.serieInicial,
  serieUltimoOtroSistema: i.serieUltimoOtroSistema, numeraOperacion: i.numeraOperacion, agrupa: i.agrupa,
  exporta: i.exporta, orden: i.orden, activo: i.activo,
});

export function ParametrosImpuestos({ puedeEditar, conceptosIslr }: { puedeEditar: boolean; conceptosIslr?: ReactNode }) {
  const [impuestos, setImpuestos] = useState<Impuesto[] | null>(null);
  const [entes, setEntes] = useState<Ente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  // R4: cada ficha muestra su clasificación (conceptos, actividades); sin R4, abajo el catálogo de hoy.
  const [conR4, setConR4] = useState(false);
  useEffect(() => { r4Disponible().then(setConR4).catch(() => setConR4(false)); }, []);
  // R5 (tarifas por tramos) y R7 (reglas de 8 pasos): cada una aparece en la ficha cuando su paquete existe.
  const [conR5, setConR5] = useState(false);
  const [conR7, setConR7] = useState(false);
  useEffect(() => {
    r5Disponible().then(setConR5).catch(() => setConR5(false));
    r7Disponible().then(setConR7).catch(() => setConR7(false));
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [imps, es] = await Promise.all([listImpuestos(), listEntes().catch(() => [] as Ente[])]);
      setImpuestos(imps); setEntes(es); setError(null);
    } catch (e) { setError(mensaje(e, 'No se pudieron leer los impuestos.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_impuestos', 'retencion_impuesto_versiones'], () => { void cargar(); });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>
          Cada impuesto con su serie y su exportación; lo que cambia con el tiempo (periodicidad, vencimiento, plazo de entrega) va por versiones desde una fecha.
        </p>
        {puedeEditar && <button type="button" className="btn btn-primary" onClick={() => setNuevo(true)}>Nuevo impuesto</button>}
      </div>
      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!impuestos && !error && <p className="muted">Leyendo los impuestos…</p>}
      {impuestos?.map((i) => (
        <FichaImpuestoCard key={i.clave} impuesto={i} entes={entes} puedeEditar={puedeEditar} conR4={conR4} conR5={conR5} conR7={conR7} onCambio={() => void cargar()} />
      ))}

      {!conR4 && conceptosIslr && (
        <section style={{ marginTop: '1rem' }}>
          <h4 style={{ margin: '0 0 .4rem' }}>Conceptos del ISLR</h4>
          {conceptosIslr}
        </section>
      )}

      {nuevo && <NuevoImpuestoModal entes={entes} onClose={() => setNuevo(false)} onHecho={() => { setNuevo(false); void cargar(); }} />}
    </div>
  );
}

function FichaImpuestoCard({ impuesto, entes, puedeEditar, conR4, conR5, conR7, onCambio }: {
  impuesto: Impuesto; entes: Ente[]; puedeEditar: boolean; conR4: boolean; conR5: boolean; conR7: boolean; onCambio: () => void;
}) {
  const vigente = versionDeFecha(impuesto.versiones);
  const ente = entes.find((e) => e.id === impuesto.enteId);
  const [ficha, setFicha] = useState<FichaImpuesto>(fichaDe(impuesto));
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [modoVersion, setModoVersion] = useState<'nueva' | 'corregir' | null>(null);
  const [historial, setHistorial] = useState<CambioHistorial[] | null>(null);

  // Si otro usuario cambia la ficha, se toma lo nuevo (salvo que se esté editando con motivo escrito).
  const firma = JSON.stringify(fichaDe(impuesto));
  useEffect(() => { if (!motivo) setFicha(JSON.parse(firma) as FichaImpuesto); }, [firma]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambio = JSON.stringify(ficha) !== firma;
  const falta = faltaEnEnteros(ficha) ?? faltaEnImpuesto(ficha);

  async function guardar() {
    setGuardando(true);
    try {
      await guardarImpuesto(impuesto.clave, ficha, motivo);
      toast(`${impuesto.nombre}: guardado.`, 'success');
      setMotivo(''); setHistorial(null);
      onCambio();
    } catch (e) {
      toast(mensaje(e, 'No se pudo guardar el impuesto.'), 'error');
    } finally {
      setGuardando(false);
    }
  }

  async function verHistorial() {
    try { setHistorial(await historialImpuesto(impuesto.clave)); } catch (e) { toast(mensaje(e, 'No se pudo leer el historial.'), 'error'); }
  }

  const set = (p: Partial<FichaImpuesto>) => setFicha((f) => ({ ...f, ...p }));

  return (
    <details className="card" style={{ marginBottom: '.6rem', opacity: impuesto.activo ? 1 : 0.7 }}>
      <summary style={{ cursor: 'pointer', display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{impuesto.nombre}</strong>
        <span className="muted" style={{ fontSize: '.8rem' }}>{ente?.nombre ?? 'Sin ente'}</span>
        {!impuesto.activo && <span className="lfv8-pill falta">Inactivo</span>}
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{resumenVersion(vigente)}</span>
      </summary>

      <fieldset disabled={!puedeEditar || guardando} style={{ border: 0, padding: 0, margin: '.6rem 0 0' }}>
        <CamposFicha ficha={ficha} set={set} entes={entes} />
        {puedeEditar && (
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '2 1 260px', margin: 0 }}>
              <label>Motivo del cambio</label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!cambio || !!falta || !motivo.trim() || guardando}>
              {guardando ? 'Guardando…' : 'Guardar ficha'}
            </button>
            {cambio && <button type="button" className="btn btn-ghost" onClick={() => setFicha(JSON.parse(firma) as FichaImpuesto)}>Deshacer</button>}
          </div>
        )}
        {cambio && falta && <small className="hint" style={{ color: 'var(--warning)' }}>{falta}</small>}
        {puedeEditar && cambio && !falta && !motivo.trim() && <small className="hint muted">Indica el motivo del cambio para guardar la ficha: queda en el historial.</small>}
      </fieldset>

      <div className="card" style={{ marginTop: '.7rem', background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <strong style={{ fontSize: '.88rem' }}>Versión vigente{vigente ? ` · desde ${fechaCorta(vigente.desde)}` : ''}</strong>
          {puedeEditar && (
            <span style={{ display: 'flex', gap: '.3rem' }}>
              <button type="button" className="btn btn-sm" onClick={() => setModoVersion('nueva')}>Nueva versión desde…</button>
              {vigente && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setModoVersion('corregir')}>Corregir</button>}
            </span>
          )}
        </div>
        {vigente ? (
          <div style={{ fontSize: '.82rem', marginTop: '.3rem' }}>
            <div>{resumenVersion(vigente)}</div>
            <div className="muted">
              Si vence en día inhábil: {etiqueta(VENCE_SI_INHABIL, vigente.venceSiInhabil).toLowerCase()}.
              {' '}Ejemplo: una factura de hoy se entrega hasta el {fechaCorta(plazoEntrega(vigente, hoyIso()))}.
            </div>
            {vigente.baseLegal && <div className="muted">Base legal: {vigente.baseLegal}</div>}
            {vigente.fuente && <div className="muted">Fuente: {vigente.fuente}</div>}
            <div className="muted" style={{ fontSize: '.74rem' }}>{rotuloMotivo(vigente.motivo)} · {rotuloAutor(vigente.actualizadoPor)}</div>
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem' }}>Sin versión: agrega la primera con «Nueva versión desde…».</p>}
        {impuesto.versiones.length > 1 && (
          <details style={{ marginTop: '.4rem' }}>
            <summary className="muted" style={{ cursor: 'pointer', fontSize: '.8rem' }}>Versiones ({impuesto.versiones.length})</summary>
            {impuesto.versiones.map((v) => (
              <div key={v.id} style={{ fontSize: '.78rem', padding: '.2rem 0' }}>
                {fechaCorta(v.desde)} – {v.hasta ? fechaCorta(v.hasta) : 'hoy'} · {resumenVersion(v)} · <span className="muted">{rotuloMotivo(v.motivo)}</span>
              </div>
            ))}
          </details>
        )}
      </div>

      {conR7 && (
        <details style={{ marginTop: '.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600 }}>Reglas (cuándo y cómo se retiene)</summary>
          <div style={{ marginTop: '.4rem' }}><ParametrosReglas puedeEditar={puedeEditar} impuestoClave={impuesto.clave} /></div>
        </details>
      )}
      {conR5 && (
        <details style={{ marginTop: '.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600 }}>Tarifas progresivas</summary>
          <div style={{ marginTop: '.4rem' }}><ParametrosTarifas puedeEditar={puedeEditar} impuestoClave={impuesto.clave} /></div>
        </details>
      )}
      {conR4 && (
        <details style={{ marginTop: '.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600 }}>Clasificación (conceptos o actividades, con sus valores)</summary>
          <div style={{ marginTop: '.4rem' }}>
            <ParametrosClasificaciones puedeEditar={puedeEditar} impuestoClave={impuesto.clave} />
          </div>
        </details>
      )}

      <details style={{ marginTop: '.5rem' }} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !historial) void verHistorial(); }}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: '.8rem' }}>Historial de cambios</summary>
        {!historial && <p className="muted" style={{ fontSize: '.8rem' }}>Leyendo…</p>}
        {historial && historial.length === 0 && <p className="muted" style={{ fontSize: '.8rem' }}>Sin cambios registrados.</p>}
        {historial?.map((h) => {
          const l = lineaHistorial(h);
          return (
            <div key={h.id} style={{ fontSize: '.78rem', padding: '.2rem 0', borderBottom: '1px solid var(--border)' }}>
              <strong>{new Date(h.at).toLocaleString('es-VE')}</strong> · {l.que} · {l.quien}
              <div className="muted">{l.motivo}{cambiosTexto(h)}</div>
            </div>
          );
        })}
      </details>

      {modoVersion && (
        <VersionModal impuesto={impuesto} vigente={vigente} modo={modoVersion}
          onClose={() => setModoVersion(null)} onHecho={() => { setModoVersion(null); setHistorial(null); onCambio(); }} />
      )}
    </details>
  );
}

function CamposFicha({ ficha, set, entes, conClave = false }: {
  ficha: FichaImpuesto; set: (p: Partial<FichaImpuesto>) => void; entes: Ente[]; conClave?: boolean;
}) {
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  // La clave se escribe libre y se guarda en MAYÚSCULAS con «_» en vez de espacios; la pista dice cómo queda.
  const [claveEscrita, setClaveEscrita] = useState(ficha.clave);
  const pista = pistaClave(claveEscrita, ficha.clave);
  return (
    <>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        {conClave && (
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Clave</label>
            <input className="input mono" value={claveEscrita} onChange={(e) => { setClaveEscrita(e.target.value); set({ clave: normalizarClaveImpuesto(e.target.value) }); }} placeholder="Ej.: timbre fiscal" />
            {pista && <small className="hint muted">{pista}</small>}
          </div>
        )}
        <div className="form-row" style={{ flex: '2 1 200px' }}>
          <label>Nombre</label>
          <input className="input" value={ficha.nombre} onChange={(e) => set({ nombre: e.target.value })} />
        </div>
        <div className="form-row" style={{ flex: '2 1 220px' }}>
          <label>Ente que lo crea y cobra</label>
          <select className="select" value={ficha.enteId ?? ''} onChange={(e) => set({ enteId: e.target.value || null })}>
            <option value="">Sin ente</option>
            {entes.filter((e) => e.activo || e.id === ficha.enteId).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ flex: '1 1 180px' }}>
          <label>{ROTULO_ORDEN}</label>
          <CampoEntero valor={ficha.orden} {...ENTEROS_IMPUESTO.orden} onValor={(orden) => set({ orden })} />
          <small className="hint muted">{AYUDA_ORDEN}</small>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '.86rem', margin: '.2rem 0 .5rem' }}>
        <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="checkbox" checked={ficha.activo} onChange={(e) => set({ activo: e.target.checked })} /> Activo</label>
        <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="checkbox" checked={ficha.admitePracticada} onChange={(e) => set({ admitePracticada: e.target.checked })} /> La empresa la practica</label>
        <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="checkbox" checked={ficha.admiteSufrida} onChange={(e) => set({ admiteSufrida: e.target.checked })} /> Se la practican a la empresa</label>
        <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="checkbox" checked={ficha.agrupa} onChange={(e) => set({ agrupa: e.target.checked })} /> Agrupar comprobantes</label>
        <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="checkbox" checked={ficha.numeraOperacion} onChange={(e) => set({ numeraOperacion: e.target.checked })} /> Lleva «Operación N°»</label>
      </div>
      <div className="card" style={{ margin: '0 0 .5rem' }}>
        <label style={{ display: 'inline-flex', gap: '.3rem', fontSize: '.86rem', fontWeight: 600 }}>
          <input type="checkbox" checked={ficha.numera} onChange={(e) => set({ numera: e.target.checked, serieFormato: e.target.checked ? ficha.serieFormato ?? 'N10' : ficha.serieFormato })} />
          Numera sus comprobantes
        </label>
        {ficha.numera && (
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
            <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
              <label>Formato del número</label>
              <select className="select" value={ficha.serieFormato ?? ''} onChange={(e) => set({ serieFormato: (e.target.value || null) as FormatoSerie | null })}>
                {(['AAAAMM8', 'N10'] as const).map((f) => <option key={f} value={f}>{rotuloSerie(f)}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px', margin: 0 }}>
              <label>Quién da el número</label>
              <select className="select" value={ficha.serieModo} onChange={(e) => set({ serieModo: e.target.value as ModoSerie })}>
                <option value="automatica">El sistema (editable)</option>
                <option value="manual">El otro sistema (se escribe a mano)</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 130px', margin: 0 }}>
              <label>Primer número</label>
              <CampoEntero valor={ficha.serieInicial} {...ENTEROS_IMPUESTO.serieInicial} onValor={(serieInicial) => set({ serieInicial })} />
            </div>
            <div className="form-row" style={{ flex: '1 1 170px', margin: 0 }}>
              <label>Último del otro sistema</label>
              <input className="input mono" inputMode="numeric" value={ficha.serieUltimoOtroSistema == null ? '' : String(ficha.serieUltimoOtroSistema)}
                onChange={(e) => set({ serieUltimoOtroSistema: num(e.target.value.replace(/\D/g, '')) })} placeholder="Si convive" />
            </div>
          </div>
        )}
        {ficha.numera && <small className="hint muted">Una serie que ya dio números no cambia de formato.</small>}
      </div>
      <div className="form-row" style={{ maxWidth: 260 }}>
        <label>Exporta</label>
        <select className="select" value={ficha.exporta} onChange={(e) => set({ exporta: e.target.value as Exporta })}>
          {EXPORTA.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
      </div>
    </>
  );
}

/**
 * Un entero escrito a mano (orden, días, número de serie), con el lector de
 * todo el sistema: vacío = `porDefecto` (y lo dice), «0» es 0, y lo que no se
 * entiende queda como NaN en el dato (bloquea el guardado) con su mensaje aquí.
 */
function CampoEntero({ valor, campo, porDefecto, onValor }: { valor: number; campo: string; porDefecto: number; onValor: (n: number) => void }) {
  const [texto, setTexto] = useState(numeroATexto(valor));
  const leido = leerEntero(texto, campo, porDefecto);
  // Si el dato cambia desde afuera (Deshacer, otro usuario), el texto lo sigue.
  useEffect(() => {
    if (!Number.isFinite(valor)) return;
    const l = leerEntero(texto, campo, porDefecto);
    if ('error' in l || l.valor !== valor) setTexto(numeroATexto(valor));
  }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <input className="input mono" type="text" inputMode="numeric" value={texto}
        onChange={(e) => { setTexto(e.target.value); const l = leerEntero(e.target.value, campo, porDefecto); onValor('error' in l ? NaN : l.valor); }} />
      {'error' in leido
        ? <small className="hint" style={{ color: 'var(--warning)' }}>{leido.error}</small>
        : !texto.trim() && <small className="hint muted">Vacío = {porDefecto}</small>}
    </>
  );
}

function CamposVersion({ v, set }: { v: DatosVersion; set: (p: Partial<DatosVersion>) => void }) {
  return (
    <>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '1 1 140px' }}>
          <label>Periodicidad</label>
          <select className="select" value={v.periodicidad} onChange={(e) => set({ periodicidad: e.target.value as Periodicidad })}>
            {PERIODICIDADES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ flex: '0 1 120px' }}>
          <label>Vence el día</label>
          <input className="input mono" inputMode="numeric" value={v.venceDia == null ? '' : String(v.venceDia)}
            onChange={(e) => set({ venceDia: e.target.value.trim() ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="Calendario" />
        </div>
        <div className="form-row" style={{ flex: '2 1 220px' }}>
          <label>Si vence en día inhábil</label>
          <select className="select" value={v.venceSiInhabil} onChange={(e) => set({ venceSiInhabil: e.target.value as VenceSiInhabil })}>
            {VENCE_SI_INHABIL.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ flex: '0 1 170px' }}>
          <label>Plazo de entrega (días)</label>
          <CampoEntero valor={v.plazoEntregaDias} {...ENTEROS_IMPUESTO.plazoEntregaDias} onValor={(plazoEntregaDias) => set({ plazoEntregaDias })} />
        </div>
        <label className="form-row" style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', minHeight: 36 }}>
          <input type="checkbox" checked={v.plazoDiasHabiles} onChange={(e) => set({ plazoDiasHabiles: e.target.checked })} /> Días hábiles (lunes a viernes)
        </label>
      </div>
      <div className="card" style={{ margin: '0 0 .5rem' }}>
        <label style={{ display: 'inline-flex', gap: '.3rem', fontSize: '.86rem' }}>
          <input type="checkbox" checked={v.convive} onChange={(e) => set({ convive: e.target.checked })} /> Convive con otro sistema
        </label>
        {v.convive && (
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.3rem' }}>
            <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
              <label>Nombre del otro sistema</label>
              <input className="input" value={v.otroSistemaNombre ?? ''} onChange={(e) => set({ otroSistemaNombre: e.target.value })} />
            </div>
            <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.84rem', minHeight: 36 }}>
              <input type="checkbox" checked={v.otroSistemaEnTotales} onChange={(e) => set({ otroSistemaEnTotales: e.target.checked })} /> Sumar lo del otro sistema en los totales
            </label>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
        <div className="form-row" style={{ flex: '2 1 240px' }}>
          <label>Base legal</label>
          <input className="input" value={v.baseLegal ?? ''} onChange={(e) => set({ baseLegal: e.target.value })} placeholder="Providencia, decreto u ordenanza" />
        </div>
        <div className="form-row" style={{ flex: '2 1 200px' }}>
          <label>Fuente</label>
          <input className="input" value={v.fuente ?? ''} onChange={(e) => set({ fuente: e.target.value })} />
        </div>
      </div>
    </>
  );
}

function VersionModal({ impuesto, vigente, modo, onClose, onHecho }: {
  impuesto: Impuesto; vigente: VersionImpuesto | null; modo: 'nueva' | 'corregir'; onClose: () => void; onHecho: () => void;
}) {
  const ultima = impuesto.versiones[0] ?? null;
  const minimo = desdeMinimo(ultima);
  const [v, setV] = useState<DatosVersion>(datosDe(modo === 'corregir' ? vigente : ultima));
  const [desde, setDesde] = useState(minimo && minimo > hoyIso() ? minimo : hoyIso());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const falta = faltaEnEnteros(v) ?? faltaEnVersion(v, modo === 'nueva' ? desde : '2000-01-01', motivo)
    ?? (modo === 'nueva' && minimo && desde < minimo ? `La versión nueva tiene que empezar el ${fechaCorta(minimo)} o después.` : null);

  async function guardar() {
    setGuardando(true);
    try {
      if (modo === 'nueva') await nuevaVersion(impuesto.clave, v, desde, motivo);
      else if (vigente) await corregirVersion(vigente.id, v, motivo);
      toast(modo === 'nueva' ? 'Versión nueva guardada.' : 'Versión corregida.', 'success');
      onHecho();
    } catch (e) {
      toast(mensaje(e, 'No se pudo guardar la versión.'), 'error');
      setGuardando(false);
    }
  }

  return (
    <Modal title={`${impuesto.nombre} · ${modo === 'nueva' ? 'Nueva versión' : `Corregir la versión desde ${fechaCorta(vigente?.desde)}`}`} size="lg"
      onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        {modo === 'nueva'
          ? <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>La versión vigente se cierra el día antes de la nueva. Las retenciones anteriores siguen con la suya.</p>
          : <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>Corrige lo que se cargó mal en la vigente, sin cambiar su fecha. Para un cambio de reglas desde una fecha, usa «Nueva versión desde…».</p>}
        <CamposVersion v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {modo === 'nueva' && (
            <div className="form-row" style={{ flex: '0 1 170px' }}>
              <label>Vale desde</label>
              <input className="input" type="date" value={desde} min={minimo ?? undefined} onChange={(e) => setDesde(e.target.value)} />
            </div>
          )}
          <div className="form-row" style={{ flex: '2 1 260px' }}>
            <label>Motivo</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        {falta && <small className="hint" style={{ color: motivo || modo === 'nueva' ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}

function NuevoImpuestoModal({ entes, onClose, onHecho }: { entes: Ente[]; onClose: () => void; onHecho: () => void }) {
  const [ficha, setFicha] = useState<FichaImpuesto>({
    clave: '', nombre: '', enteId: null, admitePracticada: true, admiteSufrida: true, numera: true, serieFormato: 'N10',
    serieModo: 'automatica', serieInicial: 1, serieUltimoOtroSistema: null, numeraOperacion: false, agrupa: false,
    exporta: 'ninguno', orden: 10, activo: true,
  });
  const [v, setV] = useState<DatosVersion>({ ...VERSION_VACIA });
  const [desde, setDesde] = useState(hoyIso());
  const [motivo, setMotivo] = useState('Alta del impuesto');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const falta = faltaEnEnteros({ ...ficha, ...v }) ?? faltaEnImpuesto(ficha) ?? faltaEnVersion(v, desde, motivo);

  async function crear() {
    setGuardando(true); setError(null);
    try {
      await crearImpuesto(ficha, v, desde, motivo);
      toast(`Impuesto ${ficha.nombre} creado.`, 'success');
      onHecho();
    } catch (e) {
      setError(mensaje(e, 'No se pudo crear el impuesto.'));
      setGuardando(false);
    }
  }

  return (
    <Modal title="Nuevo impuesto" size="xl" onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void crear()} disabled={!!falta || guardando}>{guardando ? 'Guardando…' : 'Crear impuesto'}</button>
        </>
      )}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}>{error}</div>}
      <fieldset disabled={guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <CamposFicha ficha={ficha} set={(p) => setFicha((f) => ({ ...f, ...p }))} entes={entes} conClave />
        <h4 style={{ margin: '.6rem 0 .3rem' }}>Primera versión</h4>
        <CamposVersion v={v} set={(p) => setV((x) => ({ ...x, ...p }))} />
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '0 1 170px' }}>
            <label>Vale desde</label>
            <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="form-row" style={{ flex: '2 1 260px' }}>
            <label>Motivo</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        {falta && <small className="hint" style={{ color: ficha.clave ? 'var(--warning)' : undefined }}>{falta}</small>}
      </fieldset>
    </Modal>
  );
}
