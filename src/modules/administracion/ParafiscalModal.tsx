/* ============================================================
   Golden Touch · Administración · calculadora de parafiscales (FAOV)
   Alta guiada: elegís empresa, nº de trabajadores (→ factor 165/330/1000),
   la tasa de referencia (precargada con la BCV de mayor valor) y el período, y
   el total (factor × tasa, en Bs) se registra como un movimiento pendiente del
   histórico — listo para pagarse desde Tesorería.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { tokenPeriodo } from './administracionCalculo';
import { calcularFaov, tierPorTrabajadores, FAOV_TIERS, type TierFaov } from './administracionParafiscal';
import type { AdminRepo, Empresa, OpcionRef } from './admin.repository';

const num2 = (n: number) => n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ParafiscalModal({ repo, empresas, empresaClaveFija, categorias, onClose, onSaved }: {
  repo: AdminRepo; empresas: Empresa[]; empresaClaveFija: string | null; categorias: OpcionRef[]; onClose: () => void; onSaved: () => void;
}) {
  const activas = empresas.filter((e) => e.activa);
  const [empresaClave, setEmpresaClave] = useState(empresaClaveFija ?? activas[0]?.clave ?? '');
  const [trabajadores, setTrabajadores] = useState('');
  const [tasaRef, setTasaRef] = useState('');
  const [monedaRef, setMonedaRef] = useState('EUR');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [estadoPago, setEstado] = useState<'pendiente' | 'pagado'>('pendiente');
  const [guardando, setGuardando] = useState(false);

  // Precarga la tasa de referencia con la BCV de MAYOR valor (suele ser el EUR).
  useEffect(() => {
    getTasaHoy().then((t) => {
      const usd = Number(t?.usd) || 0;
      const eur = Number(t?.eur) || 0;
      const mayor = Math.max(usd, eur);
      if (mayor > 0) { setTasaRef(String(mayor)); setMonedaRef(eur >= usd ? 'EUR' : 'USD'); }
    }).catch(() => { /* sin tasa: la carga el usuario */ });
  }, []);

  // Los factores se ajustan en Configuracion; aqui solo se usan.
  const [tiers, setTiers] = useState<TierFaov[]>(FAOV_TIERS);
  useEffect(() => { repo.leerFactoresFaov().then(setTiers).catch(() => { /* quedan los vigentes */ }); }, [repo]);
  const tier = useMemo(() => tierPorTrabajadores(Number(trabajadores) || 0, tiers), [trabajadores, tiers]);
  const total = useMemo(() => calcularFaov(tier.factor, Number(tasaRef.replace(',', '.')) || 0), [tier, tasaRef]);
  const catParafiscal = useMemo(
    () => categorias.find((c) => c.nombre.toLowerCase().includes('parafiscal'))?.id ?? null,
    [categorias],
  );

  async function guardar() {
    const t = Number(tasaRef.replace(',', '.'));
    if (!empresaClave) return toast('Elija una empresa.', 'error');
    if (!trabajadores.trim()) return toast('Indique el número de trabajadores.', 'error');
    if (!Number.isFinite(t) || t <= 0) return toast('Indique la tasa de referencia.', 'error');
    if (total <= 0) return toast('El total no puede ser 0.', 'error');
    setGuardando(true);
    try {
      await repo.crearMovimiento({
        empresaClave, gastoFijoId: null,
        concepto: `FAOV · ${tier.label} (factor ${tier.factor} × ${num2(t)} ${monedaRef})`,
        proveedorNombre: 'BANAVIH', categoriaGastoId: catParafiscal,
        periodo: tokenPeriodo(fecha, 'mensual'), fecha, monto: total, moneda: 'Bs',
        tasaRef: t, estadoPago, origen: 'manual', servicioDirectoId: null,
      });
      toast('Parafiscal (FAOV) registrado.', 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(`No se pudo registrar: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setGuardando(false);
    }
    return undefined;
  }

  return (
    <Modal title="⚖ Parafiscal · FAOV / BANAVIH" onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Registrando…' : 'Registrar parafiscal'}</button>
      </>}>
      <p className="muted hint" style={{ marginTop: 0 }}>
        Multa FAOV (Gaceta Extra 6.805, art. 98): <b>factor × la tasa BCV de mayor valor</b>, según el tamaño de la nómina.
      </p>
      <div className="form-grid-2">
        <div className="form-row">
          <label htmlFor="pf-empresa">Empresa</label>
          <select id="pf-empresa" className="input" value={empresaClave} onChange={(e) => setEmpresaClave(e.target.value)}>{activas.map((e) => <option key={e.id} value={e.clave}>{e.nombre}</option>)}</select>
        </div>
        <div className="form-row">
          <label htmlFor="pf-fecha">Fecha</label>
          <input id="pf-fecha" type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-row">
          <label htmlFor="pf-trab">Trabajadores (nómina)</label>
          <input id="pf-trab" className="input" type="number" min="0" step="1" inputMode="numeric" value={trabajadores} onChange={(e) => setTrabajadores(e.target.value)} placeholder="0" autoFocus />
          <small className="muted">{tier.label} → factor <strong>{tier.factor}</strong></small>
        </div>
        <div className="form-row">
          <label htmlFor="pf-tasa">Tasa de referencia (BCV de mayor valor)</label>
          <div style={{ display: 'flex', gap: '.4rem' }}>
            <input id="pf-tasa" className="input" type="number" min="0" step="0.0001" inputMode="decimal" value={tasaRef} onChange={(e) => setTasaRef(e.target.value)} placeholder="0,00" style={{ flex: 1 }} />
            <select className="input" value={monedaRef} onChange={(e) => setMonedaRef(e.target.value)} style={{ maxWidth: 90 }}><option value="EUR">EUR</option><option value="USD">USD</option></select>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="pf-estado">Estado</label>
          <select id="pf-estado" className="input" value={estadoPago} onChange={(e) => setEstado(e.target.value as 'pendiente' | 'pagado')}><option value="pendiente">Pendiente</option><option value="pagado">Pagado</option></select>
        </div>
      </div>

      <div className="adm-kpi oro" style={{ marginTop: '.8rem' }}>
        <span className="adm-kpi-lbl">Total a pagar</span>
        <span className="adm-kpi-num">Bs {num2(total)}</span>
        <span className="adm-kpi-sub">{tier.factor} × {tasaRef ? num2(Number(tasaRef.replace(',', '.')) || 0) : '—'} {monedaRef}</span>
      </div>
    </Modal>
  );
}
