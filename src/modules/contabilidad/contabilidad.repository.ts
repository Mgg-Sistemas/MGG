/* ============================================================
   MGG · Contabilidad · Repositorio (maqueta sobre datos simulados)

   Misma forma que un repositorio real del sistema: funciones async
   exportadas, errores de negocio en español con `throw new Error(...)`,
   y el actor en cada escritura. Por dentro NO llama a Supabase: usa el
   almacén simulado (simulacion/almacen.ts). Para pasar a la base se
   reescribe este archivo contra las tablas cont_* y las pantallas no
   cambian.

   crearRepositorio() existe para las pruebas (un almacén con
   almacenamiento falso); la aplicación usa las funciones de abajo.
   ============================================================ */

import { hoyISO } from '@/shared/lib/format';
import {
  codigoComprobante, descripcionReverso, erroresDeComprobante, ladoDe, mensajeMesCerrado, mismoCorrelativo, montosDeRenglon, periodoDeFecha,
  redondear2, renglonesDeReverso, siguienteNumero, statusDe, tasaVigente, totalesDe,
  type CabeceraBorrador, type ContextoValidacion, type RenglonBorrador,
} from './logica/comprobantes';
import {
  aperturaDesde, cierreDeResultados, erroresCierreMes, erroresReaperturaMes, fotoSaldos, revaluacionDelMes, tasaAlCierre,
  totalesCierre, trasladoAlSuperavit, type FuenteCierre, type RenglonCierre, type Revaluacion,
} from './logica/cierres';
import {
  balanceGeneral, columnasResultados, estadoConEquivalente, estadoResultados, type EstadoFinanciero, type EstructuraEF,
  type VarianteResultados,
} from './logica/estados';
import { agruparPorLote, ordenIntegracion, unirGenerados } from './logica/integracion';
import { catalogoDe, contabilizarHecho, reglaDe, type ComprobanteGenerado, type HechoContable } from './logica/motorReglas';
import {
  claveMonedaLocal, erroresActivarCentro, erroresInactivarCentro, erroresInactivarMoneda, erroresInactivarTipo, erroresModificarAuxiliar,
  erroresModificarCentro, erroresModificarTipo, esTipoDelSistema, normalizarAuxiliar, normalizarMonedaLocal, tasasConCambios, validarAuxiliar,
  validarCambio, validarCentroCosto, validarMoneda, validarMonedaLocal, validarPais, validarTipoComprobante,
  type AuxiliarInput, type CambioInput, type CentroCostoInput, type MonedaInput, type MonedaLocalInput, type PaisInput,
  type TipoComprobanteInput,
} from './logica/catalogos';
import { codigoPadre, compararCodigos, nivelDe, validarNuevaCuenta } from './logica/planCuentas';
import {
  auxiliaresConEquivalente, balanceComprobacion, balanceConEquivalente, diarioConEquivalente, libroDiario, mayorAnalitico, mayorConEquivalente,
  movimientosAuxiliares, type AuxiliarMayor, type BalanceComprobacion, type CuentaMayor, type FiltroAuxiliares, type FiltroBalance, type FiltroMayor, type FuenteInforme, type LibroDiario, type MonedaInforme,
} from './logica/reportes';
import { AlmacenSimulado, almacen as almacenDeLaApp } from './simulacion/almacen';
import { AlmacenCambios, almacenCambios as almacenCambiosDeLaApp } from './simulacion/almacenCambios';
import { cargarDocumentos } from './simulacion/datosBd';
import type {
  ContAuxiliar, ContCambio, ContCentroCosto, ContCierre, ContComprobante, ContComprobanteLinea, ContCuenta, ContEjercicio, ContIntegracion,
  ContEsquemaEf, ContMapeo, ContMoneda, ContMonedaLocal, ContPais, ContTasa, ContParametros, ContPeriodo, ContRegla, ContReglaLinea, ContTipoComprobante, CuentaInput, EstadoSimulacion, Moneda,
} from './tipos';

/**
 * Lo que Contabilidad lee de afuera de sus tablas: los documentos de cada módulo. En la maqueta
 * salen de bd.json; en la base, de las tablas de cada módulo (C47).
 */
export interface FuentesExternas {
  /** Los documentos de los otros módulos (hechos contables), por id. */
  documentos: () => Promise<HechoContable[]>;
}
const FUENTES_BD: FuentesExternas = { documentos: cargarDocumentos };

/**
 * La estructura de los estados: los esquemas por defecto de cont_esquemas_ef, armados como
 * {[tipo]: definicion} (C44, modelo v0.7). Sin esquema por defecto, el estado no se arma y lo dice.
 */
function estructuraDe(e: EstadoSimulacion): EstructuraEF {
  const de = (tipo: ContEsquemaEf['tipo'], nombre: string) => {
    const x = e.cont_esquemas_ef.find((s) => s.tipo === tipo && s.por_defecto && s.activo);
    if (!x) throw new Error(`No hay un esquema de ${nombre} por defecto (Esquemas de estados financieros).`);
    return x.definicion;
  };
  return {
    balance_general: de('balance_general', 'Balance General') as unknown as EstructuraEF['balance_general'],
    estado_resultados: de('estado_resultados', 'Estado de Resultados') as unknown as EstructuraEF['estado_resultados'],
  };
}

/** Una regla de contabilización con sus renglones (la pantalla Reglas de Contabilización). */
export interface ReglaCompleta { regla: ContRegla; lineas: ContReglaLinea[] }

/** Un documento de la bandeja: su fila de cont_integraciones, el documento, la regla que lo contabiliza y su comprobante. */
export interface DocumentoIntegracion {
  integracion: ContIntegracion;
  documento: HechoContable | null;
  regla: ContRegla | null;
  comprobante: { id: string; codigo: string } | null;
  /** El Debe del comprobante en Bs y en $: el grabado o, si está pendiente, el que generaría la regla (null si no se puede). */
  debe: { ves: number; usd: number } | null;
}

/**
 * `cambios`: la tabla «Cambio» en su propio almacén (las pruebas usan uno en memoria, nuevo en cada
 * repositorio; la app, el del navegador).
 */
