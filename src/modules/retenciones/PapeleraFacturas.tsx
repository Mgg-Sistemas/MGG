import { supabase } from '@/shared/lib/supabase';
import { todasLasFilas } from '@/shared/lib/todasLasFilas';
import { accionesAdjuntosPapelera } from '@/shared/lib/papeleraAdjuntos';
import { BotonPapeleraRegistros, type AccionesPapelera } from '@/shared/ui/PapeleraRegistros';
import { BUCKET_BUZON } from './adjuntosBuzon';
import { TABLE_FACTURAS_EXTERNAS } from './facturasExternas.repository';

interface FacturaPapelera {
  id: string;
  numero_factura: string;
  proveedor_nombre: string;
  eliminado_en: string;
  eliminado_motivo: string;
}

const acciones: AccionesPapelera = {
  modulo: 'retenciones',
  titulo: 'Papelera de facturas externas',
  async listar() {
    const facturas = await todasLasFilas<FacturaPapelera>((desde, hasta) => supabase.from(TABLE_FACTURAS_EXTERNAS)
      .select('id, numero_factura, proveedor_nombre, eliminado_en, eliminado_motivo')
      .not('eliminado_en', 'is', null).order('eliminado_en', { ascending: false }).order('id').range(desde, hasta));
    return facturas.map((f) => ({ ...f, titulo: `#${f.numero_factura} · ${f.proveedor_nombre}` }));
  },
  async recuperar(id) {
    const { error } = await supabase.rpc('ret_factura_recuperar', { p_id: id });
    if (error) throw new Error(error.message);
  },
  async vaciar(ids) {
    const { data, error } = await supabase.rpc('ret_factura_vaciar_papelera', { p_ids: ids });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  },
  ...accionesAdjuntosPapelera('ret_factura_adjuntos_por_vaciar', ['compras-oc', BUCKET_BUZON], async (bucket, rutas) => {
    const { error } = await supabase.rpc('ret_factura_cerrar_limpieza', { p_bucket: bucket, p_rutas: rutas });
    if (error) throw new Error(error.message);
  }),
};

export function BotonPapeleraFacturas({ onChanged }: { onChanged: () => void }) {
  return <BotonPapeleraRegistros acciones={acciones} onChanged={onChanged} />;
}

export { EnviarRegistroPapelera as EnviarFacturaPapelera } from '@/shared/ui/PapeleraRegistros';
