/* ============================================================
   MGG · Retenciones v8 · La puerta de datos

   Todo lo que las pantallas de la v8 leen o escriben pasa por aquí. Ninguna
   pantalla lee directamente las tablas de otro módulo (modelo de dominio,
   §5 bis). Hoy la implementación es la del sistema anfitrión
   (puertaAnfitrion.ts), sobre las tablas que YA existen en producción. Lo
   que dependa de tablas que aún no están (reglas, períodos, otro sistema…)
   no se ofrece: la pantalla lo oculta, sin botones «pronto».

   Las pantallas reciben la puerta por contexto (PuertaContext), así las
   pruebas usan una puerta falsa.
   ============================================================ */

import { createContext, useContext } from 'react';
import type { RetencionItem } from '../../retenciones.repository';
import type { FiltroRetenciones, NuevaRetencion, RetencionPracticada } from '../../retencionesFiscal.repository';
import type { ConceptoRetencion, ConfigRetencion } from '../../retencionesCalculo';
import type { ArchivoFactura, RetenidoAlPagar } from '../pantalla/porRealizarExtras';
import type { Declaracion, PasoInicial, PeriodoRetencion } from './periodos';
import type { CambiosPerfil, DatosPerfil } from './perfilProveedor';
import type { TipoLicencia } from '../perfil/actividadesLicencia';

export type { RetencionItem, RetencionPracticada, FiltroRetenciones, NuevaRetencion, ConfigRetencion, ConceptoRetencion, ArchivoFactura, RetenidoAlPagar, CambiosPerfil, DatosPerfil, TipoLicencia };

/** Qué partes de la v8 tienen datos hoy. La pantalla oculta lo que dé false. */
export interface Capacidades {
  /** retencion_regla_versiones (REG-1): sin esto, el registro usa las reglas armadas desde la configuración de hoy. */
  reglas: boolean;
  /** retencion_periodos (E15-1): sin esto, no hay tira de período ni pestaña Períodos. */
  periodos: boolean;
  /** Convivencia con el otro sistema (9c/9d). */
  otroSistema: boolean;
  /** Impresiones y entregas (R1). */
  impresiones: boolean;
  /** Reportes guardados (E15-2). */
  reportes: boolean;
  /** El perfil fiscal del proveedor: v2.2 05 y v8p-03, 04 y 05 (actividades, licencia y sus tipos). */
  perfilProveedor: boolean;
}

export interface PuertaRetenciones {
  capacidades: Capacidades;
  /** OC y compras con retenciones pendientes (lo de «Por realizar» de hoy). */
  pendientes(): Promise<RetencionItem[]>;
  /** OC y compras con la retención finalizada (lo de «Realizadas» de hoy). */
  hechas(): Promise<RetencionItem[]>;
  /** Una fila por retención (el Libro fiscal de hoy). */
  libro(filtro?: FiltroRetenciones): Promise<RetencionPracticada[]>;
  config(): Promise<ConfigRetencion>;
  conceptos(soloActivos?: boolean): Promise<ConceptoRetencion[]>;
  registrar(input: NuevaRetencion): Promise<RetencionPracticada>;
  /** Adjunta el comprobante (PDF o imagen) a una retención ya registrada. */
  adjuntarComprobante(id: string, archivo: File): Promise<void>;
  /** Abre el comprobante de una retención practicada (el PDF de hoy). */
  verComprobante(r: RetencionPracticada): Promise<void>;
  /** Abre el archivo adjunto de una retención (comprobante subido o el PDF del cliente). */
  verArchivo(r: RetencionPracticada): Promise<void>;
  /** Guarda los datos de la empresa, el régimen y los valores compartidos (retencion_config). */
  guardarConfig(c: ConfigRetencion, actor: string): Promise<void>;
  /** Crea (sin id) o modifica (con id) un concepto del catálogo. */
  guardarConcepto(c: Partial<ConceptoRetencion> & { nombre: string; tipo: ConceptoRetencion['tipo'] }): Promise<void>;
  activarConcepto(id: string, activo: boolean): Promise<void>;
  anular(id: string, motivo: string): Promise<void>;
  /** Abre un archivo de la factura cargado en Compras («📎 Factura»). Sin él, el botón no se muestra. */
  verFactura?(a: ArchivoFactura): Promise<void>;
  /** Lo retenido al pagar que no está en el libro (C1). Sin él, el panel no se muestra. */
  retenidoSinRegistrar?(): Promise<RetenidoAlPagar[]>;
  /** Los archivos de la factura de unos documentos, por «<kind>:<id>» (Realizadas y Libro). Sin él, «📎 Factura» no se muestra ahí. */
  archivosDeDocumentos?(docs: { kind: string; id: string }[]): Promise<Map<string, ArchivoFactura[]>>;
  /** «🖨 Imprimir lista / PDF» del Libro: lo filtrado, con el PDF de hoy. Sin él, el botón no se muestra. */
  imprimirLibro?(filas: RetencionPracticada[], rango: { desde: string; hasta: string }): Promise<void>;
  /** Los períodos de declaración (retencion_periodos_v); null si la base de Retenciones no los tiene. */
  periodos?(): Promise<PeriodoRetencion[] | null>;
  /** La fecha de corte del paso inicial de cada impuesto (null = falta). */
  pasoInicial?(impuestos: readonly string[]): Promise<Record<string, string | null>>;
  /** Marca el período como declarado; devuelve cuántas retenciones pasaron a «Declarada». */
  declararPeriodo?(id: string, d: Declaracion): Promise<number>;
  /** Reabre un período declarado, con motivo; devuelve cuántas volvieron a «Registrada». */
  reabrirPeriodo?(id: string, motivo: string): Promise<number>;
  /** Guarda el paso inicial de un impuesto y genera sus períodos. */
  guardarPasoInicial?(tipo: string, p: PasoInicial): Promise<void>;
  /** Días antes del vencimiento en que una declaración pasa a «por vencer». */
  umbralDeclaraciones?(): Promise<number>;
  /** La dirección del proveedor, para el comprobante impreso (proveedores.direccion). Sin él, la hoja la deja en blanco. */
  direccionProveedor?(id: string): Promise<string>;
  /** El perfil fiscal de un proveedor, sus actividades y su licencia. Solo con capacidades.perfilProveedor. */
  perfilProveedor?(proveedorId: string): Promise<DatosPerfil>;
  /** El catálogo «Tipos de licencia». Solo con capacidades.perfilProveedor. */
  tiposLicencia?(): Promise<TipoLicencia[]>;
  /** Guarda el perfil, sus actividades y su licencia. Solo con capacidades.perfilProveedor. */
  guardarPerfilProveedor?(proveedorId: string, c: CambiosPerfil): Promise<void>;
}

export const PuertaContext = createContext<PuertaRetenciones | null>(null);

export function usePuerta(): PuertaRetenciones {
  const p = useContext(PuertaContext);
  if (!p) throw new Error('Retenciones v8: falta la puerta de datos (PuertaContext).');
  return p;
}