export function crearRepositorio(almacen: AlmacenSimulado, fuentes: FuentesExternas = FUENTES_BD, cambios: AlmacenCambios = new AlmacenCambios(null)) {
  /** El estado con las tasas manuales de «Cambio» unidas a las del sistema (la manual manda en su fecha). */
  const conCambios = (e: EstadoSimulacion, cs: ContCambio[]): EstadoSimulacion => ({ ...e, cont_tasas: tasasDe(e, cs) });

  async function listCuentas(): Promise<ContCuenta[]> {
    return (await almacen.leer()).cont_cuentas.sort((a, b) => compararCodigos(a.codigo, b.codigo));
  }

  async function getParametros(): Promise<ContParametros> {
    return (await almacen.leer()).cont_parametros;
  }

  async function listEjercicios(): Promise<ContEjercicio[]> {
    return (await almacen.leer()).cont_ejercicios;
  }

  async function listPeriodos(): Promise<ContPeriodo[]> {
    return (await almacen.leer()).cont_periodos.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async function listMonedas(): Promise<ContMoneda[]> {
    return (await almacen.leer()).cont_monedas;
  }

  async function listTiposComprobante(): Promise<ContTipoComprobante[]> {
    return (await almacen.leer()).cont_tipos_comprobante;
  }

  async function crearCuenta(input: CuentaInput, actor: string): Promise<ContCuenta> {
    return almacen.modificar((estado) => {
      const errores = validarNuevaCuenta(input, estado.cont_cuentas, estado.cont_parametros.mascara_codigo);
      if (errores.length) throw new Error(errores.join(' '));
      const codigo = input.codigo.trim();
      const padre = codigoPadre(codigo);
      const cuenta: ContCuenta = {
        id: `cta-${codigo}`,
        codigo,
        nombre: input.nombre.trim().toUpperCase(),
        nivel: nivelDe(codigo),
        padre_id: padre ? estado.cont_cuentas.find((c) => c.codigo === padre)?.id ?? null : null,
        clase: input.clase,
        naturaleza: input.naturaleza,
        es_movimiento: input.es_movimiento,
        exige_centro_costo: input.es_movimiento && input.exige_centro_costo,
        exige_auxiliar: input.es_movimiento && input.exige_auxiliar,
        tipo_auxiliar: input.es_movimiento && input.exige_auxiliar ? input.tipo_auxiliar : null,
        moneda: input.moneda,
        es_monetaria: input.es_monetaria,
        rubro: null,
        activa: true,
        notas: null,
        created_at: new Date().toISOString(),
        created_by: actor,
      };
      estado.cont_cuentas.push(cuenta);
      return cuenta;
    });
  }

  /**
   * Activa o inactiva una cuenta (no se borran). Un título con alguna hija
   * activa no se inactiva: quedarían cuentas colgando de un padre inactivo.
   */
  async function cambiarActivaCuenta(id: string, activa: boolean): Promise<void> {
    await almacen.modificar((estado) => {
      const cuenta = estado.cont_cuentas.find((c) => c.id === id);
      if (!cuenta) throw new Error('La cuenta ya no existe.');
      if (!activa && estado.cont_cuentas.some((c) => c.padre_id === id && c.activa)) {
        throw new Error(`La cuenta ${cuenta.codigo} tiene subcuentas activas: se inactivan primero.`);
      }
      if (activa && cuenta.padre_id) {
        const padre = estado.cont_cuentas.find((c) => c.id === cuenta.padre_id);
        if (padre && !padre.activa) throw new Error(`La cuenta padre ${padre.codigo} está inactiva: se activa primero.`);
      }
      cuenta.activa = activa;
    });
  }

  async function reiniciarDatosEjemplo(): Promise<void> {
    await almacen.reiniciar();
    await cambios.reiniciar();
  }

  /* ───────────── Comprobantes (tramo 2, al estilo Galac) ───────────── */

  async function listCentrosCosto(): Promise<ContCentroCosto[]> {
    return (await almacen.leer()).cont_centros_costo.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async function listAuxiliares(): Promise<ContAuxiliar[]> {
    return (await almacen.leer()).cont_auxiliares.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** VES por unidad de la moneda a esa fecha (la del día o la última anterior); null si no hay. */
  async function getTasa(moneda: Moneda, fecha: string): Promise<number | null> {
    return tasaVigente(tasasDe(await almacen.leer(), await cambios.leer()), moneda, fecha);
  }

  /** Cabeceras, de la más reciente a la más vieja. */
  async function listComprobantes(): Promise<ContComprobante[]> {
    return (await almacen.leer()).cont_comprobantes.sort((a, b) =>
      b.fecha.localeCompare(a.fecha) || b.codigo.localeCompare(a.codigo) || b.created_at.localeCompare(a.created_at));
  }

  async function getComprobante(id: string): Promise<ComprobanteCompleto> {
    const e = (await almacen.leer());
    const comprobante = e.cont_comprobantes.find((c) => c.id === id);
    if (!comprobante) throw new Error('El comprobante ya no existe.');
    const lineas = e.cont_comprobante_lineas.filter((l) => l.comprobante_id === id).sort((a, b) => a.renglon - b.renglon);
    const reversadoPor = e.cont_comprobantes.find((c) => c.reverso_de_id === id) ?? null;
    return { comprobante, lineas, reversadoPor };
  }

  /**
   * Comprobante → Insertar (sin id) o Modificar (con id), como Galac.
   * · Lo que está mal escrito (cuenta título, auxiliar o centro faltante,
   *   mes cerrado…) se rechaza siempre.
   * · El cuadre decide el status: Contabilizado o Descuadrado. Un
   *   descuadrado se graba solo si Parámetros lo permite, y no entra en
   *   ningún saldo.
   * · El número se asigna al insertar y se conserva al modificar, salvo
   *   que el cambio de fecha o de tipo lo saque de su correlativo.
   * · No se modifica un comprobante reversado ni un reverso: deshacer se
   *   hace con otro reverso, nunca reescribiendo el pasado.
   * · Un contabilizado se modifica solo con su mes ABIERTO (usuario, 20/10
   *   13:04): queda marcado «modificado» y el historial agrega qué cambió
   *   (antes y después), sin reescribir lo anterior.
   */
  async function grabarComprobante(input: { id?: string; cabecera: CabeceraBorrador; renglones: RenglonBorrador[] }, actor: string): Promise<ContComprobante> {
    return almacen.modificar((e) => {
      const { cabecera: cab, renglones } = input;
      const anterior = input.id ? e.cont_comprobantes.find((c) => c.id === input.id) : undefined;
      if (input.id && !anterior) throw new Error('El comprobante ya no existe.');
      if (anterior) {
        const mesAnterior = e.cont_periodos.find((x) => x.id === anterior.periodo_id);
        if (mesAnterior && mesAnterior.estado !== 'abierto') throw new Error(mensajeMesCerrado(mesAnterior.codigo));
      }
      if (anterior?.origen === 'reverso') throw new Error('Un comprobante de reverso no se modifica.');
      if (anterior && e.cont_comprobantes.some((c) => c.reverso_de_id === anterior.id)) {
        throw new Error(`El comprobante ${anterior.codigo} ya fue reversado: no se modifica.`);
      }

      const errores = erroresDeComprobante(cab, renglones, contexto(e));
      if (errores.length) throw new Error(errores.join(' '));

      const id = anterior?.id ?? nuevoId('cbte');
      const lineas: ContComprobanteLinea[] = renglones.map((r, i) => ({
        id: `${id}-l${i + 1}`, comprobante_id: id, renglon: i + 1, cuenta_id: r.cuenta_id,
        centro_costo_id: r.centro_costo_id, auxiliar_id: r.auxiliar_id,
        descripcion: r.descripcion.trim().toUpperCase() || null, referencia: r.referencia.trim().toUpperCase() || null,
        fecha_referencia: r.fecha_referencia || null,
        moneda: r.moneda, monto_moneda: redondear2(r.monto_moneda), tasa: r.tasa,
        ...montosDeRenglon(r, cab.tasa),
      }));
      const t = totalesDe(lineas);
      const p = e.cont_parametros;
      const estado = statusDe(t, p.tolerancia_cuadre);
      if (estado === 'descuadrado' && !p.permite_descuadrados) {
        throw new Error(`El comprobante no cuadra (diferencia Bs ${t.dif_ves.toFixed(2)} · $ ${t.dif_usd.toFixed(2)}) y Parámetros no permite grabar descuadrados.`);
      }

      const periodo = periodoDeFecha(cab.fecha, e.cont_periodos)!;
      const tipo = e.cont_tipos_comprobante.find((x) => x.id === cab.tipo_id)!;
      const clave = { tipo_id: tipo.id, periodo_id: periodo.id };
      const otros = e.cont_comprobantes.filter((c) => c.id !== id);
      const conservaNumero = anterior && mismoCorrelativo(anterior, clave, p.tipo_numeracion, e.cont_periodos);
      const numero = conservaNumero ? anterior.numero : siguienteNumero(otros, clave, p.tipo_numeracion, e.cont_periodos);
      const ahora = new Date().toISOString();
      const cabecera = {
        tipo_id: tipo.id, periodo_id: periodo.id, numero, codigo: codigoComprobante(p.tipo_numeracion, tipo, periodo, numero),
        fecha: cab.fecha, concepto: cab.concepto.trim().toUpperCase(), estado,
        origen_ref: cab.origen_ref.trim().toUpperCase() || null,
        moneda_documento: cab.moneda_documento, tasa: cab.tasa,
        total_debe_ves: t.debe_ves, total_haber_ves: t.haber_ves, total_debe_usd: t.debe_usd, total_haber_usd: t.haber_usd,
      };
      let comp: ContComprobante;
      if (anterior) {
        const lineasAntes = e.cont_comprobante_lineas.filter((l) => l.comprobante_id === anterior.id).length;
        const antes = resumenParaHistorial(anterior, lineasAntes);
        Object.assign(anterior, cabecera);
        comp = Object.assign(anterior, {
          modificado: true, updated_at: ahora, updated_by: actor,
          historial: [...anterior.historial, { at: ahora, evento: 'modificado' as const, actor, antes, despues: resumenParaHistorial(anterior, lineas.length) }],
        });
      } else {
        comp = {
          id, ejercicio_id: periodo.ejercicio_id, ...cabecera, origen: 'manual', origen_modulo: null, origen_tabla: null, origen_id: null,
          numero_lote: null, modificado: false, regla_id: null, reverso_de_id: null,
          historial: [{ at: ahora, evento: 'grabado', actor, origen: 'manual' }],
          created_at: ahora, created_by: actor, updated_at: null, updated_by: null,
        };
        e.cont_comprobantes.push(comp);
      }
      e.cont_comprobante_lineas = e.cont_comprobante_lineas.filter((l) => l.comprobante_id !== id).concat(lineas);
      return comp;
    });
  }

  /**
   * Comprobante → Reversar (Galac §3.6): crea otro con las mismas cuentas y
   * Debe ↔ Haber, en la misma fecha, contabilizado y con su propio número.
   * Solo sobre un contabilizado (no descuadrado), una sola vez, y nunca
   * sobre un reverso. El MOTIVO es obligatorio y va en la descripción
   * (norma de MGG para toda acción que deshace algo).
   */
  async function reversarComprobante(id: string, motivo: string, actor: string): Promise<ContComprobante> {
    return almacen.modificar((e) => {
      const comp = e.cont_comprobantes.find((c) => c.id === id);
      if (!comp) throw new Error('El comprobante ya no existe.');
      if (comp.estado === 'descuadrado') throw new Error('No se puede reversar un comprobante descuadrado.');
      if (comp.origen === 'reverso') throw new Error('Un comprobante de reverso no se reversa.');
      const previo = e.cont_comprobantes.find((c) => c.reverso_de_id === id);
      if (previo) throw new Error(`El comprobante ${comp.codigo} ya fue reversado por el ${previo.codigo}.`);
      if (!motivo.trim()) throw new Error('Motivo del reverso requerido.');
      const periodo = e.cont_periodos.find((p) => p.id === comp.periodo_id)!;
      if (periodo.estado !== 'abierto') throw new Error(mensajeMesCerrado(periodo.codigo));

      const p = e.cont_parametros;
      const tipo = e.cont_tipos_comprobante.find((t) => t.id === comp.tipo_id)!;
      const numero = siguienteNumero(e.cont_comprobantes, comp, p.tipo_numeracion, e.cont_periodos);
      const ahora = new Date().toISOString();
      const idReverso = nuevoId('cbte');
      const reverso: ContComprobante = {
        ...comp, id: idReverso, numero, codigo: codigoComprobante(p.tipo_numeracion, tipo, periodo, numero),
        concepto: descripcionReverso(comp.codigo, motivo), estado: 'contabilizado', origen: 'reverso', reverso_de_id: comp.id,
        total_debe_ves: comp.total_haber_ves, total_haber_ves: comp.total_debe_ves,
        total_debe_usd: comp.total_haber_usd, total_haber_usd: comp.total_debe_usd,
        numero_lote: null, modificado: false, historial: [{ at: ahora, evento: 'grabado', actor, origen: 'reverso' }],
        created_at: ahora, created_by: actor, updated_at: null, updated_by: null,
      };
      comp.historial = [...comp.historial, { at: ahora, evento: 'reversado', actor, reverso: reverso.codigo }];
      e.cont_comprobantes.push(reverso);
      e.cont_comprobante_lineas.push(...renglonesDeReverso(e.cont_comprobante_lineas.filter((l) => l.comprobante_id === id), idReverso));
      return reverso;
    });
  }

  /* ───────────── Libros y balances (tramo 3) ─────────────
     Al migrar salen de las vistas cont_v_movimientos / cont_v_saldos
     (Carril BD); la forma de lo que devuelven no cambia. */

  async function fuenteInformes(): Promise<FuenteInforme> {
    const e = await almacen.leer();
    return {
      comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas,
      centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
    };
  }

  /** Informes → Diario de Comprobantes (Libro Diario). Solo contabilizados. */
  /** Cada informe va con su equivalente en la otra moneda (en `eq`), para mostrarlo debajo de la cifra. */
  const otraMoneda = (m: MonedaInforme): MonedaInforme => (m === 'VES' ? 'USD' : 'VES');

  async function getLibroDiario(desde: string, hasta: string, moneda: MonedaInforme): Promise<LibroDiario> {
    const f = await fuenteInformes();
    return diarioConEquivalente(libroDiario(f, desde, hasta, moneda), libroDiario(f, desde, hasta, otraMoneda(moneda)));
  }

  /** Balances → Mayor Analítico, Detallado o Resumido. */
  async function getMayorAnalitico(filtro: FiltroMayor): Promise<CuentaMayor[]> {
    const f = await fuenteInformes();
    return mayorConEquivalente(mayorAnalitico(f, filtro), mayorAnalitico(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
  }

  /** Informes → Informes de Movimientos de Cuentas → Movimientos de Auxiliares (photo_55). */
  async function getMovimientosAuxiliares(filtro: FiltroAuxiliares): Promise<AuxiliarMayor[]> {
    const f = await fuenteInformes();
    return auxiliaresConEquivalente(movimientosAuxiliares(f, filtro), movimientosAuxiliares(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
  }

  /** Balances → Balance de Comprobación, hasta el nivel de detalle pedido. */
  async function getBalanceComprobacion(filtro: FiltroBalance): Promise<BalanceComprobacion> {
    const f = await fuenteInformes();
    return balanceConEquivalente(balanceComprobacion(f, filtro), balanceComprobacion(f, { ...filtro, moneda: otraMoneda(filtro.moneda) }));
  }

  /* ───────────── Estados financieros (E-06) ───────────── */

  /** Balances → Estado de Resultados, en la variante de Galac, al mes de corte (AAAA-MM). */
  async function getEstadoResultados(f: { variante: VarianteResultados; corte: string; moneda: MonedaInforme; detallar?: boolean; incluirCierre?: boolean }): Promise<EstadoFinanciero> {
    const e = await almacen.leer();
    const est = estructuraDe(e);
    const fin = `${f.corte}-28`;
    const ej = e.cont_ejercicios.find((x) => x.fecha_inicio <= fin && fin <= x.fecha_fin);
    if (!ej) throw new Error(`No hay un período (ejercicio) que contenga ${f.corte.slice(5)}/${f.corte.slice(0, 4)}.`);
    const filtro = { columnas: columnasResultados(f.variante, f.corte, ej), detallar: f.detallar, incluirCierre: f.incluirCierre };
    const fuente = fuenteCierre(e);
    return estadoConEquivalente(
      estadoResultados(fuente, est, { ...filtro, moneda: f.moneda }),
      estadoResultados(fuente, est, { ...filtro, moneda: otraMoneda(f.moneda) }),
    );
  }

  /** Balances → Balance General (Estado de Situación Financiera) a la fecha de corte. */
  async function getBalanceGeneral(f: { hasta: string; moneda: MonedaInforme; detallar?: boolean }): Promise<EstadoFinanciero> {
    const e = await almacen.leer();
    const est = estructuraDe(e);
    const [y, m, d] = f.hasta.split('-');
    const filtro = { cortes: [{ etiqueta: `Al ${d}/${m}/${y}`, hasta: f.hasta }], ejercicios: e.cont_ejercicios, detallar: f.detallar };
    const fuente = fuenteCierre(e);
    return estadoConEquivalente(
      balanceGeneral(fuente, est, { ...filtro, moneda: f.moneda }),
      balanceGeneral(fuente, est, { ...filtro, moneda: otraMoneda(f.moneda) }),
    );
  }

  /* ───────────── Integración con los módulos (E-06 pieza 2) ─────────────
     Galac §8.1: Reglas de Contabilización por módulo y pestaña, y el menú
     Contabilizar. Al migrar, contabilizar es una RPC por documento (o por
     lote) que graba el comprobante y marca cont_integraciones en la misma
     transacción; la única (origen_tabla, origen_id, evento) impide
     contabilizar dos veces. */

  async function listReglasContabilizacion(): Promise<ReglaCompleta[]> {
    const e = await almacen.leer();
    return e.cont_reglas
      .sort((a, b) => a.origen_modulo.localeCompare(b.origen_modulo) || a.pestana.localeCompare(b.pestana) || a.codigo.localeCompare(b.codigo))
      .map((regla) => ({ regla, lineas: e.cont_regla_lineas.filter((l) => l.regla_id === regla.id).sort((a, b) => a.renglon - b.renglon) }));
  }

  async function listMapeos(): Promise<ContMapeo[]> {
    return (await almacen.leer()).cont_mapeos;
  }

  /** La bandeja: los documentos de los módulos con su estado frente a Contabilidad, en orden de fecha. */
  async function listIntegraciones(filtro: { estados?: ContIntegracion['estado'][] } = {}): Promise<DocumentoIntegracion[]> {
    const [e, docs, cs] = await Promise.all([almacen.leer(), fuentes.documentos(), cambios.leer()]);
    const porId = new Map(docs.map((d) => [d.id, d]));
    const comprobante = new Map(e.cont_comprobantes.map((c) => [c.id, c]));
    const cat = catalogoDe(conCambios(e, cs));
    return e.cont_integraciones
      .filter((i) => !filtro.estados || filtro.estados.includes(i.estado))
      .sort(ordenIntegracion)
      .map((integracion) => {
        const documento = porId.get(integracion.origen_id) ?? null;
        let regla: ContRegla | null = null;
        try { regla = documento ? reglaDe(documento, e.cont_reglas) : null; } catch { regla = null; }
        const cbte = integracion.comprobante_id ? comprobante.get(integracion.comprobante_id) : undefined;
        let debe: DocumentoIntegracion['debe'] = cbte ? { ves: cbte.total_debe_ves, usd: cbte.total_debe_usd } : null;
        if (!cbte && documento && integracion.estado !== 'excluido') {
          try {
            const g = contabilizarHecho(documento, cat);
            const s = (k: 'debe_ves' | 'debe_usd') => g.lineas.reduce((a, l) => a + Math.round(l[k] * 100), 0) / 100;
            debe = { ves: s('debe_ves'), usd: s('debe_usd') };
          } catch { debe = null; }
        }
        return { integracion, documento, regla, comprobante: cbte ? { id: cbte.id, codigo: cbte.codigo } : null, debe };
      });
  }

  /** «Ver comprobante» antes de contabilizar: lo que generaría la regla, sin grabar nada. */
  async function vistaPreviaIntegracion(integracionId: string): Promise<ComprobanteGenerado> {
    const [e, docs, cs] = await Promise.all([almacen.leer(), fuentes.documentos(), cambios.leer()]);
    const integ = e.cont_integraciones.find((i) => i.id === integracionId);
    if (!integ) throw new Error('El documento ya no está en la bandeja.');
    const doc = docs.find((d) => d.id === integ.origen_id);
    if (!doc) throw new Error(`No se encontró el documento ${integ.origen_id} en su módulo.`);
    return contabilizarHecho(doc, catalogoDe(conCambios(e, cs)));
  }

  /**
   * Contabilizar: los documentos elegidos, en orden de fecha y documento, con el motor de reglas.
   * Cada documento (o cada lote) da un comprobante y su fila de cont_integraciones queda
   * «contabilizado» con el comprobante. Uno que falla (mes cerrado, falta un mapeo o una tasa)
   * queda «error» con el motivo, y los demás siguen: así trabaja Galac.
   */
  async function contabilizarIntegraciones(ids: string[], actor: string): Promise<{ comprobantes: ContComprobante[]; errores: Array<{ documento: string; error: string }> }> {
    const docs = new Map((await fuentes.documentos()).map((d) => [d.id, d]));
    const cs = await cambios.leer();
    return almacen.modificar((e) => {
      const cat = catalogoDe(conCambios(e, cs));
      const ahora = new Date().toISOString();
      const elegidas = e.cont_integraciones
        .filter((i) => ids.includes(i.id) && (i.estado === 'pendiente' || i.estado === 'error'))
        .sort(ordenIntegracion);
      const errores: Array<{ documento: string; error: string }> = [];
      const listos: Array<{ integ: ContIntegracion; doc: HechoContable; generado: ComprobanteGenerado; periodo: ContPeriodo }> = [];
      for (const integ of elegidas) {
        try {
          const doc = docs.get(integ.origen_id);
          if (!doc) throw new Error(`No se encontró el documento ${integ.origen_id} en su módulo.`);
          const periodo = periodoDeFecha(doc.fecha, e.cont_periodos);
          if (!periodo) throw new Error(`No hay un mes contable para el ${doc.fecha}.`);
          if (periodo.estado !== 'abierto') throw new Error(mensajeMesCerrado(periodo.codigo));
          listos.push({ integ, doc, generado: contabilizarHecho(doc, cat), periodo });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'No se pudo contabilizar.';
          Object.assign(integ, { estado: 'error', error, updated_at: ahora, updated_by: actor });
          errores.push({ documento: integ.origen_id, error });
        }
      }
      const comprobantes = agruparPorLote(listos).map((grupo) => {
        const { cabecera: g, lineas, totales: t } = unirGenerados(grupo.map((x) => x.generado));
        const { doc, periodo } = grupo[0];
        const tipo = e.cont_tipos_comprobante.find((x) => x.id === g.regla.tipo_comprobante_id)!;
        const p = e.cont_parametros;
        const numero = siguienteNumero(e.cont_comprobantes, { tipo_id: tipo.id, periodo_id: periodo.id }, p.tipo_numeracion, e.cont_periodos);
        const id = nuevoId('cbte');
        const comp: ContComprobante = {
          id, ejercicio_id: periodo.ejercicio_id, tipo_id: tipo.id, periodo_id: periodo.id, numero,
          codigo: codigoComprobante(p.tipo_numeracion, tipo, periodo, numero), fecha: g.fecha, concepto: g.concepto,
          estado: t.debe_ves === t.haber_ves && t.debe_usd === t.haber_usd ? 'contabilizado' : 'descuadrado',
          origen: 'automatico', origen_modulo: doc.origen_modulo,
          // Un lote de varios documentos no tiene UN documento de origen: lo identifica su número de lote.
          origen_tabla: grupo.length === 1 ? 'hechos_simulados' : null, origen_id: grupo.length === 1 ? doc.id : null,
          origen_ref: grupo.length === 1 ? doc.origen_ref ?? null : null,
          numero_lote: g.numero_lote, modificado: false, regla_id: g.regla.id, moneda_documento: doc.moneda, tasa: g.tasa,
          total_debe_ves: t.debe_ves, total_haber_ves: t.haber_ves, total_debe_usd: t.debe_usd, total_haber_usd: t.haber_usd,
          reverso_de_id: null, historial: [{ at: ahora, evento: 'grabado', actor, origen: 'automatico' }],
          created_at: ahora, created_by: actor, updated_at: null, updated_by: null,
        };
        e.cont_comprobantes.push(comp);
        lineas.forEach((l, i) => e.cont_comprobante_lineas.push({ ...l, id: `${id}-l${i + 1}`, comprobante_id: id, renglon: i + 1, fecha_referencia: null }));
        for (const x of grupo) Object.assign(x.integ, { estado: 'contabilizado', comprobante_id: id, error: null, updated_at: ahora, updated_by: actor });
        return comp;
      });
      return { comprobantes, errores };
    });
  }

  /* ───────────── Período y cierres (E-03) ─────────────
     Al migrar son las RPC cont_cerrar_periodo, cont_reabrir_periodo,
     cont_cerrar_ejercicio, cont_reabrir_ejercicio y cont_apertura de BD:
     cada una en una transacción. */

  async function listCierres(): Promise<ContCierre[]> {
    return (await almacen.leer()).cont_cierres;
  }

  /** Lo que haría «Cerrar Mes»: los errores que lo impiden y el diferencial cambiario que generaría. */
  async function vistaPreviaCierreMes(periodoId: string): Promise<{ errores: string[]; revaluacion: Revaluacion | null }> {
    const e = await almacen.leer();
    const cs = await cambios.leer();
    const periodo = e.cont_periodos.find((x) => x.id === periodoId);
    if (!periodo) throw new Error('El mes ya no existe.');
    const ejercicio = e.cont_ejercicios.find((x) => x.id === periodo.ejercicio_id);
    const errores = erroresCierreMes(periodo, e.cont_periodos, e.cont_comprobantes, ejercicio, e.cont_integraciones);
    let revaluacion: Revaluacion | null = null;
    try {
      if (periodo.numero !== 13) revaluacion = revaluacionDelMes(fuenteCierre(e), periodo, tasasDe(e, cs), e.cont_parametros);
    } catch (err) {
      errores.push(err instanceof Error ? err.message : 'No se pudo calcular el diferencial cambiario.');
    }
    return { errores, revaluacion };
  }

  /** Período → Cerrar Mes: valida, graba el diferencial cambiario (AJ) y deja la foto de saldos. */
  async function cerrarMes(periodoId: string, actor: string): Promise<{ periodo: ContPeriodo; revaluacion: ContComprobante | null }> {
    const cs = await cambios.leer();
    return almacen.modificar((e) => {
      const periodo = e.cont_periodos.find((x) => x.id === periodoId);
      if (!periodo) throw new Error('El mes ya no existe.');
      const ejercicio = e.cont_ejercicios.find((x) => x.id === periodo.ejercicio_id);
      const errores = erroresCierreMes(periodo, e.cont_periodos, e.cont_comprobantes, ejercicio, e.cont_integraciones);
      if (errores.length) throw new Error(errores.join(' '));
      const rev = revaluacionDelMes(fuenteCierre(e), periodo, tasasDe(e, cs), e.cont_parametros);
      const ahora = new Date().toISOString();
      const aj = rev.renglones.length
        ? grabarAutomatico(e, {
          tipoId: tipoDeProceso(e, 'tipo_diferencial_id'), periodo, fecha: rev.fecha, concepto: `Revaluación de cuentas en divisa · ${periodo.codigo}`,
          origen: 'automatico', renglones: rev.renglones, actor,
        })
        : null;
      e.cont_cierres.push({
        id: nuevoId('cierre'), tipo: 'mes', tipo_cierre: null, periodo_id: periodo.id, ejercicio_id: null, estado: 'vigente',
        comprobante_id: aj?.id ?? null, saldos: fotoSaldos(fuenteCierre(e), periodo.fecha_fin), hecho_en: ahora, hecho_por: actor,
        reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
      });
      Object.assign(periodo, { estado: 'cerrado', cerrado_en: ahora, cerrado_por: actor });
      return { periodo, revaluacion: aj };
    });
  }

  /** Período → Abrir Mes: del último al primero, con motivo; reversa su diferencial cambiario. */
  async function reabrirMes(periodoId: string, motivo: string, actor: string): Promise<ContPeriodo> {
    return almacen.modificar((e) => {
      const periodo = e.cont_periodos.find((x) => x.id === periodoId);
      if (!periodo) throw new Error('El mes ya no existe.');
      const ejercicio = e.cont_ejercicios.find((x) => x.id === periodo.ejercicio_id);
      const errores = erroresReaperturaMes(periodo, e.cont_periodos, ejercicio, motivo);
      if (errores.length) throw new Error(errores.join(' '));
      const ahora = new Date().toISOString();
      Object.assign(periodo, { estado: 'abierto', reabierto_en: ahora, reabierto_por: actor, reabierto_motivo: motivo.trim() });
      const cierre = e.cont_cierres.find((c) => c.tipo === 'mes' && c.periodo_id === periodo.id && c.estado === 'vigente');
      if (cierre) {
        Object.assign(cierre, { estado: 'reabierto', reabierto_en: ahora, reabierto_por: actor, reabierto_motivo: motivo.trim() });
        const aj = cierre.comprobante_id ? e.cont_comprobantes.find((c) => c.id === cierre.comprobante_id) : undefined;
        if (aj && !e.cont_comprobantes.some((c) => c.reverso_de_id === aj.id)) reversarEn(e, aj, `Reapertura del mes: ${motivo}`, actor);
      }
      return periodo;
    });
  }

  /**
   * Cerrar Período → Cierre del ejercicio, pre-cierre o definitivo. Un
   * pre-cierre pasa a definitivo sin repetir los asientos de cierre.
   */
  async function cerrarEjercicio(ejercicioId: string, tipo: 'pre_cierre' | 'definitivo', actor: string): Promise<ContEjercicio> {
    const cs = await cambios.leer();
    return almacen.modificar((e) => {
      const ej = e.cont_ejercicios.find((x) => x.id === ejercicioId);
      if (!ej) throw new Error('El ejercicio ya no existe.');
      if (ej.estado === 'cerrado') throw new Error(`El ejercicio ${ej.nombre} ya tiene cierre definitivo.`);
      const ahora = new Date().toISOString();
      if (ej.estado === 'pre_cierre') {
        if (tipo === 'pre_cierre') throw new Error(`El ejercicio ${ej.nombre} ya está en pre-cierre.`);
        const vigente = e.cont_cierres.find((c) => c.tipo === 'ejercicio' && c.ejercicio_id === ej.id && c.estado === 'vigente');
        if (vigente) vigente.tipo_cierre = 'definitivo';
        return Object.assign(ej, { estado: 'cerrado', cerrado_en: ahora, cerrado_por: actor });
      }
      const meses = e.cont_periodos.filter((p) => p.ejercicio_id === ej.id);
      const abiertos = meses.filter((p) => p.numero <= 12 && p.estado !== 'cerrado');
      if (abiertos.length) throw new Error(`Para cerrar el ejercicio, los 12 meses tienen que estar cerrados: faltan ${abiertos.map((p) => `${p.codigo.slice(4)}/${p.codigo.slice(0, 4)}`).join(', ')}.`);
      const mes13 = meses.find((p) => p.numero === 13);
      if (!mes13) throw new Error('El ejercicio no tiene mes 13 (cierre).');
      mes13.estado = 'abierto';
      const tasa = tasaAlCierre(tasasDe(e, cs), 'USD', ej.fecha_fin)?.tasa ?? 1_000_000n;
      const ci1 = grabarAutomatico(e, {
        tipoId: tipoDeProceso(e, 'tipo_cierre_id'), periodo: mes13, fecha: ej.fecha_fin, concepto: `Cierre de cuentas de resultado · ejercicio ${ej.nombre}`,
        origen: 'cierre', renglones: cierreDeResultados(fuenteCierre(e), ej, e.cont_parametros, tasa), actor,
      });
      grabarAutomatico(e, {
        tipoId: tipoDeProceso(e, 'tipo_cierre_id'), periodo: mes13, fecha: ej.fecha_fin, concepto: `Traslado del resultado a superávit · ejercicio ${ej.nombre}`,
        origen: 'cierre', renglones: trasladoAlSuperavit(fuenteCierre(e), ej, e.cont_parametros, tasa), actor,
      });
      Object.assign(mes13, { estado: 'cerrado', cerrado_en: ahora, cerrado_por: actor });
      e.cont_cierres.push({
        id: nuevoId('cierre'), tipo: 'ejercicio', tipo_cierre: tipo, periodo_id: null, ejercicio_id: ej.id, estado: 'vigente',
        comprobante_id: ci1?.id ?? null, saldos: fotoSaldos(fuenteCierre(e), ej.fecha_fin), hecho_en: ahora, hecho_por: actor,
        reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
      });
      return Object.assign(ej, { estado: tipo === 'pre_cierre' ? 'pre_cierre' : 'cerrado', cerrado_en: ahora, cerrado_por: actor, comprobante_cierre_id: ci1?.id ?? null });
    });
  }

  /** Cerrar Período → Re-abrir Período: solo un pre-cierre; reversa los dos asientos de cierre en el mes 13. */
  async function reabrirEjercicio(ejercicioId: string, motivo: string, actor: string): Promise<ContEjercicio> {
    return almacen.modificar((e) => {
      const ej = e.cont_ejercicios.find((x) => x.id === ejercicioId);
      if (!ej) throw new Error('El ejercicio ya no existe.');
      if (ej.estado === 'cerrado') throw new Error(`El ejercicio ${ej.nombre} tiene cierre definitivo: no se reabre.`);
      if (ej.estado !== 'pre_cierre') throw new Error(`El ejercicio ${ej.nombre} no está en pre-cierre.`);
      if (!motivo.trim()) throw new Error('Motivo de la reapertura requerido.');
      const siguiente = e.cont_ejercicios.find((x) => x.fecha_inicio > ej.fecha_fin);
      if (siguiente && e.cont_comprobantes.some((c) => c.ejercicio_id === siguiente.id && c.origen === 'apertura' && !e.cont_comprobantes.some((r) => r.reverso_de_id === c.id))) {
        throw new Error(`El ejercicio ${siguiente.nombre} ya tiene su apertura: primero se reversa esa apertura.`);
      }
      const ahora = new Date().toISOString();
      const mes13 = e.cont_periodos.find((p) => p.ejercicio_id === ej.id && p.numero === 13)!;
      mes13.estado = 'abierto';
      const cierres = e.cont_comprobantes.filter((c) => c.periodo_id === mes13.id && c.origen === 'cierre' && !e.cont_comprobantes.some((r) => r.reverso_de_id === c.id));
      for (const c of [...cierres].reverse()) reversarEn(e, c, `Reapertura del ejercicio: ${motivo}`, actor);
      Object.assign(mes13, { reabierto_en: ahora, reabierto_por: actor, reabierto_motivo: motivo.trim() });
      const vigente = e.cont_cierres.find((c) => c.tipo === 'ejercicio' && c.ejercicio_id === ej.id && c.estado === 'vigente');
      if (vigente) Object.assign(vigente, { estado: 'reabierto', reabierto_en: ahora, reabierto_por: actor, reabierto_motivo: motivo.trim() });
      return Object.assign(ej, { estado: 'abierto', cerrado_en: null, cerrado_por: null, comprobante_cierre_id: null });
    });
  }

  /** Abrir el ejercicio siguiente: sus 13 meses y un comprobante AP con los saldos de balance. */
  async function abrirEjercicioSiguiente(ejercicioId: string, actor: string): Promise<ContEjercicio> {
    const cs = await cambios.leer();
    return almacen.modificar((e) => {
      const ej = e.cont_ejercicios.find((x) => x.id === ejercicioId);
      if (!ej) throw new Error('El ejercicio ya no existe.');
      if (ej.estado === 'abierto') throw new Error(`Primero se cierra el ejercicio ${ej.nombre} (pre-cierre o definitivo).`);
      const anio = Number(ej.nombre) + 1;
      if (e.cont_ejercicios.some((x) => x.nombre === String(anio))) throw new Error(`El ejercicio ${anio} ya existe.`);
      const nuevo: ContEjercicio = {
        id: `ej-${anio}`, nombre: String(anio), fecha_inicio: `${anio}-01-01`, fecha_fin: `${anio}-12-31`, estado: 'abierto',
        cerrado_en: null, cerrado_por: null, comprobante_cierre_id: null,
      };
      e.cont_ejercicios.push(nuevo);
      for (let m = 1; m <= 13; m++) {
        const mes = Math.min(m, 12);
        const mm = String(mes).padStart(2, '0');
        const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
        e.cont_periodos.push({
          id: `per-${anio}${String(m).padStart(2, '0')}`, ejercicio_id: nuevo.id, numero: m, codigo: `${anio}${String(m).padStart(2, '0')}`,
          fecha_inicio: m === 13 ? `${anio}-12-31` : `${anio}-${mm}-01`, fecha_fin: `${anio}-${mm}-${ultimo}`, estado: 'abierto',
          cerrado_en: null, cerrado_por: null, reabierto_en: null, reabierto_por: null, reabierto_motivo: null,
        });
      }
      const enero = e.cont_periodos.find((p) => p.id === `per-${anio}01`)!;
      const tasa = tasaAlCierre(tasasDe(e, cs), 'USD', ej.fecha_fin)?.tasa ?? 1_000_000n;
      grabarAutomatico(e, {
        tipoId: tipoDeProceso(e, 'tipo_apertura_id'), periodo: enero, fecha: nuevo.fecha_inicio, concepto: `Apertura del ejercicio ${anio} (saldos al ${ej.fecha_fin})`,
        origen: 'apertura', renglones: aperturaDesde(fuenteCierre(e), ej, tasa), actor,
      });
      return nuevo;
    });
  }

  /* ───────────── Catálogos «Auxiliares y Otros» (E-14, Fase 1) ─────────────
     Galac: alta, consulta, modificación (sin el código) y activar /
     inactivar. Nunca se borra. Las reglas están en logica/catalogos.ts. */

  const falla = (errores: string[]) => { if (errores.length) throw new Error(errores.join(' ')); };

  /** Compañía → Parámetros: los tipos de los procesos, elegidos entre los activos. */
  async function modificarTiposDeParametros(x: Pick<ContParametros, keyof typeof PROCESO_DEL_TIPO>): Promise<ContParametros> {
    return almacen.modificar((e) => {
      for (const campo of Object.keys(PROCESO_DEL_TIPO) as Array<keyof typeof PROCESO_DEL_TIPO>) {
        const id = x[campo];
        if (!id) throw new Error(`Indique en Parámetros el tipo de comprobante ${PROCESO_DEL_TIPO[campo]}.`);
        const t = e.cont_tipos_comprobante.find((y) => y.id === id);
        if (!t || !t.activo) throw new Error(`El tipo de comprobante elegido ${PROCESO_DEL_TIPO[campo]} no existe o está inactivo.`);
      }
      return Object.assign(e.cont_parametros, x);
    });
  }

  async function crearTipoComprobante(x: TipoComprobanteInput, actor: string): Promise<ContTipoComprobante> {
    void actor;
    return almacen.modificar((e) => {
      falla(validarTipoComprobante(x, e.cont_tipos_comprobante));
      const codigo = x.codigo.trim();
      const t: ContTipoComprobante = { id: `tc-${codigo}`, codigo, nombre: x.nombre.trim(), origen: x.origen, activo: true, sistema: esTipoDelSistema(codigo) };
      e.cont_tipos_comprobante.push(t);
      return t;
    });
  }

  async function modificarTipoComprobante(id: string, x: Omit<TipoComprobanteInput, 'codigo'>): Promise<ContTipoComprobante> {
    return almacen.modificar((e) => {
      const t = e.cont_tipos_comprobante.find((y) => y.id === id);
      if (!t) throw new Error('El tipo de comprobante ya no existe.');
      falla(erroresModificarTipo(t, x));
      return Object.assign(t, { nombre: x.nombre.trim(), origen: x.origen });
    });
  }

  async function cambiarActivoTipoComprobante(id: string, activo: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const t = e.cont_tipos_comprobante.find((y) => y.id === id);
      if (!t) throw new Error('El tipo de comprobante ya no existe.');
      if (!activo) falla(erroresInactivarTipo(t, e.cont_reglas, e.cont_parametros));
      else if (esTipoDelSistema(t.codigo)) falla([`El tipo ${t.codigo} es del sistema: siempre está activo.`]);
      t.activo = activo;
    });
  }

  async function crearCentroCosto(x: CentroCostoInput): Promise<ContCentroCosto> {
    return almacen.modificar((e) => {
      falla(validarCentroCosto(x, e.cont_centros_costo));
      const codigo = x.codigo.trim().toUpperCase();
      const c: ContCentroCosto = { id: `cc-${codigo}`, codigo, nombre: x.nombre.trim().toUpperCase(), padre_id: x.padre_id, tipo: x.tipo, origen_clave: null, activo: true };
      e.cont_centros_costo.push(c);
      return c;
    });
  }

  async function modificarCentroCosto(id: string, x: Omit<CentroCostoInput, 'codigo'>): Promise<ContCentroCosto> {
    return almacen.modificar((e) => {
      const c = e.cont_centros_costo.find((y) => y.id === id);
      if (!c) throw new Error('El centro de costo ya no existe.');
      falla(erroresModificarCentro(c, x, e.cont_centros_costo));
      return Object.assign(c, { nombre: x.nombre.trim().toUpperCase(), tipo: x.tipo, padre_id: x.padre_id });
    });
  }

  async function cambiarActivoCentroCosto(id: string, activo: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const c = e.cont_centros_costo.find((y) => y.id === id);
      if (!c) throw new Error('El centro de costo ya no existe.');
      falla(activo ? erroresActivarCentro(c, e.cont_centros_costo) : erroresInactivarCentro(c, e.cont_centros_costo, e.cont_parametros));
      c.activo = activo;
    });
  }

  async function crearAuxiliar(x: AuxiliarInput): Promise<ContAuxiliar> {
    return almacen.modificar((e) => {
      falla(validarAuxiliar(x, e.cont_auxiliares));
      const n = normalizarAuxiliar(x);
      const a: ContAuxiliar = { id: `aux-${n.tipo}-${n.codigo}`, ...n, origen_tabla: null, origen_id: null, activo: true };
      e.cont_auxiliares.push(a);
      return a;
    });
  }

  async function modificarAuxiliar(id: string, x: Pick<AuxiliarInput, 'nombre' | 'rif'>): Promise<ContAuxiliar> {
    return almacen.modificar((e) => {
      const a = e.cont_auxiliares.find((y) => y.id === id);
      if (!a) throw new Error('El auxiliar ya no existe.');
      falla(erroresModificarAuxiliar(x));
      const n = normalizarAuxiliar({ tipo: a.tipo, codigo: a.codigo, ...x });
      return Object.assign(a, { nombre: n.nombre, rif: n.rif });
    });
  }

  async function cambiarActivoAuxiliar(id: string, activo: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const a = e.cont_auxiliares.find((y) => y.id === id);
      if (!a) throw new Error('El auxiliar ya no existe.');
      a.activo = activo;
    });
  }

  async function crearMoneda(x: MonedaInput): Promise<ContMoneda> {
    return almacen.modificar((e) => {
      falla(validarMoneda(x, e.cont_monedas));
      const m: ContMoneda = { codigo: x.codigo.trim().toUpperCase(), nombre: x.nombre.trim(), simbolo: x.simbolo.trim(), decimales: 2, activa: true };
      e.cont_monedas.push(m);
      return m;
    });
  }

  async function modificarMoneda(codigo: string, x: Omit<MonedaInput, 'codigo'>): Promise<ContMoneda> {
    return almacen.modificar((e) => {
      const m = e.cont_monedas.find((y) => y.codigo === codigo);
      if (!m) throw new Error('La moneda ya no existe.');
      if (!x.nombre.trim()) throw new Error('Nombre requerido.');
      return Object.assign(m, { nombre: x.nombre.trim(), simbolo: x.simbolo.trim() });
    });
  }

  async function cambiarActivaMoneda(codigo: string, activa: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const m = e.cont_monedas.find((y) => y.codigo === codigo);
      if (!m) throw new Error('La moneda ya no existe.');
      if (!activa) falla(erroresInactivarMoneda(m, e.cont_parametros, e.cont_monedas_locales));
      m.activa = activa;
    });
  }

  async function listPaises(): Promise<ContPais[]> {
    return (await almacen.leer()).cont_paises.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async function crearPais(x: PaisInput): Promise<ContPais> {
    return almacen.modificar((e) => {
      falla(validarPais(x, e.cont_paises));
      const p: ContPais = { codigo: x.codigo.trim().toUpperCase(), nombre: x.nombre.trim(), activo: true };
      e.cont_paises.push(p);
      return p;
    });
  }

  async function modificarPais(codigo: string, x: Omit<PaisInput, 'codigo'>): Promise<ContPais> {
    return almacen.modificar((e) => {
      const p = e.cont_paises.find((y) => y.codigo === codigo);
      if (!p) throw new Error('El país ya no existe.');
      if (!x.nombre.trim()) throw new Error('Nombre requerido.');
      return Object.assign(p, { nombre: x.nombre.trim() });
    });
  }

  async function cambiarActivoPais(codigo: string, activo: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const p = e.cont_paises.find((y) => y.codigo === codigo);
      if (!p) throw new Error('El país ya no existe.');
      if (!activo && e.cont_monedas_locales.some((l) => l.activo && l.codigo_pais === codigo)) {
        throw new Error(`El país ${codigo} tiene una moneda local activa: primero se inactiva esa moneda local.`);
      }
      p.activo = activo;
    });
  }

  async function listMonedasLocales(): Promise<ContMonedaLocal[]> {
    return (await almacen.leer()).cont_monedas_locales.sort((a, b) => a.codigo_pais.localeCompare(b.codigo_pais) || a.vigencia_desde.localeCompare(b.vigencia_desde));
  }

  async function crearMonedaLocal(x: MonedaLocalInput): Promise<ContMonedaLocal> {
    return almacen.modificar((e) => {
      falla(validarMonedaLocal(x, e.cont_monedas_locales, e.cont_paises, e.cont_monedas));
      const l: ContMonedaLocal = { ...normalizarMonedaLocal(x), activo: true };
      e.cont_monedas_locales.push(l);
      return l;
    });
  }

  /** Por su clave (país|moneda|desde, la PK): la clave no se modifica, como el código en las demás tablas. */
  async function modificarMonedaLocal(clave: string, x: Pick<MonedaLocalInput, 'factor_conversion' | 'codigo_moneda_anterior' | 'vigencia_hasta'>): Promise<ContMonedaLocal> {
    return almacen.modificar((e) => {
      const l = e.cont_monedas_locales.find((y) => claveMonedaLocal(y) === clave);
      if (!l) throw new Error('La moneda local ya no existe.');
      const nueva = { ...l, ...x };
      falla(validarMonedaLocal(nueva, e.cont_monedas_locales, e.cont_paises, e.cont_monedas, clave));
      const n = normalizarMonedaLocal(nueva);
      return Object.assign(l, { factor_conversion: n.factor_conversion, codigo_moneda_anterior: n.codigo_moneda_anterior, vigencia_hasta: n.vigencia_hasta });
    });
  }

  async function cambiarActivaMonedaLocal(clave: string, activo: boolean): Promise<void> {
    await almacen.modificar((e) => {
      const l = e.cont_monedas_locales.find((y) => claveMonedaLocal(y) === clave);
      if (!l) throw new Error('La moneda local ya no existe.');
      if (activo) falla(validarMonedaLocal(l, e.cont_monedas_locales, e.cont_paises, e.cont_monedas, clave));
      l.activo = activo;
    });
  }

  async function listCambios(): Promise<ContCambio[]> {
    return (await cambios.leer()).sort((a, b) => a.moneda.localeCompare(b.moneda) || b.fecha.localeCompare(a.fecha));
  }

  async function crearCambio(x: CambioInput, actor: string): Promise<ContCambio> {
    const e = await almacen.leer();
    return cambios.modificar((filas) => {
      falla(validarCambio(x, filas, e.cont_monedas, e.cont_parametros));
      const c: ContCambio = {
        id: nuevoId('cambio'), fecha: x.fecha, moneda: x.moneda, tasa_ves: x.tasa_ves, fuente: 'manual', activo: true,
        created_at: new Date().toISOString(), created_by: actor, updated_at: null, updated_by: null,
      };
      filas.push(c);
      return c;
    });
  }

  async function modificarCambio(id: string, x: CambioInput, actor: string): Promise<ContCambio> {
    const e = await almacen.leer();
    return cambios.modificar((filas) => {
      const c = filas.find((y) => y.id === id);
      if (!c) throw new Error('El cambio ya no existe.');
      falla(validarCambio(x, filas, e.cont_monedas, e.cont_parametros, id));
      return Object.assign(c, { fecha: x.fecha, moneda: x.moneda, tasa_ves: x.tasa_ves, updated_at: new Date().toISOString(), updated_by: actor });
    });
  }

  async function cambiarActivoCambio(id: string, activo: boolean, actor: string): Promise<void> {
    const e = await almacen.leer();
    await cambios.modificar((filas) => {
      const c = filas.find((y) => y.id === id);
      if (!c) throw new Error('El cambio ya no existe.');
      if (activo) falla(validarCambio(c, filas, e.cont_monedas, e.cont_parametros, id));
      Object.assign(c, { activo, updated_at: new Date().toISOString(), updated_by: actor });
    });
  }

  return {
    listCuentas, getParametros, listEjercicios, listPeriodos, listMonedas, listTiposComprobante,
    crearCuenta, cambiarActivaCuenta, reiniciarDatosEjemplo,
    listCentrosCosto, listAuxiliares, getTasa, listComprobantes, getComprobante,
    grabarComprobante, reversarComprobante,
    getLibroDiario, getMayorAnalitico, getMovimientosAuxiliares, getBalanceComprobacion,
    listCierres, vistaPreviaCierreMes, cerrarMes, reabrirMes, cerrarEjercicio, reabrirEjercicio, abrirEjercicioSiguiente,
    getEstadoResultados, getBalanceGeneral,
    listReglasContabilizacion, listMapeos, listIntegraciones, vistaPreviaIntegracion, contabilizarIntegraciones,
    crearTipoComprobante, modificarTipoComprobante, cambiarActivoTipoComprobante, modificarTiposDeParametros,
    crearCentroCosto, modificarCentroCosto, cambiarActivoCentroCosto,
    crearAuxiliar, modificarAuxiliar, cambiarActivoAuxiliar,
    crearMoneda, modificarMoneda, cambiarActivaMoneda,
    listPaises, crearPais, modificarPais, cambiarActivoPais,
    listMonedasLocales, crearMonedaLocal, modificarMonedaLocal, cambiarActivaMonedaLocal,
    listCambios, crearCambio, modificarCambio, cambiarActivoCambio,
  };
}

