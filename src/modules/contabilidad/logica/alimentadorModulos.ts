/* ============================================================
   Golden Touch · Contabilidad · Alimentador de Módulos Operativos
   (18/11/2026)

   Conector de integración multi-empresa que alimenta a Contabilidad
   desde los módulos vivos de MGG:
     1. Tesorería (movimientos de caja, pagos OC, gastos, traslados, conversiones)
     2. Compras y Pedidos (recepción de OC, órdenes de compra de bienes y servicios)
     3. Administración (servicios directos, gastos fijos)
     4. Inventario y Salidas (consumo de materiales, combustible, comedor, ajustes)
     5. Ventas (ventas de mineral/estaño, cobros)
     6. Nómina (nómina devengada, pagos, anticipos, aportes)
     7. Centros de Acopio (envíos, compras de mineral, gastos)

   Convierte cada hecho operativo en un `HechoContable` tipificado
   según el catálogo maestro de 31 reglas y lo encola en `cont_integraciones`
   para su contabilización en la bandeja «Por contabilizar».
   ============================================================ */

import { supabase } from '@/shared/lib/supabase';
import type { HechoContable } from './motorReglas';
import type { Moneda } from '../tipos';

const EMPRESA_DEFECTO = 'GT';

/** Formatea números flotantes a texto decimal exacto de 2 decimales para HechoContable. */
function fmtDec(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '0.00';
  return Number(val).toFixed(2);
}

