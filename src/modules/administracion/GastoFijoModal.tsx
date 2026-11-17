/* ============================================================
   Golden Touch · Administración · alta/edición de un GASTO FIJO (plantilla)
   Formulario en Modal (estilo del sistema). Validación por campo en línea,
   tasa BCV precargada con su equivalente en Bs, y el vencimiento guiado según
   la periodicidad, con vista previa del próximo vencimiento. Define solo la
   plantilla (no mueve dinero). empresa_clave = la elegida.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect, SearchCreateSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { proximoVencimiento, type Moneda, type Periodicidad } from './administracionCalculo';
import { cargarTasaBcv } from './administracionTasa';
import { obtenerListaResponsables, type CentroAcopio } from './administracionCentrosResponsables';
import type { AdminRepo, Empresa, GastoFijo, GastoFijoInput, OpcionRef } from './admin.repository';

const PERIODICIDADES: { v: Periodicidad; label: string }[] = [
  { v: 'mensual', label: 'Mensual' }, { v: 'bimensual', label: 'Bimensual' }, { v: 'trimestral', label: 'Trimestral' },
  { v: 'semestral', label: 'Semestral' }, { v: 'anual', label: 'Anual' },
];
const MONEDAS: Moneda[] = ['Bs', 'USD'];
/** Dónde cae el día de vencimiento, según la periodicidad (para explicarlo). */
const VENC_CTX: Record<Periodicidad, string> = {
  mensual: 'de cada mes',
  bimensual: 'del primer mes de cada bimestre',
  trimestral: 'del primer mes de cada trimestre',
  semestral: 'del primer mes de cada semestre',
  anual: 'del primer mes de cada año',
};
const hoyISO = () => new Date().toISOString().slice(0, 10);
const fFecha = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const num2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Draft {
  empresaClave: string; concepto: string; proveedorNombre: string; categoriaGastoId: string;
  monto: string; moneda: Moneda; tasaRef: string; periodicidad: Periodicidad;
  diaVencimiento: string; vigenteDesde: string; estado: 'activo' | 'suspendido';
  centroAcopioId: string; responsable: string;
}

function draftDe(g: GastoFijo | null | undefined, empresaClaveFija: string | null, monedaEmpresa: Moneda | null): Draft {
  if (g) {
    return {
      empresaClave: g.empresaClave, concepto: g.concepto, proveedorNombre: g.proveedorNombre ?? '',
      categoriaGastoId: g.categoriaGastoId ?? '', monto: String(g.monto), moneda: g.moneda,
      tasaRef: g.tasaRef == null ? '' : String(g.tasaRef), periodicidad: g.periodicidad,
      diaVencimiento: g.diaVencimiento == null ? '' : String(g.diaVencimiento), vigenteDesde: g.vigenteDesde, estado: g.estado,
      centroAcopioId: g.centroAcopioId ?? '', responsable: g.responsable ?? '',
    };
  }
  return {
    empresaClave: empresaClaveFija ?? '', concepto: '', proveedorNombre: '', categoriaGastoId: '',
    monto: '', moneda: monedaEmpresa ?? 'USD', tasaRef: '', periodicidad: 'mensual',
    diaVencimiento: '', vigenteDesde: hoyISO(), estado: 'activo',
    centroAcopioId: '', responsable: '',
  };
}