/** Las tasas de cont_tasas más las manuales de «Cambio»; la manual manda en su fecha. */
const tasasDe = (e: EstadoSimulacion, cs: ContCambio[]): ContTasa[] =>
  tasasConCambios(e.cont_tasas, cs, (c) => ({ id: c.id, fecha: c.fecha, moneda: c.moneda as Moneda, tasa_ves: c.tasa_ves, fuente: 'manual' }));

const fuenteCierre = (e: EstadoSimulacion): FuenteCierre => ({
  comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas,
  centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
});

/**
 * Graba un comprobante que genera el sistema (diferencial, cierre,
 * apertura) en un período dado, sin pasar por la validación de pantalla:
 * el mes 13 no lo elige una fecha. Numera según Parámetros.
 */
/** Los procesos que pide cada tipo de Parámetros, para el mensaje de error. */
const PROCESO_DEL_TIPO = {
  tipo_comprobante_defecto_id: 'de la carga manual', tipo_diferencial_id: 'del diferencial cambiario',
  tipo_cierre_id: 'del cierre', tipo_apertura_id: 'de la apertura',
} as const;

/** El tipo de comprobante de un proceso, de Parámetros (DDL v0.8). Si falta o está inactivo, lo dice. */
function tipoDeProceso(e: EstadoSimulacion, campo: keyof typeof PROCESO_DEL_TIPO): string {
  const id = e.cont_parametros[campo];
  const t = id ? e.cont_tipos_comprobante.find((x) => x.id === id) : undefined;
  if (!t) throw new Error(`Indique en Parámetros el tipo de comprobante ${PROCESO_DEL_TIPO[campo]}.`);
  if (!t.activo) throw new Error(`El tipo de comprobante ${PROCESO_DEL_TIPO[campo]} (${t.codigo}) está inactivo: se activa o se elige otro en Parámetros.`);
  return t.id;
}

