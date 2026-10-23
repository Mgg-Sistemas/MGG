/* ============================================================
   Golden Touch · Retenciones · El N° de factura como buscador (R10)

   Mientras se escribe el N° de factura, muestra las facturas ya registradas
   que todavía tienen algo por retener (por número, control, RIF o
   proveedor; si hay proveedor elegido, solo las suyas). Al elegir una, quien
   lo usa precarga sus datos y retiene sobre ese documento. Si no está, se
   sigue escribiendo como hoy. Sin R10 es un campo de texto común.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { buscarFacturasRetenibles, r10Disponible, type FacturaResumen } from './facturasResumen.repository';
import { rotuloImpuesto } from './rotulos';
import { fechaCorta } from './parametrosR1';

export function BuscadorFactura({ valor, onTexto, proveedorId, onElegir, elegida, onSoltar, deshabilitado = false, placeholder }: {
  valor: string;
  onTexto: (t: string) => void;
  /** Con proveedor elegido, solo sus facturas. */
  proveedorId?: string | null;
  onElegir: (f: FacturaResumen) => void;
  /** La factura elegida (el campo se muestra fijo con ella). */
  elegida?: FacturaResumen | null;
  onSoltar?: () => void;
  deshabilitado?: boolean;
  placeholder?: string;
}) {
  const [conR10, setConR10] = useState(false);
  const [opciones, setOpciones] = useState<FacturaResumen[]>([]);
  const [abierto, setAbierto] = useState(false);
  const pedido = useRef(0);

  useEffect(() => { let vivo = true; void r10Disponible().then((v) => { if (vivo) setConR10(v); }); return () => { vivo = false; }; }, []);

  useEffect(() => {
    if (!conR10 || elegida || deshabilitado || (!valor.trim() && !proveedorId)) { setOpciones([]); return; }
    const n = ++pedido.current;
    const t = setTimeout(() => {
      void buscarFacturasRetenibles(valor, proveedorId).then((xs) => { if (n === pedido.current) setOpciones(xs); }).catch(() => { if (n === pedido.current) setOpciones([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [conR10, valor, proveedorId, elegida, deshabilitado]);

  if (elegida) {
    return (
      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="input mono" style={{ display: 'inline-flex', alignItems: 'center', flex: '1 1 auto' }}>{elegida.facturaNro ?? '—'}</span>
        {onSoltar && !deshabilitado && <button type="button" className="btn btn-sm btn-ghost" onClick={onSoltar}>Cambiar</button>}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input className="input mono" value={valor} disabled={deshabilitado} maxLength={30} placeholder={placeholder ?? 'Número fiscal (no el código de la OC)'}
        onChange={(e) => { onTexto(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)} />
      {conR10 && abierto && opciones.length > 0 && (
        <div className="card" role="listbox" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', margin: 0, padding: '.2rem', maxHeight: 260, overflowY: 'auto' }}>
          <small className="muted" style={{ display: 'block', padding: '.2rem .4rem' }}>Facturas ya registradas con algo por retener:</small>
          {opciones.map((f) => (
            <button key={f.documentoId} type="button" className="btn btn-ghost btn-sm" role="option" aria-selected={false}
              style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal' }}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { setAbierto(false); onElegir(f); }}>
              <strong className="mono">{f.facturaNro ?? 'Sin número'}</strong>
              {f.facturaControl && <span className="mono muted"> · control {f.facturaControl}</span>}
              {' · '}{f.razonSocial ?? 'Sin proveedor'}{f.facturaFecha ? ` · ${fechaCorta(f.facturaFecha)}` : ''}
              <span className="muted"> · por retener: {f.pendientes.map(rotuloImpuesto).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
