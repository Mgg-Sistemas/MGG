/* ============================================================
   Golden Touch · Libro fiscal · Borrar una factura libre (P03)

   El botón aparece solo con P03 (la base trae el borrado), con permiso de
   escritura y si la factura no tiene ninguna línea de retención (ni anulada).
   Decisiones y notas que la afecten las revisa la base y lo dice
   (RET_DOCUMENTO_NO_LIBRE). Pide confirmación; el borrado queda en el historial.
   ============================================================ */
import { useEffect, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { p03Disponible } from './disponibilidad';
import { puedeOfrecerBorrar } from './facturaDocumento';
import { borrarFacturaLibre, type FacturaConLineas } from './retencionFacturas.repository';

export function BorrarFacturaLibre({ factura, puedeEditar, onBorrada }: {
  factura: FacturaConLineas; puedeEditar: boolean; onBorrada?: () => void;
}) {
  const [conP03, setConP03] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void p03Disponible().then((v) => { if (vivo) setConP03(v); });
    return () => { vivo = false; };
  }, []);

  if (!conP03 || !puedeEditar || !puedeOfrecerBorrar(factura)) return null;

  const f = factura.factura;
  const nombre = `${f.tipoDocumento === 'factura' ? 'la factura' : 'la nota'}${f.facturaNro ? ` N° ${f.facturaNro}` : ''}${f.contraparteNombre ? ` de ${f.contraparteNombre}` : ''}`;

  async function borrar() {
    setBorrando(true);
    try {
      await borrarFacturaLibre(f.id);
      toast('Factura borrada', 'success');
      setConfirmar(false);
      onBorrada?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar la factura', 'error');
    } finally {
      setBorrando(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} disabled={borrando}
        title="Borrar esta factura: no tiene retenciones" onClick={() => setConfirmar(true)}>🗑 Borrar</button>
      {confirmar && (
        <ConfirmDialog title="Borrar factura" danger confirmText={borrando ? 'Borrando…' : 'Borrar'}
          message={`¿Borrar ${nombre}? No tiene retenciones. Si salió de un archivo de Compras, el archivo queda sin registrar. No se puede deshacer.`}
          onConfirm={borrar} onCancel={() => setConfirmar(false)} />
      )}
    </>
  );
}