function grabarAutomatico(e: EstadoSimulacion, a: {
  tipoId: string; periodo: ContPeriodo; fecha: string; concepto: string; origen: ContComprobante['origen'];
  renglones: RenglonCierre[]; actor: string;
}): ContComprobante | null {
  if (!a.renglones.length) return null;
  const tipo = e.cont_tipos_comprobante.find((t) => t.id === a.tipoId);
  if (!tipo) throw new Error('El tipo de comprobante ya no existe.');
  const p = e.cont_parametros;
  const numero = siguienteNumero(e.cont_comprobantes, { tipo_id: tipo.id, periodo_id: a.periodo.id }, p.tipo_numeracion, e.cont_periodos);
  const id = nuevoId('cbte');
  const t = totalesCierre(a.renglones);
  const ahora = new Date().toISOString();
  const comp: ContComprobante = {
    id, ejercicio_id: a.periodo.ejercicio_id, tipo_id: tipo.id, periodo_id: a.periodo.id, numero,
    codigo: codigoComprobante(p.tipo_numeracion, tipo, a.periodo, numero), fecha: a.fecha, concepto: a.concepto.toUpperCase(),
    estado: t.debe_ves === t.haber_ves && t.debe_usd === t.haber_usd ? 'contabilizado' : 'descuadrado',
    origen: a.origen, origen_modulo: 'contabilidad', origen_tabla: null, origen_id: null, origen_ref: null,
    numero_lote: null, modificado: false, regla_id: null, moneda_documento: 'VES', tasa: null,
    total_debe_ves: t.debe_ves, total_haber_ves: t.haber_ves, total_debe_usd: t.debe_usd, total_haber_usd: t.haber_usd,
    reverso_de_id: null, historial: [{ at: ahora, evento: 'grabado', actor: a.actor, origen: a.origen }],
    created_at: ahora, created_by: a.actor, updated_at: null, updated_by: null,
  };
  e.cont_comprobantes.push(comp);
  a.renglones.forEach((r, i) => e.cont_comprobante_lineas.push({
    ...r, id: `${id}-l${i + 1}`, comprobante_id: id, renglon: i + 1, referencia: null, fecha_referencia: null,
  }));
  return comp;
}

