/* ============================================================
   MGG · Contabilidad · Listas de fábrica de Galac

   Copiadas TAL CUAL de las fotos de Galac por el Carril BD
   (docs/cuaderno/informes/contabilidad-catalogos-galac.json, huella 1840b3d0,
   29/10 05:16). Son listas del producto o públicas: pueden ir al código
   (Master, 29/10 05:10). Lo propio de la empresa real (su tabla «Cambio»)
   NO va aquí: es de la Fase 3, en la carpeta excluida (contrato §4 ter).
   · tipos_comprobante: Código de 2 dígitos. Rango del sistema 90-98 (decisión de Master, 29/10
     05:13). Falta la página 2 de 2 (no fotografiada): puede traer más tipos.
     «GASTO DE ISLR» está en mayúsculas dentro del rango del sistema; en Galac
     parece cargado por el usuario ❓.
   · generado_por: Catálogo fijo de 23 orígenes, en el orden del combo de Galac. «Todos(as)»
     es solo el filtro y no es un valor. Galac no muestra códigos: el orden es
     la clave estable propuesta.
   · monedas: 75 filas visibles de 13 páginas (faltan la 4 a la 10 y la 13). En la
     página 12 los códigos salen cortados por la izquierda: se completan por
     ISO 4217 y se marcan con codigo_completado_por_iso. En la columna Símbolo
     la foto queda desalineada media fila: simbolo_dudoso marca los que pueden
     pertenecer a la fila vecina. Para MGG: VES es «Bolívar Soberano» en Galac
     y VED «Bolívar» (el usuario mantiene VES, 05:00). USDT no existe en Galac:
     es propia de MGG.
   · paises: ISO 3166 alfa-2. Solo la página 1 de 17 está fotografiada (15 filas).
   · monedas_locales: Tal cual en la instalación real. La fila VED con factor 0,00 desde
     01/01/2008 parece mal cargada en Galac (ese año entró el Bolívar Fuerte)
     ❓. 06/06/2079 es la fecha centinela de vigencia abierta.
   ============================================================ */

/** Tipos de comprobante de Galac: 2 dígitos; sistema = el rango 90-98, que el usuario no edita. */
export const TIPOS_COMPROBANTE_GALAC: ReadonlyArray<{ codigo: string; nombre: string; sistema: boolean }> = [
  { codigo: "01", nombre: "Cheques", sistema: false },
  { codigo: "02", nombre: "Depositos", sistema: false },
  { codigo: "03", nombre: "Cuentas x Cobrar", sistema: false },
  { codigo: "04", nombre: "Cuentas x Pagar", sistema: false },
  { codigo: "05", nombre: "Ventas / Ingresos", sistema: false },
  { codigo: "06", nombre: "Gastos", sistema: false },
  { codigo: "90", nombre: "GASTO DE ISLR", sistema: true },
  { codigo: "91", nombre: "Importación", sistema: true },
  { codigo: "92", nombre: "Administrativo", sistema: true },
  { codigo: "93", nombre: "Apertura", sistema: true },
  { codigo: "94", nombre: "Conciliación", sistema: true },
  { codigo: "95", nombre: "Cierre de Inventario", sistema: true },
  { codigo: "96", nombre: "Retiro de Activos Fijos", sistema: true },
  { codigo: "97", nombre: "Compra de Activos Fijos", sistema: true },
  { codigo: "98", nombre: "Depreciación", sistema: true },
];

/** «Generado Por» de Galac: 23 orígenes fijos, en el orden del combo (el orden es la clave). */
export const GENERADO_POR_GALAC: ReadonlyArray<{ orden: number; nombre: string }> = [
  { orden: 1, nombre: "Usuario" },
  { orden: 2, nombre: "Apertura" },
  { orden: 3, nombre: "Depreciación" },
  { orden: 4, nombre: "Cierre Ctas. de Resultado" },
  { orden: 5, nombre: "Cierre de Inventario" },
  { orden: 6, nombre: "Administrativo" },
  { orden: 7, nombre: "Importado" },
  { orden: 8, nombre: "Activo Fijo" },
  { orden: 9, nombre: "Reserva" },
  { orden: 10, nombre: "Retiro de Activo" },
  { orden: 11, nombre: "Conciliación" },
  { orden: 12, nombre: "Venta" },
  { orden: 13, nombre: "Compra" },
  { orden: 14, nombre: "Prorrateo" },
  { orden: 15, nombre: "Retención Iva en Venta" },
  { orden: 16, nombre: "Retención Iva en Compra" },
  { orden: 17, nombre: "Reconversión Monetaria" },
  { orden: 18, nombre: "Venta Diferida" },
  { orden: 19, nombre: "Aplicación de Venta Diferida" },
  { orden: 20, nombre: "Revalorización de Activo" },
  { orden: 21, nombre: "Depreciación Revalorización" },
  { orden: 22, nombre: "Retención ISLR" },
  { orden: 23, nombre: "Ganancia/Pérdida Cambiaria" },
];