export function GastoFijoModal({ repo, empresas, empresaClaveFija, categorias, proveedores, gasto, onClose, onSaved }: {
  repo: AdminRepo;
  empresas: Empresa[];
  /** Si hay una empresa elegida en la cabecera, se fija; con 'Todas' va null y se elige aquí. */
  empresaClaveFija: string | null;
  categorias: OpcionRef[];
  proveedores: OpcionRef[];
  gasto?: GastoFijo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const monedaEmpresa = useMemo(
    () => empresas.find((e) => e.clave === empresaClaveFija)?.moneda ?? null,
    [empresas, empresaClaveFija],
  );
  const [d, setD] = useState<Draft>(() => draftDe(gasto, empresaClaveFija, monedaEmpresa));
  const [guardando, setGuardando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [bcv, setBcv] = useState<number | null>(null);
  // Los centros viven en la base (Configuracion los crea). Antes se leia una lista
  // fija del codigo, asi que lo que la lider creaba no aparecia aqui nunca.
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  useEffect(() => { repo.listCentros().then(setCentros).catch(() => setCentros([])); }, [repo]);
  const opcionesResponsables = useMemo(() => obtenerListaResponsables(centros, [], gasto ? [gasto] : []), [centros, gasto]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  // Tasa BCV del día: para precargar la referencia (alta nueva en USD) y el equivalente.
  useEffect(() => {
    let vivo = true;
    void cargarTasaBcv().then((t) => {
      if (!vivo) return;
      setBcv(t.tasa);
      setD((p) => (!gasto && p.tasaRef.trim() === '' && p.moneda === 'USD' ? { ...p, tasaRef: String(t.tasa) } : p));
    });
    return () => { vivo = false; };
  }, [gasto]);

  const empresasActivas = useMemo(() => empresas.filter((e) => e.activa || e.clave === d.empresaClave), [empresas, d.empresaClave]);

  const montoNum = Number(d.monto);
  const tasaNum = d.tasaRef.trim() === '' ? null : Number(d.tasaRef);
  const diaNum = d.diaVencimiento.trim() === '' ? null : Number(d.diaVencimiento);

  // Validación por campo (se muestra tras el primer intento de guardar, y se actualiza en vivo).
  const err = {
    empresa: !d.empresaClave ? 'Elija la empresa del gasto.' : '',
    concepto: !d.concepto.trim() ? 'El concepto es obligatorio.' : '',
    monto: !Number.isFinite(montoNum) || montoNum <= 0 ? 'Indique un monto mayor que cero.' : '',
    tasa: tasaNum != null && (!Number.isFinite(tasaNum) || tasaNum <= 0) ? 'La tasa debe ser un número positivo.' : '',
    dia: diaNum != null && (!Number.isInteger(diaNum) || diaNum < 1 || diaNum > 31) ? 'El día va de 1 a 31.' : '',
  };
  const hayError = Object.values(err).some(Boolean);
  const E = (campo: keyof typeof err) => (intento && err[campo] ? <small className="adm-err">{err[campo]}</small> : null);

  // Equivalente en Bs cuando el gasto es en USD y hay tasa.
  const equivBs = d.moneda === 'USD' && montoNum > 0 && tasaNum && tasaNum > 0 ? montoNum * tasaNum : null;
  // Próximo vencimiento según el borrador (guía lo que significa el «día»).
  const prox = useMemo(() => {
    try { return proximoVencimiento({ periodicidad: d.periodicidad, diaVencimiento: diaNum, vigenteDesde: d.vigenteDesde }); }
    catch { return null; }
  }, [d.periodicidad, diaNum, d.vigenteDesde]);

  async function guardar() {
    setIntento(true);
    if (hayError) { toast('Revise los campos marcados.', 'warning', { silent: true }); return; }
    const provNombre = d.proveedorNombre.trim();
    const proveedorId = provNombre ? proveedores.find((p) => p.nombre.toLowerCase() === provNombre.toLowerCase())?.id ?? null : null;
    const entrada: GastoFijoInput = {
      empresaClave: d.empresaClave, concepto: d.concepto.trim(), proveedorId, proveedorNombre: provNombre || null,
      categoriaGastoId: d.categoriaGastoId || null, monto: Math.round(montoNum * 100) / 100, moneda: d.moneda, tasaRef: tasaNum,
      periodicidad: d.periodicidad, diaVencimiento: diaNum == null ? null : Math.trunc(diaNum), vigenteDesde: d.vigenteDesde, estado: d.estado,
      centroAcopioId: d.centroAcopioId.trim() || null, responsable: d.responsable.trim() || null,
    };
    setGuardando(true);
    try {
      if (gasto) await repo.editarGastoFijo(gasto.id, entrada);
      else await repo.crearGastoFijo(entrada);
      toast(gasto ? 'Gasto fijo actualizado.' : 'Gasto fijo creado.', 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(`No se pudo guardar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title={gasto ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : gasto ? 'Guardar cambios' : 'Crear gasto fijo'}
          </button>
        </>
      }
    >
      <div className="form-grid-2">
        <div className="form-row">
          <label htmlFor="gf-empresa">Empresa</label>
          {empresaClaveFija ? (
            <input id="gf-empresa" className="input" value={empresas.find((e) => e.clave === empresaClaveFija)?.nombre ?? empresaClaveFija} disabled />
          ) : (
            <SearchSelect id="gf-empresa" placeholder="Elija la empresa…"
              options={empresasActivas.map((e) => ({ value: e.clave, label: e.nombre, hint: e.clave }))}
              value={d.empresaClave} onChange={(v) => set('empresaClave', v)} />
          )}
          {E('empresa')}
        </div>
        <div className="form-row">
          <label htmlFor="gf-concepto">Concepto</label>
          <input id="gf-concepto" className="input" value={d.concepto} onChange={(e) => set('concepto', e.target.value)} placeholder="Agua, alquiler, honorarios…" autoFocus />
          {E('concepto')}
        </div>
        <div className="form-row">
          <label htmlFor="gf-prov">Proveedor / beneficiario <span className="muted">(catálogo o libre)</span></label>
          <SearchCreateSelect id="gf-prov" placeholder="Escriba o elija…" options={proveedores.map((p) => p.nombre)}
            value={d.proveedorNombre} onChange={(v) => set('proveedorNombre', v)} />
        </div>
        <div className="form-row">
          <label htmlFor="gf-cat">Categoría de gasto</label>
          <SearchSelect id="gf-cat" placeholder="Sin categoría" options={categorias.map((c) => ({ value: c.id, label: c.nombre }))}
            value={d.categoriaGastoId} onChange={(v) => set('categoriaGastoId', v)} />
        </div>
        <div className="form-row">
          <label htmlFor="gf-centro">🏭 Centro de acopio <span className="muted">(opcional)</span></label>
          <select
            id="gf-centro"
            className="input"
            value={d.centroAcopioId}
            onChange={(e) => {
              const cid = e.target.value;
              const c = centros.find((x) => x.id === cid);
              setD((p) => ({
                ...p,
                centroAcopioId: cid,
                responsable: !p.responsable.trim() && c?.responsablePrincipal ? c.responsablePrincipal : p.responsable,
              }));
            }}
          >
            <option value="">🏢 General / Toda la empresa</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                🏭 {c.nombre} ({c.empresaClave})
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="gf-responsable">👤 Responsable / Analista a cargo <span className="muted">(catálogo o libre)</span></label>
          <SearchCreateSelect
            id="gf-responsable"
            placeholder="Elija o escriba el analista/responsable…"
            options={opcionesResponsables}
            value={d.responsable}
            onChange={(v) => set('responsable', v)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="gf-monto">Monto</label>
          <input id="gf-monto" className="input" type="number" min="0" step="0.01" inputMode="decimal"
            value={d.monto} onChange={(e) => set('monto', e.target.value)} placeholder="0,00" />
          {equivBs != null ? <small className="muted">≈ Bs {num2(equivBs)} a la tasa de referencia</small> : null}
          {E('monto')}
        </div>
        <div className="form-row">
          <label htmlFor="gf-moneda">Moneda</label>
          <select id="gf-moneda" className="input" value={d.moneda} onChange={(e) => set('moneda', e.target.value as Moneda)}>
            {MONEDAS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="gf-tasa">Tasa de referencia <span className="muted">(Bs/USD, opcional)</span></label>
          <input id="gf-tasa" className="input" type="number" min="0" step="0.01" inputMode="decimal"
            value={d.tasaRef} onChange={(e) => set('tasaRef', e.target.value)} placeholder="p. ej. 40,00" />
          {bcv != null && d.tasaRef.trim() !== '' && Number(d.tasaRef) === bcv
            ? <small className="muted">Tasa BCV de hoy ({num2(bcv)}).</small>
            : bcv != null ? <button type="button" className="btn-linkish" onClick={() => set('tasaRef', String(bcv))}>Usar la tasa BCV de hoy ({num2(bcv)})</button> : null}
          {E('tasa')}
        </div>
        <div className="form-row">
          <label htmlFor="gf-periodicidad">Periodicidad</label>
          <select id="gf-periodicidad" className="input" value={d.periodicidad} onChange={(e) => set('periodicidad', e.target.value as Periodicidad)}>
            {PERIODICIDADES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="gf-dia">Vence el día <span className="muted">(opcional)</span></label>
          <input id="gf-dia" className="input" type="number" min="1" max="31" step="1" inputMode="numeric"
            value={d.diaVencimiento} onChange={(e) => set('diaVencimiento', e.target.value)} placeholder="1" />
          <small className="muted">Día {d.diaVencimiento.trim() || '1'} {VENC_CTX[d.periodicidad]}{prox ? ` · próximo: ${fFecha.format(prox)}` : ''}.</small>
          {E('dia')}
        </div>
        <div className="form-row">
          <label htmlFor="gf-desde">Vigente desde</label>
          <input id="gf-desde" className="input" type="date" value={d.vigenteDesde} onChange={(e) => set('vigenteDesde', e.target.value)} />
          <small className="muted">Ancla para calcular los períodos.</small>
        </div>
        <div className="form-row">
          <label htmlFor="gf-estado">Estado</label>
          <select id="gf-estado" className="input" value={d.estado} onChange={(e) => set('estado', e.target.value as 'activo' | 'suspendido')}>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