/** El reverso de un comprobante del sistema (diferencial o cierre), en su mismo período y fecha. */
function reversarEn(e: EstadoSimulacion, comp: ContComprobante, motivo: string, actor: string): ContComprobante {
  const p = e.cont_parametros;
  const periodo = e.cont_periodos.find((x) => x.id === comp.periodo_id)!;
  const tipo = e.cont_tipos_comprobante.find((t) => t.id === comp.tipo_id)!;
  const numero = siguienteNumero(e.cont_comprobantes, comp, p.tipo_numeracion, e.cont_periodos);
  const ahora = new Date().toISOString();
  const idReverso = nuevoId('cbte');
  const reverso: ContComprobante = {
    ...comp, id: idReverso, numero, codigo: codigoComprobante(p.tipo_numeracion, tipo, periodo, numero),
    concepto: descripcionReverso(comp.codigo, motivo), estado: 'contabilizado', origen: 'reverso', reverso_de_id: comp.id,
    total_debe_ves: comp.total_haber_ves, total_haber_ves: comp.total_debe_ves,
    total_debe_usd: comp.total_haber_usd, total_haber_usd: comp.total_debe_usd,
    numero_lote: null, modificado: false, historial: [{ at: ahora, evento: 'grabado', actor, origen: 'reverso' }],
    created_at: ahora, created_by: actor, updated_at: null, updated_by: null,
  };
  comp.historial = [...comp.historial, { at: ahora, evento: 'reversado', actor, reverso: reverso.codigo }];
  e.cont_comprobantes.push(reverso);
  e.cont_comprobante_lineas.push(...renglonesDeReverso(e.cont_comprobante_lineas.filter((l) => l.comprobante_id === comp.id), idReverso));
  return reverso;
}