/** Monedas de Galac, con las dos marcas de la lectura: código completado por ISO y símbolo dudoso. */
export const MONEDAS_GALAC: ReadonlyArray<{ codigo: string; nombre: string; simbolo: string; pagina: number; codigo_completado_por_iso: boolean; simbolo_dudoso: boolean }> = [
  { codigo: "1BT", nombre: "Bitcoin", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "1PT", nombre: "Petro", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9DC", nombre: "Dicon", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9E1", nombre: "Estimado 1", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9E2", nombre: "Estimado 2", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9E3", nombre: "Estimado 3", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9E4", nombre: "Estimado 4", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "9E5", nombre: "Estimado 5", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AED", nombre: "Dirham de los Emiratos Árabes Unidos", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AFN", nombre: "Afgani afgano", simbolo: "Af", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "ALL", nombre: "Lek albano", simbolo: "L", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AMD", nombre: "Dram armenio", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "ANG", nombre: "Florín de las Antillas Holandesas", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AOA", nombre: "Kwanza angoleño", simbolo: "$", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "ARS", nombre: "Peso argentino", simbolo: "", pagina: 1, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AUD", nombre: "Dólar australiano", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AWG", nombre: "Florín arubeño", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "AZM", nombre: "Manat azerbaiyano", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BAM", nombre: "marco convertible de Bosnia-Herzegovina", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BBD", nombre: "Dólar de Barbados", simbolo: "Bds$", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BDT", nombre: "Taka de Bangladesh", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BGN", nombre: "Lev búlgaro", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BHD", nombre: "Dinar bahreiní", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BIF", nombre: "Franco burundés", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BMD", nombre: "Dólar de Bermuda", simbolo: "BS", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "BND", nombre: "Dólar de Brunei", simbolo: "Sb", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "BOB", nombre: "Boliviano", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BOV", nombre: "Mvdol boliviano(código de fondos)", simbolo: "RS", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "BRL", nombre: "Real brasileño", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BSD", nombre: "Dólar bahameño", simbolo: "", pagina: 2, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BTN", nombre: "Ngultrum de Bután", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BWP", nombre: "Pula de Botswana", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BYR", nombre: "Rublo bielorruso", simbolo: "Br", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "BZD", nombre: "Dólar de Belice", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CAD", nombre: "Dólar canadiense", simbolo: "Can$", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CDF", nombre: "Franco congoleño", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CHF", nombre: "Franco suizo", simbolo: "Fr", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CLF", nombre: "Unidades de fomento chilenas", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CLP", nombre: "Peso chileno", simbolo: "$", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CNY", nombre: "Yuan Renminbi de China", simbolo: "¥", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "COP", nombre: "Peso colombiano", simbolo: "$", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "COU", nombre: "Unidad de valor real colombiana", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CRC", nombre: "Colón costarricense", simbolo: "C", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: true },
  { codigo: "CSD", nombre: "Dinar serbio", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "CUP", nombre: "Peso cubano", simbolo: "", pagina: 3, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "TND", nombre: "Dinar tunecino", simbolo: "", pagina: 11, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "TOP", nombre: "Panga tongano", simbolo: "T$", pagina: 11, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "TRY", nombre: "Nueva lira turca", simbolo: "YTL", pagina: 11, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "TTD", nombre: "Dólar de Trinidad y Tobago", simbolo: "", pagina: 11, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "TWD", nombre: "Dólar taiwanés", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "TZS", nombre: "Chelín tanzano", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "UAH", nombre: "Hryvnia ucraniana", simbolo: "hrn", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "UGX", nombre: "Chelín ugandés", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "USD", nombre: "Dólar", simbolo: "$", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "USN", nombre: "Dólar estadounidense", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "USS", nombre: "United States dollar", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "UYU", nombre: "Peso uruguayo", simbolo: "$U", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "UZS", nombre: "Som uzbeco", simbolo: "", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "VEB", nombre: "Bolívar Viejo", simbolo: "BsV", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "VED", nombre: "Bolívar", simbolo: "Bs", pagina: 11, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "VEF", nombre: "Bolívar Fuerte", simbolo: "BsF", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "VES", nombre: "Bolívar Soberano", simbolo: "BsS", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "VND", nombre: "Dong vietnamita", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "VUV", nombre: "Vatu vanuatense", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "WST", nombre: "Tala samoana", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "XAF", nombre: "Franco CFA", simbolo: "CFA", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "XAG", nombre: "Onza de plata", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "XAU", nombre: "Onza de oro", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "XBA", nombre: "European Composite Unit (EURCO) (Bonds market unit)", simbolo: "", pagina: 12, codigo_completado_por_iso: true, simbolo_dudoso: false },
  { codigo: "XBB", nombre: "European Monetary Unit (E.M.U.-6) (Bonds market unit)", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "XBC", nombre: "European Unit of Account 9 (E.U.A.-9) (Bonds market unit)", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "XBD", nombre: "European Unit of Account 17 (E.U.A.-17) (Bonds market unit)", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "XCD", nombre: "Dólar del Caribe Oriental", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "XDR", nombre: "Special Drawing Rights (FMI)", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
  { codigo: "XFO", nombre: "Franco de oro (Special settlement currency)", simbolo: "", pagina: 12, codigo_completado_por_iso: false, simbolo_dudoso: false },
];

/** Países de Galac (ISO 3166 alfa-2). */
export const PAISES_GALAC: ReadonlyArray<{ codigo: string; nombre: string }> = [
  { codigo: "AD", nombre: "Andorra" },
  { codigo: "AE", nombre: "Emiratos Árabes Unidos" },
  { codigo: "AF", nombre: "Afganistán" },
  { codigo: "AG", nombre: "Antigua y Barbuda" },
  { codigo: "AI", nombre: "Anguila" },
  { codigo: "AL", nombre: "Albania" },
  { codigo: "AM", nombre: "Armenia" },
  { codigo: "AN", nombre: "Antillas Neerlandesas" },
  { codigo: "AO", nombre: "Angola" },
  { codigo: "AQ", nombre: "Antártida" },
  { codigo: "AR", nombre: "Argentina" },
  { codigo: "AS", nombre: "Samoa Americana" },
  { codigo: "AT", nombre: "Austria" },
  { codigo: "AU", nombre: "Australia" },
  { codigo: "AW", nombre: "Aruba" },
];

/** Monedas locales de Galac (fechas ISO; 2079-06-06 es la fecha centinela de vigencia abierta). */
export const MONEDAS_LOCALES_GALAC: ReadonlyArray<{ codigo_pais: string; codigo_moneda: string; factor_conversion: number; codigo_moneda_anterior: string; vigencia_desde: string; vigencia_hasta: string }> = [
  { codigo_pais: "EC", codigo_moneda: "USD", factor_conversion: 1, codigo_moneda_anterior: "USD", vigencia_desde: "1900-01-01", vigencia_hasta: "2079-06-06" },
  { codigo_pais: "PE", codigo_moneda: "PEN", factor_conversion: 1, codigo_moneda_anterior: "PEN", vigencia_desde: "1900-01-01", vigencia_hasta: "2079-06-06" },
  { codigo_pais: "VE", codigo_moneda: "VEB", factor_conversion: 1, codigo_moneda_anterior: "VEB", vigencia_desde: "1900-01-01", vigencia_hasta: "2007-12-31" },
  { codigo_pais: "VE", codigo_moneda: "VED", factor_conversion: 0, codigo_moneda_anterior: "VEB", vigencia_desde: "2008-01-01", vigencia_hasta: "2079-06-06" },
];
