/* ============================================================
   MGG · Cocina · Qué hay detrás de cada número del encabezado

   Las tarjetas del ciclo son siete cifras y cada ciclo alguien
   pregunta lo mismo por mensaje: «¿de dónde salió ese saldo?»,
   «¿por qué las mermas no suben el costo por plato?», «¿el traslado
   que mandé está contado?».

   Acá la tarjeta se toca y contesta sola: qué mide, la cuenta con los
   números puestos, los víveres que más pesan en ese número y la
   aclaración que corresponda. Nada que no se pueda deducir mirando el
   kardex — pero deducirlo llevaba media hora.

   Es un módulo puro: recibe los números ya calculados y devuelve
   texto. Así se puede probar sin montar la pantalla.
   ============================================================ */
import type { CostoDeAlimentar } from './costoPorPlato';
import type { TotalesMercado } from './mercadoComparar';
import type { DisponibleItem, KardexRow } from './mercados.repository';

export type ClaveCifra =
  | 'saldoInicial' | 'entradas' | 'traslados' | 'disponible' | 'consumos' | 'mermas' | 'queda'
  | 'platos' | 'costoConsumo' | 'costoPorPlato' | 'entradasValoradas' | 'mermasValoradas';

/** Un renglón del detalle: un víver, un tipo de comida, un destino. */
export interface RenglonCifra {
  nombre: string;
  /** Ya formateado: puede ser «12,5 KILOGRAMO» o «$ 18,40». */
  valor: string;
  nota?: string;
}

export interface ExplicacionCifra {
  titulo: string;
  /** Qué mide, en una línea. */
  queEs: string;
  /** La cuenta con los números puestos. `null` cuando la cifra no sale de otras. */
  cuenta: string | null;
  tituloLista: string | null;
  renglones: RenglonCifra[];
  /** Cuántos quedaron fuera de la lista. */
  restantes: number;
  /** La aclaración o la advertencia que corresponda. */
  ojo: string | null;
}

/** Lo que hace falta para explicar cualquiera de las cifras. */
export interface DatosCifra {
  totales: TotalesMercado;
  costo: CostoDeAlimentar;
  mermasValor: number;
  disponible: DisponibleItem[];
  kardex: KardexRow[];
  /** Fecha del inventario contra el que se comparó. */
  inventarioAl: string | null;
  /** Cuántos días lleva el ciclo, para el promedio por día. */
  dia: number;
  /** Cómo escribir un número y un monto: los trae la pantalla, así el módulo no depende del formato. */
  num: (n: number) => string;
  money: (n: number) => string;
  /** «Desayuno» a partir de `desayuno`. */
  etiquetaComida: (t: string) => string;
}

/** Cuántos renglones se listan antes del «y N más». */
export const TOPE_RENGLONES = 6;

type CampoViver = 'saldoInicial' | 'entradas' | 'traslados' | 'consumos' | 'mermas' | 'disponible' | 'queda';

/** Los víveres que más pesan en una columna, de mayor a menor en valor absoluto. */
function topViveres(
  disponible: DisponibleItem[], campo: CampoViver, num: (n: number) => string,
): { renglones: RenglonCifra[]; restantes: number } {
  const conValor = disponible
    .filter((d) => Math.abs(Number(d[campo]) || 0) > 1e-9)
    .sort((a, b) => Math.abs(Number(b[campo])) - Math.abs(Number(a[campo])));
  return {
    renglones: conValor.slice(0, TOPE_RENGLONES).map((d) => ({
      nombre: d.nombre,
      valor: `${num(Number(d[campo]))} ${d.unidad}`.trim(),
    })),
    restantes: Math.max(0, conValor.length - TOPE_RENGLONES),
  };
}

const conSigno = (n: number, num: (n: number) => string) => (n > 0 ? `+${num(n)}` : n < 0 ? `−${num(Math.abs(n))}` : '0');

