/* ============================================================
   MGG · Campo «🧾 CARGAR FACTURA» de la recepción (11-11-2026)

   El almacenista, al recepcionar la orden (PC y teléfono), DEBE cargar la
   factura: fotos o PDF. Se suben antes de recibir (si fallan, no se recibe) y
   Compras las ve en «🧾 Factura» → FACTURAS ALMACÉN.
   ============================================================ */
import { useEffect, useMemo } from 'react';
import { toast } from '@/shared/ui/Toast';
import { errorArchivoFactura, MAX_FACTURAS_ALMACEN } from './facturasOrden.repository';

export function CargarFacturaCampo({ id, archivos, onChange, obligatoria = true, className = 'form-row', disabled = false }: {
  id: string;
  archivos: File[];
  onChange: (xs: File[]) => void;
  obligatoria?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const previas = useMemo(() => archivos.map((f) => (/^image\//.test(f.type) ? URL.createObjectURL(f) : '')), [archivos]);
  useEffect(() => () => { previas.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [previas]);
  const faltan = MAX_FACTURAS_ALMACEN - archivos.length;

  function agregar(lista: FileList | null) {
    const xs = Array.from(lista ?? []);
    for (const f of xs) { const e = errorArchivoFactura(f); if (e) { toast(e, 'error'); return; } }
    if (xs.length > faltan) toast(`Se pueden cargar hasta ${MAX_FACTURAS_ALMACEN} archivos de factura.`, 'warning');
    onChange([...archivos, ...xs].slice(0, MAX_FACTURAS_ALMACEN));
  }

  return (
    <div className={className}>
      <label htmlFor={id}>
        🧾 CARGAR FACTURA {obligatoria ? <strong style={{ color: 'var(--danger)' }}>(obligatoria)</strong> : '(opcional)'} · {archivos.length}/{MAX_FACTURAS_ALMACEN}
      </label>
      {faltan > 0 && (
        <input id={id} className="input" type="file" accept="image/*,application/pdf" multiple disabled={disabled}
          onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
      )}
      {!!archivos.length && (
        <div className="rep-fotos" style={{ marginTop: '.4rem' }}>
          {archivos.map((f, i) => (
            <div key={`${f.name}-${i}`} className="rep-foto surt-foto-quitar" title={f.name}>
              {previas[i] ? <img src={previas[i]} alt={f.name} /> : <span className="rep-foto-doc">📄</span>}
              {!disabled && <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => onChange(archivos.filter((_, j) => j !== i))}>✕</button>}
            </div>
          ))}
        </div>
      )}
      <small className="hint muted">Foto o PDF de la factura del proveedor. Compras la ve en «🧾 Factura» de la OC.</small>
    </div>
  );
}