export interface ComprobanteCompleto {
  comprobante: ContComprobante;
  lineas: ContComprobanteLinea[];
  /** El reverso que lo anuló, si existe («Reversado por N°…»). */
  reversadoPor: ContComprobante | null;
}

/** Un renglón guardado, en la forma que edita la pantalla (Modificar e Insertar Copia). */
export function renglonDeLinea(l: ContComprobanteLinea): RenglonBorrador {
  return {
    cuenta_id: l.cuenta_id, fecha_referencia: l.fecha_referencia, referencia: l.referencia ?? '',
    auxiliar_id: l.auxiliar_id, centro_costo_id: l.centro_costo_id, descripcion: l.descripcion ?? '',
    moneda: l.moneda, monto_moneda: l.monto_moneda, lado: ladoDe(l), tasa: l.tasa,
  };
}

/** Lo que el historial guarda de un comprobante en cada modificación (pedido de BD v0.5). */
function resumenParaHistorial(c: ContComprobante, asientos: number) {
  return {
    fecha: c.fecha, concepto: c.concepto, estado: c.estado,
    total_debe_ves: c.total_debe_ves, total_haber_ves: c.total_haber_ves, total_debe_usd: c.total_debe_usd, total_haber_usd: c.total_haber_usd,
    asientos,
  };
}