/** El texto que abre una tarjeta al tocarla. */
export function explicarCifra(clave: ClaveCifra, d: DatosCifra): ExplicacionCifra {
  const { totales: t, costo, num, money } = d;

  switch (clave) {
    case 'saldoInicial': {
      const { renglones, restantes } = topViveres(d.disponible, 'saldoInicial', num);
      return {
        titulo: 'Saldo inicial',
        queEs: 'Lo que había el día que arrancó este ciclo, antes de comprar nada.',
        cuenta: null,
        tituloLista: 'Los víveres que más saldo traían',
        renglones,
        restantes,
        ojo: 'Si el ciclo anterior se cerró, este saldo es su remanente congelado: lo que quedó allá abrió acá. '
          + 'Si no hubo ciclo anterior, es el inventario real del instante en que se apretó «Iniciar mercado».',
      };
    }

    case 'entradas': {
      const cuantas = d.kardex.filter((k) => k.kind === 'entrada').length;
      const { renglones, restantes } = topViveres(d.disponible, 'entradas', num);
      return {
        titulo: '+ Entradas',
        queEs: 'Víveres que entraron al almacén durante los días del ciclo.',
        cuenta: `${cuantas} entrada${cuantas === 1 ? '' : 's'} · ${num(t.entradas)} en total · ${money(costo.entradas)}`,
        tituloLista: 'Los que más entraron',
        renglones,
        restantes,
        ojo: 'Lo que llega de otra cocina NO cuenta acá: un traslado recibido va en «± Traslados», '
          + 'porque no es una compra nueva, es mercancía que ya era de la empresa.',
      };
    }

    case 'traslados': {
      const patas = d.kardex.filter((k): k is Extract<KardexRow, { kind: 'traslado' }> => k.kind === 'traslado');
      const envio = patas.filter((p) => p.cantidad < 0).reduce((a, p) => a + Math.abs(p.cantidad), 0);
      const recibio = patas.filter((p) => p.cantidad > 0).reduce((a, p) => a + p.cantidad, 0);
      const sinLlegada = patas.filter((p) => p.sinLlegada > 0).length;
      const { renglones, restantes } = topViveres(d.disponible, 'traslados', num);
      return {
        titulo: '± Traslados',
        queEs: 'Lo que se movió entre almacenes, con signo: lo que este centro envió y lo que recibió.',
        cuenta: `−${num(envio)} enviado  +${num(recibio)} recibido  =  ${conSigno(t.traslados, num)}`,
        tituloLista: 'Por víver (− envía, + recibe)',
        renglones,
        restantes,
        ojo: sinLlegada > 0
          ? `⚠ ${sinLlegada} traslado${sinLlegada === 1 ? '' : 's'} salió de este centro y no aparece su llegada a ningún almacén. `
            + 'No descuadra el mercado —el libro ya lo restó— pero la mercancía está en el camino.'
          : 'Un traslado entre dos almacenes del MISMO centro se anula solo: no cambia lo que la cocina tiene. '
            + 'Mientras el traslado no se ejecuta, el libro no lo cuenta.',
      };
    }

    case 'disponible':
      return {
        titulo: '= Disponible',
        queEs: 'Todo lo que este ciclo tuvo para cocinar.',
        cuenta: `${num(t.saldoInicial)} saldo  +  ${num(t.entradas)} entradas  ${conSigno(t.traslados, num)} traslados  =  ${num(t.disponible)}`,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: 'Es un número de referencia: no dice cuánto hay ahora, dice cuánto hubo en total. '
          + 'Lo que hay ahora es «Queda».',
      };

    case 'consumos': {
      const comidas = d.kardex.filter((k): k is Extract<KardexRow, { kind: 'consumo' }> => k.kind === 'consumo');
      const porTipo = new Map<string, { platos: number; veces: number }>();
      for (const c of comidas) {
        const k = c.comida.tipo_comida;
        const a = porTipo.get(k) ?? { platos: 0, veces: 0 };
        porTipo.set(k, { platos: a.platos + (Number(c.comida.platos) || 0), veces: a.veces + 1 });
      }
      const { renglones, restantes } = topViveres(d.disponible, 'consumos', num);
      return {
        titulo: '− Consumo',
        queEs: 'Lo que se sirvió: la suma de los víveres cargados en cada comida.',
        cuenta: `${comidas.length} comida${comidas.length === 1 ? '' : 's'} · ${num(costo.platos)} platos · ${money(costo.consumo)}`,
        tituloLista: 'Los víveres más consumidos',
        renglones: [
          ...[...porTipo.entries()].map(([tipo, v]) => ({
            nombre: d.etiquetaComida(tipo),
            valor: `${num(v.platos)} platos`,
            nota: `${v.veces} registro${v.veces === 1 ? '' : 's'}`,
          })),
          ...renglones,
        ],
        restantes,
        ojo: 'Solo cuenta lo que se registra como COMIDA en esta pantalla. Si alguien saca víveres con una '
          + 'salida manual, registra una pérdida o corrige el stock con un ajuste, eso va a «Mermas / salidas».',
      };
    }

    case 'mermas': {
      const mermas = d.kardex.filter((k): k is Extract<KardexRow, { kind: 'merma' }> => k.kind === 'merma');
      const porQuien = new Map<string, number>();
      for (const m of mermas) porQuien.set(m.actor_name || '—', (porQuien.get(m.actor_name || '—') ?? 0) + 1);
      const { renglones, restantes } = topViveres(d.disponible, 'mermas', num);
      return {
        titulo: '− Mermas / salidas',
        queEs: 'Lo que salió del almacén sin ser comida ni traslado: pérdidas, salidas manuales y ajustes a la baja.',
        cuenta: `${mermas.length} movimiento${mermas.length === 1 ? '' : 's'} · ${num(t.mermas)} en total · ${money(d.mermasValor)}`,
        tituloLista: 'Los víveres con más merma',
        renglones: [
          ...[...porQuien.entries()].map(([quien, veces]) => ({
            nombre: `Cargadas por ${quien}`, valor: `${veces} vez${veces === 1 ? '' : 'ces'}`,
          })),
          ...renglones,
        ],
        restantes,
        ojo: 'NO suben el costo por plato: una pérdida no es comida servida. Su valor se lee aparte, '
          + 'en «Mermas valoradas». Restan de lo que queda para que el mercado cuadre con el almacén.',
      };
    }

    case 'queda': {
      const { renglones, restantes } = topViveres(d.disponible, 'queda', num);
      const negativos = d.disponible.filter((x) => x.queda < -1e-9).length;
      const descuadre = t.diferencia != null && t.vieresConDiferencia > 0
        ? `⚠ Según el inventario${d.inventarioAl ? ` al ${d.inventarioAl}` : ''} quedan ${num(t.inventario ?? 0)}: `
          + `una diferencia de ${t.diferencia > 0 ? '+' : ''}${num(t.diferencia)} en ${t.vieresConDiferencia} víver${t.vieresConDiferencia === 1 ? '' : 'es'}. `
          + 'El botón «Ver solo estos» los deja solos en la tabla.'
        : null;
      const enNegativo = negativos > 0
        ? `${negativos} víver${negativos === 1 ? ' quedó' : 'es quedaron'} en negativo: la cocina registró más consumo del que este ciclo vio entrar. `
          + 'No es un error de cálculo ni el almacén en cero — casi siempre el víver ya estaba antes de abrir el ciclo.'
        : null;
      return {
        titulo: '= Queda',
        queEs: 'Lo que sobra hoy y pasa como saldo inicial del próximo mercado.',
        cuenta: `${num(t.disponible)} disponible  −  ${num(t.consumos)} consumo  −  ${num(t.mermas)} mermas  =  ${num(t.queda)}`,
        tituloLista: 'Los víveres con más remanente',
        renglones,
        restantes,
        ojo: [descuadre, enNegativo].filter(Boolean).join(' ') || 'El cierre congela este número y se lo pasa entero al ciclo nuevo: no se descarta nada.',
      };
    }

    case 'platos': {
      const porDia = d.dia > 0 ? costo.platos / d.dia : 0;
      return {
        titulo: 'Platos servidos',
        queEs: 'Cuántos platos se sirvieron en las comidas registradas del ciclo.',
        cuenta: d.dia > 0 ? `${num(costo.platos)} platos en ${num(d.dia)} días  ≈  ${num(Math.round(porDia))} por día` : null,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: 'Es el divisor del costo por plato: si una comida se carga sin platos, el costo por plato sube '
          + 'sin que haya cambiado nada en la cocina.',
      };
    }

    case 'costoConsumo':
      return {
        titulo: 'Costo del consumo',
        queEs: 'Lo que costaron los víveres que se sirvieron.',
        cuenta: null,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: 'Cada víver se valora a su costo promedio del inventario. No incluye mermas ni traslados: '
          + 'es solo comida servida.',
      };

    case 'costoPorPlato':
      return {
        titulo: 'Costo por plato',
        queEs: 'Cuánto costó, en promedio, dar de comer una vez.',
        cuenta: costo.porPlato != null
          ? `${money(costo.consumo)}  ÷  ${num(costo.platos)} platos  =  ${money(costo.porPlato)}`
          : null,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: costo.porPlato == null
          ? 'Todavía no se sirvió ningún plato: hasta que se cargue la primera comida no hay contra qué dividir, '
            + 'y un «$ 0,00 por plato» sería un dato falso.'
          : 'Es el número con el que se compara un ciclo contra otro. Las mermas quedan afuera a propósito: '
            + 'lo que se dañó no se lo comió nadie, y cargarlo al plato escondería la pérdida.',
      };

    case 'entradasValoradas':
      return {
        titulo: 'Entradas valoradas',
        queEs: 'Lo que costó todo lo que entró al almacén durante el ciclo.',
        cuenta: null,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: 'No es lo mismo que el costo del consumo: esto es lo que se compró, aquello es lo que se cocinó. '
          + 'La diferencia sigue en la despensa.',
      };

    case 'mermasValoradas':
      return {
        titulo: 'Mermas valoradas',
        queEs: 'Lo que se perdió, en dinero.',
        cuenta: null,
        tituloLista: null,
        renglones: [],
        restantes: 0,
        ojo: 'Va aparte del costo por plato justamente para que se vea. Sumada ahí adentro, una pérdida grande '
          + 'pasaría por «comimos más caro este mes».',
      };
  }
}