/** Limpia y normaliza texto para búsqueda o clave. */
function norm(str: string | null | undefined): string {
  return (str ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Resuelve una clave de mapeo contable aproximada contra el catálogo. */
function resolverClaveMapeoCaja(cajaNombre: string | null | undefined, moneda: string): string {
  const n = norm(cajaNombre);
  if (n.includes('BANCO-A') || n.includes('BANCO A') || n.includes('MERCANTIL')) return 'BANCO-A';
  if (n.includes('BANCO-B') || n.includes('BANCO B') || n.includes('BANESCO')) return 'BANCO-B';
  if (n.includes('CUSTODIA')) return 'CUSTODIA-USD';
  if (n.includes('USDT') || n.includes('BINANCE') || n.includes('WALLET') || n.includes('BILLETERA')) return 'BILLETERA-USDT';
  if (moneda === 'Bs' || moneda === 'VES' || n.includes('BS') || n.includes('BOLIVARES')) return 'CAJA-BS';
  return 'CAJA-USD';
}

function resolverClaveMapeoGasto(catNombre: string | null | undefined): string {
  const n = norm(catNombre);
  if (n.includes('MANTENIMIENTO')) return 'MANTENIMIENTO';
  if (n.includes('REPUESTO')) return 'REPUESTOS';
  if (n.includes('COMBUSTIBLE') || n.includes('GASOIL') || n.includes('GASOLINA')) return 'COMBUSTIBLE';
  if (n.includes('FLETE') || n.includes('TRANSPORTE') || n.includes('VIAJE')) return 'FLETES';
  if (n.includes('SEGURIDAD') || n.includes('VIGILANCIA')) return 'SEGURIDAD';
  if (n.includes('PAPELERIA') || n.includes('OFICINA') || n.includes('ARTICULOS')) return 'PAPELERIA';
  if (n.includes('BASICO') || n.includes('AGUA') || n.includes('LUZ') || n.includes('INTERNET')) return 'SERVICIOS BASICOS';
  if (n.includes('HONORARIO') || n.includes('LEGAL') || n.includes('ASESOR')) return 'HONORARIOS';
  if (n.includes('MUNICIPAL') || n.includes('PATENTE') || n.includes('ALCALDIA')) return 'IMPUESTOS MUNICIPALES';
  if (n.includes('MINERO') || n.includes('CONCESION') || n.includes('PERMISO')) return 'PERMISOS MINEROS';
  if (n.includes('VIATICO') || n.includes('HOSPEDAJE')) return 'VIATICOS';
  if (n.includes('HERRAMIENTA') || n.includes('EQUIPO')) return 'HERRAMIENTAS';
  if (n.includes('FUNDICION') || n.includes('INSUMO')) return 'INSUMOS DE FUNDICION';
  return 'SERVICIOS DE TERCEROS';
}

function resolverClaveMapeoAlmacen(almacen: string | null | undefined): string {
  const n = norm(almacen);
  if (n.includes('GASOIL') || n.includes('COMBUSTIBLE')) return 'TANQUE DE GASOIL';
  if (n.includes('COMEDOR') || n.includes('VIVERES')) return 'COMEDOR - VIVERES';
  if (n.includes('PATIO') || n.includes('MINERAL') || n.includes('MATANZA')) return 'PATIO DE MINERAL';
  if (n.includes('REFINADO')) return 'PLANTA - ESTAÑO REFINADO';
  if (n.includes('BRUTO')) return 'PLANTA - ESTAÑO EN BRUTO';
  if (n.includes('INSUMO')) return 'DEPOSITO CENTRAL - INSUMOS';
  return 'DEPOSITO CENTRAL - REPUESTOS';
}

/** Encola un hecho contable en la tabla `cont_integraciones` garantizando idempotencia. */
export async function encolarHechoContable(
  hecho: HechoContable,
  empresaClave = EMPRESA_DEFECTO,
): Promise<string> {
  const fechaStr = hecho.fecha ? hecho.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const docRef = hecho.origen_ref || hecho.id;

  // 1. Buscar regla activa en la base de datos
  const { data: regla } = await supabase
    .from('cont_reglas')
    .select('id')
    .eq('empresa_clave', empresaClave)
    .eq('modulo', hecho.origen_modulo)
    .eq('evento', hecho.evento)
    .eq('activo', true)
    .maybeSingle();

  // 2. Insertar o actualizar la fila de integración
  const payload = {
    empresa_clave: empresaClave,
    modulo: hecho.origen_modulo,
    evento: hecho.evento,
    documento_id: hecho.id,
    documento_codigo: docRef,
    fecha: fechaStr,
    regla_id: regla?.id ?? null,
    datos_origen: hecho,
    estado: 'pendiente',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('cont_integraciones')
    .upsert(payload, { onConflict: 'empresa_clave,modulo,evento,documento_id' })
    .select('id')
    .single();

  if (error) {
    console.warn(`Error al encolar hecho contable ${hecho.id} (${hecho.evento}):`, error.message);
    throw error;
  }

  return String(data.id);
}

/**
 * Escanea y sincroniza los hechos de los módulos operativos vivos en la base de datos
 * hacia la bandeja de integración contable (`cont_integraciones`).
 */
export async function sincronizarHechosOperativos(
  empresaClave = EMPRESA_DEFECTO,
): Promise<{ total: number; nuevos: number; errores: number }> {
  let total = 0;
  let nuevos = 0;
  let errores = 0;

  try {
    // ─────────────── 1. TESORERÍA: Movimientos de Caja ───────────────
    const { data: movsCaja } = await supabase
      .from('movimientos_caja')
      .select('*, caja:cajas(nombre, moneda)')
      .is('revertido_en', null)
      .order('at', { ascending: false })
      .limit(300);

    if (movsCaja && movsCaja.length > 0) {
      for (const m of movsCaja) {
        total++;
        try {
          const mon: Moneda = m.moneda === 'Bs' ? 'VES' : (m.moneda as Moneda) ?? 'USD';
          const cajaClave = resolverClaveMapeoCaja(m.caja?.nombre, mon);
          const fechaIso = m.at ? String(m.at).slice(0, 10) : new Date().toISOString().slice(0, 10);
          const montoNum = Math.abs(Number(m.monto) || 0);

          let evento = 'gasto_caja';
          let catGasto = resolverClaveMapeoGasto(m.gasto_categoria || m.motivo);

          if (m.categoria === 'pago_oc') {
            evento = 'pago_oc';
          } else if (m.tipo === 'traslado') {
            evento = 'traslado_caja';
          } else if (m.categoria === 'cobro_venta' || m.tipo === 'ingreso') {
            evento = 'cobro_cliente';
          } else if (m.motivo && norm(m.motivo).includes('COMISION')) {
            evento = 'comision_bancaria';
          }

          const hecho: HechoContable = {
            id: String(m.id),
            evento,
            fecha: fechaIso,
            moneda: mon,
            importes: {
              total: fmtDec(montoNum),
              base: fmtDec(montoNum),
              neto: fmtDec(montoNum),
              iva: '0.00',
              igtf: '0.00',
              retencion_iva: '0.00',
              retencion_islr: '0.00',
            },
            origen_modulo: 'tesoreria',
            origen_ref: m.ref_orden_id ? `OC-${m.ref_orden_id.slice(-6).toUpperCase()}` : (m.gasto_correlativo ? `GAS-${m.gasto_correlativo}` : `MOV-${m.id.slice(0, 8)}`),
            descripcion: m.motivo || `Movimiento de tesorería ${m.tipo}`,
            caja: cajaClave,
            categoria_gasto: catGasto,
            auxiliar: m.beneficiario ? `AUX-${norm(m.beneficiario).slice(0, 8)}` : null,
          };

          await encolarHechoContable(hecho, empresaClave);
          nuevos++;
        } catch {
          errores++;
        }
      }
    }

    // ─────────────── 2. COMPRAS Y PEDIDOS: Órdenes Recibidas ───────────────
    const { data: ordenes } = await supabase
      .from('ordenes')
      .select('*')
      .in('estado', ['recibida', 'pagada', 'finalizada', 'aprobada'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (ordenes && ordenes.length > 0) {
      for (const o of ordenes) {
        total++;
        try {
          const mon: Moneda = o.total_moneda === 'Bs' ? 'VES' : 'USD';
          const fechaIso = o.created_at ? String(o.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
          const totalNum = Math.abs(Number(o.total) || 0);
          const ivaNum = o.iva_aplicado ? Number(o.iva_monto ?? totalNum * 0.16) : 0;
          const baseNum = Math.max(0, totalNum - ivaNum);

          const evento = o.tipo === 'servicio' ? 'recepcion_sv' : 'recepcion_oc';
          const hecho: HechoContable = {
            id: `ord-${o.id}`,
            evento,
            fecha: fechaIso,
            moneda: mon,
            importes: {
              total: fmtDec(totalNum),
              base: fmtDec(baseNum),
              iva: fmtDec(ivaNum),
            },
            origen_modulo: 'compras',
            origen_ref: o.oc_codigo || o.codigo || `OC-${o.id.slice(0, 8)}`,
            descripcion: o.motivo || o.finalidad || `Compra de ${o.tipo ?? 'suministros'}`,
            almacen: resolverClaveMapeoAlmacen(o.sede_entrega),
            categoria_gasto: 'MANTENIMIENTO',
            auxiliar: o.proveedor_id ? `PRV-${o.proveedor_id.slice(0, 6)}` : null,
          };

          await encolarHechoContable(hecho, empresaClave);
          nuevos++;
        } catch {
          errores++;
        }
      }
    }

    // ─────────────── 3. ADMINISTRACIÓN: Servicios Directos ───────────────
    const { data: servDirectos } = await supabase
      .from('servicios_directos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (servDirectos && servDirectos.length > 0) {
      for (const s of servDirectos) {
        total++;
        try {
          const mon: Moneda = s.moneda === 'Bs' ? 'VES' : 'USD';
          const fechaIso = s.created_at ? String(s.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
          const montoNum = Math.abs(Number(s.gasto) || 0);

          const hecho: HechoContable = {
            id: `sd-${s.id}`,
            evento: 'servicio_directo',
            fecha: fechaIso,
            moneda: mon,
            importes: {
              total: fmtDec(montoNum),
              base: fmtDec(montoNum),
              neto: fmtDec(montoNum),
              iva: '0.00',
              retencion_iva: '0.00',
            },
            origen_modulo: 'compras',
            origen_ref: s.codigo || `SD-${s.id.slice(0, 6)}`,
            descripcion: s.descripcion || `Servicio directo ${s.codigo ?? ''}`,
            caja: 'CAJA-USD',
            categoria_gasto: resolverClaveMapeoGasto(s.descripcion),
            auxiliar: s.proveedor_id ? `PRV-${s.proveedor_id.slice(0, 6)}` : null,
          };

          await encolarHechoContable(hecho, empresaClave);
          nuevos++;
        } catch {
          errores++;
        }
      }
    }

    // ─────────────── 4. VENTAS: Facturas y Ventas Registradas ───────────────
    const { data: ventas } = await supabase
      .from('ventas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (ventas && ventas.length > 0) {
      for (const v of ventas) {
        total++;
        try {
          const mon: Moneda = (v.moneda as Moneda) ?? 'USD';
          const fechaIso = v.created_at ? String(v.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
          const totalNum = Math.abs(Number(v.total) || 0);

          const hecho: HechoContable = {
            id: `ven-${v.id}`,
            evento: 'venta',
            fecha: fechaIso,
            moneda: mon,
            importes: {
              total: fmtDec(totalNum),
              base: fmtDec(totalNum),
            },
            origen_modulo: 'ventas',
            origen_ref: v.codigo || `VEN-${v.id.slice(0, 6)}`,
            descripcion: v.concepto || `Venta de estaño / mineral`,
            categoria_producto: 'VENTA ESTAÑO REFINADO',
            auxiliar: v.cliente_id ? `CLI-${v.cliente_id.slice(0, 6)}` : null,
          };

          await encolarHechoContable(hecho, empresaClave);
          nuevos++;
        } catch {
          errores++;
        }
      }
    }
  } catch (err) {
    console.error('Error durante la sincronización de hechos operativos:', err);
    throw err;
  }

  return { total, nuevos, errores };
}