function contexto(e: EstadoSimulacion): ContextoValidacion {
  return {
    cuentas: e.cont_cuentas, centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
    periodos: e.cont_periodos, parametros: e.cont_parametros, hoy: hoyISO(),
  };
}

/** Un id único para la simulación (la base usará gen_random_uuid()). */
function nuevoId(prefijo: string): string {
  const azar = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefijo}-${azar}`;
}

const repo = crearRepositorio(almacenDeLaApp, FUENTES_BD, almacenCambiosDeLaApp);

export const {
  listCuentas, getParametros, listEjercicios, listPeriodos, listMonedas, listTiposComprobante,
  crearCuenta, cambiarActivaCuenta, reiniciarDatosEjemplo,
  listCentrosCosto, listAuxiliares, getTasa, listComprobantes, getComprobante,
  grabarComprobante, reversarComprobante,
  getLibroDiario, getMayorAnalitico, getMovimientosAuxiliares, getBalanceComprobacion,
  listCierres, vistaPreviaCierreMes, cerrarMes, reabrirMes, cerrarEjercicio, reabrirEjercicio, abrirEjercicioSiguiente,
  getEstadoResultados, getBalanceGeneral,
  listReglasContabilizacion, listMapeos, listIntegraciones, vistaPreviaIntegracion, contabilizarIntegraciones,
  crearTipoComprobante, modificarTipoComprobante, cambiarActivoTipoComprobante, modificarTiposDeParametros,
  crearCentroCosto, modificarCentroCosto, cambiarActivoCentroCosto,
  crearAuxiliar, modificarAuxiliar, cambiarActivoAuxiliar,
  crearMoneda, modificarMoneda, cambiarActivaMoneda,
  listPaises, crearPais, modificarPais, cambiarActivoPais,
  listMonedasLocales, crearMonedaLocal, modificarMonedaLocal, cambiarActivaMonedaLocal,
  listCambios, crearCambio, modificarCambio, cambiarActivoCambio,
} = repo;
