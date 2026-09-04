/*
  UNA CALCULADORA QUE SABE DE MONEDAS

  La primera versión solo entendía sumas y restas, y con lo demás hizo algo
  peor que fallar: `(1+98.09usdt*2eur)/2usd` lo leyó como si todo fueran sumas
  y devolvió un número con total confianza. Una calculadora que se inventa la
  cuenta es más peligrosa que una que no calcula.

  Ahora lee la cuenta entera —paréntesis, `*`, `/`, signos— y cuando no puede
  con algo lo dice en vez de aproximarlo.

  LAS MONEDAS TIENEN DIMENSIÓN, Y ESO NO ES PEDANTERÍA

  Cada valor lleva su exponente de dinero: `300 $` es dinero (1), `1,16` es un
  número suelto (0). Las operaciones lo arrastran:

    dinero + dinero → dinero          300 $ + 50 €
    dinero × número → dinero          300 $ × 1,16      (el IVA)
    dinero ÷ número → dinero          (300 $ + 200 $) ÷ 2   (repartir)
    dinero ÷ dinero → número          1.000 $ ÷ 800 $ = 1,25   (una proporción)
    dinero × dinero → NO EXISTE

  Esa última es la de tu cuenta: multiplicar 98,09 USDT por 2 € daría
  «USDT·euros», que no es nada. Antes salía un número; ahora sale el motivo.

  UN NÚMERO SIN MONEDA

  Sumando o restando, toma la moneda del otro lado: `300 $ + 50` son 350
  dólares, que es lo que quiere decir cualquiera. Multiplicando o dividiendo se
  queda como número suelto, que es lo que hace falta para el IVA o para
  repartir. La regla cabe en una línea y no depende de dónde esté escrito.

  TODO PASA POR BOLÍVARES

  Es la única moneda contra la que hay tasas registradas; no existe una tabla
  de pares. Euros → bolívares → USDT, con una conversión intermedia y sin
  inventar cruces que nadie anotó.
*/

export interface Valor {
  /** El monto llevado a bolívares. Para un número suelto, el número tal cual. */
  bs: number
  /** 0 = número suelto, 1 = dinero. Cualquier otra cosa es un error. */
  dim: number
  /** Con qué moneda se escribió, para poder ascender un número suelto. */
  moneda?: string
}

type Nodo =
  | { t: 'num'; valor: number; moneda?: string }
  | { t: 'op'; op: '+' | '-' | '*' | '/'; a: Nodo; b: Nodo }
  | { t: 'neg'; a: Nodo }
  | { t: 'pct'; a: Nodo }

export class ErrorDeCuenta extends Error {}

// ---------------------------------------------------------------------------
// Trocear
// ---------------------------------------------------------------------------
type Ficha =
  | { t: 'num'; valor: number }
  | { t: 'moneda'; codigo: string }
  | { t: 'sig'; s: string }

/**
 * Coma o punto como decimal.
 *
 * En Venezuela se escribe `15,50` y el teclado numérico pone `15.50`. Cuando
 * aparecen los dos manda el último, que es el decimal en las dos convenciones:
 * `1.234,56` y `1,234.56` son el mismo número escrito por dos personas.
 *
 * OJO CON EL PUNTO SOLO. Esa regla no alcanza cuando hay un único separador y es
 * un punto: en Venezuela el punto es el separador de MILES, así que `2.000` son
 * dos mil, no dos. Tomando el último separador como decimal, `2.000` daba 2 y
 * `1.234.567` daba 1.234 — el mismo error que tenía el motor anterior de MGG,
 * y en una calculadora de tesorería eso es equivocarse por mil.
 *
 * El desempate es la cantidad de dígitos que siguen: un grupo de miles son
 * SIEMPRE exactamente tres. `2.000`→2000 y `15.50`→15,5. Se excluye el caso de
 * un cero delante, porque nadie escribe `0.125` queriendo decir ciento
 * veinticinco. Con coma sola no hay ambigüedad: en es-VE la coma es el decimal.
 */
function aNumero(crudo: string): number {
  const puntos = (crudo.match(/\./g) ?? []).length
  const comas = (crudo.match(/,/g) ?? []).length

  // Varios separadores iguales y ninguno del otro tipo: son de miles, PERO solo
  // si agrupan de a tres. «1.000.00» no es un número bien escrito y darlo por
  // cien mil sería inventar; en ese caso se cae a la regla del último separador.
  if ((puntos > 1 && comas === 0) || (comas > 1 && puntos === 0)) {
    const partes = crudo.split(/[.,]/)
    const agrupaBien = partes.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d{1,3}$/.test(partes[0])
    if (agrupaBien) return Number(partes.join(''))
  }

  // Un punto solo: miles si le siguen exactamente tres dígitos y no viene de un 0.
  if (puntos === 1 && comas === 0) {
    const [entero, resto] = crudo.split('.')
    if (resto?.length === 3 && entero !== '0' && /^\d+$/.test(entero) && /^\d{3}$/.test(resto)) {
      return Number(entero + resto)
    }
  }

  const corte = Math.max(crudo.lastIndexOf(','), crudo.lastIndexOf('.'))
  if (corte === -1) return Number(crudo)
  return Number(crudo.slice(0, corte).replace(/[.,]/g, '') + '.' + crudo.slice(corte + 1))
}

/**
 * Cuántas letras hay que cambiar para pasar de una palabra a la otra.
 *
 * Se corta en cuanto pasa de dos: no hace falta el número exacto, solo saber
 * si están cerca. `bsb` y `bs` distan una.
 */
function distancia(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const nueva = [i]
    for (let j = 1; j <= b.length; j++) {
      nueva[j] = Math.min(
        fila[j] + 1,
        nueva[j - 1] + 1,
        fila[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    fila = nueva
  }

  return fila[b.length]
}

/**
 * Qué moneda quiso escribir quien tecleó otra cosa.
 *
 * Un aviso que solo dice que algo está mal deja a quien lo lee igual de
 * atascado. `bsb` es `bs` con un dedo de más, y eso se puede decir.
 */
function parecida(palabra: string, alias: Map<string, string>): string | null {
  const busca = palabra.toUpperCase()
  let mejor: { codigo: string; d: number } | null = null

  for (const [clave, codigo] of alias) {
    // Los nombres largos del catálogo no sirven de sugerencia para un teclazo
    // corto: nadie escribe «Dólar estadounidense» y le sobra una letra.
    if (clave.length > 6) continue

    const d = busca.startsWith(clave) || clave.startsWith(busca) ? 1 : distancia(busca, clave)
    if (d <= 1 && (!mejor || d < mejor.d)) mejor = { codigo, d }
  }

  return mejor?.codigo ?? null
}

function trocear(
  texto: string,
  alias: Map<string, string>,
  simbolo: (c: string) => string,
): Ficha[] {
  const fichas: Ficha[] = []
  let i = 0

  while (i < texto.length) {
    const c = texto[i]

    if (/\s/.test(c)) {
      i++
      continue
    }

    /* Los glifos tipográficos valen igual que los ASCII. Un teclado en pantalla
       muestra «×» y «÷» porque se leen mejor, y de ahí salen tal cual hacia acá;
       el signo «−» de un texto pegado tampoco es el guion del teclado. Si el
       motor solo aceptara ASCII, multiplicar y dividir sería imposible desde la
       interfaz — pasó exactamente eso: la normalización vivía en el motor viejo
       y se perdió al reemplazarlo, sin que ningún test lo notara. */
    const ascii = ({ '×': '*', '÷': '/', '−': '-', '–': '-', '—': '-' } as Record<string, string>)[c] ?? c

    if ('+-*/()%'.includes(ascii)) {
      fichas.push({ t: 'sig', s: ascii })
      i++
      continue
    }

    // El símbolo del euro y el del dólar no son letras.
    if (c === '$' || c === '€') {
      const codigo = alias.get(c)
      if (!codigo) throw new ErrorDeCuenta(`«${c}» no es una moneda del sistema.`)
      fichas.push({ t: 'moneda', codigo })
      i++
      continue
    }

    if (/[\d.,]/.test(c)) {
      let j = i
      while (j < texto.length && /[\d.,]/.test(texto[j])) j++
      const crudo = texto.slice(i, j)
      const valor = aNumero(crudo)
      if (!Number.isFinite(valor)) throw new ErrorDeCuenta(`«${crudo}» no es un número.`)
      fichas.push({ t: 'num', valor })
      i = j
      continue
    }

    if (/\p{L}/u.test(c)) {
      let j = i
      while (j < texto.length && /\p{L}/u.test(texto[j])) j++
      const palabra = texto.slice(i, j)
      const codigo = alias.get(palabra.toUpperCase())

      if (!codigo) {
        const cerca = parecida(palabra, alias)
        throw new ErrorDeCuenta(
          cerca
            ? `«${palabra}» no es una moneda. ¿Querías escribir ${simbolo(cerca)}?`
            : `«${palabra}» no es una moneda del sistema.`,
        )
      }
      fichas.push({ t: 'moneda', codigo })
      i = j
      continue
    }

    throw new ErrorDeCuenta(`Sobra un «${c}» en la cuenta.`)
  }

  return fichas
}

// ---------------------------------------------------------------------------
// Leer la cuenta
// ---------------------------------------------------------------------------
function analizar(fichas: Ficha[]): Nodo {
  let i = 0

  const mirar = () => fichas[i]
  const esSigno = (s: string) => {
    const f = mirar()
    return f?.t === 'sig' && f.s === s
  }

  function expresion(): Nodo {
    let izq = termino()
    while (esSigno('+') || esSigno('-')) {
      const op = (fichas[i] as { s: string }).s as '+' | '-'
      i++
      izq = { t: 'op', op, a: izq, b: termino() }
    }
    return izq
  }

  function termino(): Nodo {
    let izq = unario()
    while (esSigno('*') || esSigno('/')) {
      const op = (fichas[i] as { s: string }).s as '*' | '/'
      i++
      izq = { t: 'op', op, a: izq, b: unario() }
    }
    return izq
  }

  function unario(): Nodo {
    if (esSigno('-')) {
      i++
      return { t: 'neg', a: unario() }
    }
    if (esSigno('+')) {
      i++
      return unario()
    }
    return posfijo()
  }

  /** El `%` va PEGADO DETRÁS de lo que afecta: `16 %`, `(10 + 6) %`. */
  function posfijo(): Nodo {
    let n = primario()
    while (esSigno('%')) {
      i++
      n = { t: 'pct', a: n }
    }
    return n
  }

  function primario(): Nodo {
    if (esSigno('(')) {
      i++
      const dentro = expresion()
      if (!esSigno(')')) throw new ErrorDeCuenta('Falta cerrar un paréntesis.')
      i++
      return dentro
    }

    const f = mirar()
    if (f?.t !== 'num') throw new ErrorDeCuenta('Falta un número en la cuenta.')
    i++

    // La moneda va pegada detrás del número: `98,09 usdt`.
    const siguiente = mirar()
    if (siguiente?.t === 'moneda') {
      i++
      return { t: 'num', valor: f.valor, moneda: siguiente.codigo }
    }

    return { t: 'num', valor: f.valor }
  }

  const arbol = expresion()

  if (i < fichas.length) {
    const sobra = fichas[i]
    throw new ErrorDeCuenta(
      sobra.t === 'sig' && sobra.s === ')'
        ? 'Sobra un paréntesis cerrado.'
        : 'Sobra algo al final de la cuenta.',
    )
  }

  return arbol
}

// ---------------------------------------------------------------------------
// Calcular
// ---------------------------------------------------------------------------
function evaluar(n: Nodo, enBolivares: Map<string, number>, nombre: (c: string) => string): Valor {
  if (n.t === 'num') {
    if (!n.moneda) return { bs: n.valor, dim: 0 }

    const tasa = enBolivares.get(n.moneda)
    if (tasa === undefined) {
      throw new ErrorDeCuenta(`Falta registrar la tasa de ${nombre(n.moneda)}.`)
    }
    return { bs: n.valor * tasa, dim: 1, moneda: n.moneda }
  }

  if (n.t === 'neg') {
    const a = evaluar(n.a, enBolivares, nombre)
    return { ...a, bs: -a.bs }
  }

  // Un porcentaje SUELTO es una fracción: `16 %` vale 0,16 y no es dinero.
  if (n.t === 'pct') {
    const a = evaluar(n.a, enBolivares, nombre)
    if (a.dim !== 0) throw new ErrorDeCuenta('Un porcentaje se escribe con un número suelto, sin moneda.')
    return { bs: a.bs / 100, dim: 0 }
  }

  /* EL PORCENTAJE DENTRO DE UNA CUENTA, como en cualquier calculadora.
     En una suma o una resta, `16 %` significa «el 16 % DE lo que está a la
     izquierda» — que es exactamente cómo se agrega el IVA: `1.000 $ + 16 %`
     son 1.160 $, no 1.000,16. En un producto o un cociente no hay ambigüedad
     y vale la fracción a secas. Sin este caso especial, la forma natural de
     pedir el IVA daría un número absurdo sin avisar. */
  if (n.b.t === 'pct') {
    const base = evaluar(n.a, enBolivares, nombre)
    const p = evaluar(n.b.a, enBolivares, nombre)
    if (p.dim !== 0) throw new ErrorDeCuenta('Un porcentaje se escribe con un número suelto, sin moneda.')
    const fraccion = p.bs / 100
    if (n.op === '+') return { ...base, bs: base.bs * (1 + fraccion) }
    if (n.op === '-') return { ...base, bs: base.bs * (1 - fraccion) }
    if (n.op === '*') return { ...base, bs: base.bs * fraccion }
    if (fraccion === 0) throw new ErrorDeCuenta('No se puede dividir entre cero.')
    return { ...base, bs: base.bs / fraccion }
  }

  const a = evaluar(n.a, enBolivares, nombre)
  const b = evaluar(n.b, enBolivares, nombre)

  if (n.op === '+' || n.op === '-') {
    const signo = n.op === '+' ? 1 : -1

    if (a.dim === b.dim) {
      return { bs: a.bs + signo * b.bs, dim: a.dim, moneda: a.moneda ?? b.moneda }
    }

    // Un número suelto sumado a dinero toma la moneda del otro lado.
    const ascender = (suelto: Valor, dinero: Valor): Valor => {
      const tasa = enBolivares.get(dinero.moneda ?? '')
      if (tasa === undefined) throw new ErrorDeCuenta('Falta la tasa para esa suma.')
      return { bs: suelto.bs * tasa, dim: 1, moneda: dinero.moneda }
    }

    if (a.dim === 0 && b.dim === 1) {
      const sube = ascender(a, b)
      return { bs: sube.bs + signo * b.bs, dim: 1, moneda: b.moneda }
    }
    if (b.dim === 0 && a.dim === 1) {
      const sube = ascender(b, a)
      return { bs: a.bs + signo * sube.bs, dim: 1, moneda: a.moneda }
    }

    throw new ErrorDeCuenta('No se pueden sumar esas dos cosas.')
  }

  if (n.op === '*') {
    const dim = a.dim + b.dim
    if (dim > 1) {
      throw new ErrorDeCuenta(
        'No se puede multiplicar dinero por dinero: el resultado no sería una cantidad. Para un porcentaje usa un número suelto, como «× 1,16».',
      )
    }
    return { bs: a.bs * b.bs, dim, moneda: a.moneda ?? b.moneda }
  }

  if (b.bs === 0) throw new ErrorDeCuenta('No se puede dividir entre cero.')

  const dim = a.dim - b.dim
  if (dim < 0) {
    throw new ErrorDeCuenta('No se puede dividir un número entre dinero.')
  }
  return { bs: a.bs / b.bs, dim, moneda: dim === 1 ? (a.moneda ?? b.moneda) : undefined }
}

// ---------------------------------------------------------------------------
// Devolver la cuenta escrita como se entendió
// ---------------------------------------------------------------------------
function escribir(n: Nodo, simbolo: (c: string) => string): string {
  /* SIN separador de miles, a propósito. Esta línea existe para despejar cómo se
     entendió la cuenta, y con agrupación «1.075» se escribiría igual que lo
     tecleado — no despejaría nada. Sin agrupar, «1075» dice sin lugar a dudas
     que se leyó mil setenta y cinco y no uno coma cero siete cinco. */
  const numero = (v: number) =>
    new Intl.NumberFormat('es-VE', { maximumFractionDigits: 4, useGrouping: false }).format(v)

  if (n.t === 'num') {
    return n.moneda ? `${numero(n.valor)} ${simbolo(n.moneda)}` : numero(n.valor)
  }
  if (n.t === 'neg') return `−${escribir(n.a, simbolo)}`
  if (n.t === 'pct') return `${escribir(n.a, simbolo)} %`

  const signos = { '+': '+', '-': '−', '*': '×', '/': '÷' } as const

  /* «16 % DE QUÉ» es justo lo que hay que despejar: en una suma el porcentaje
     se toma sobre lo de la izquierda, y verlo escrito es la diferencia entre
     confiar en el número y adivinarlo. */
  if (n.b.t === 'pct' && (n.op === '+' || n.op === '-')) {
    const base = escribir(n.a, simbolo)
    return `(${base} ${signos[n.op]} ${escribir(n.b.a, simbolo)} % de ${base})`
  }

  const dentro = `${escribir(n.a, simbolo)} ${signos[n.op]} ${escribir(n.b, simbolo)}`

  // Solo lleva paréntesis lo que los necesita para leerse igual que se calcula.
  return n.op === '+' || n.op === '-' ? `(${dentro})` : dentro
}

export interface Resultado {
  valor: Valor
  /** La cuenta tal como se entendió, para poder comprobarla de un vistazo. */
  comoSeLeyo: string
}

/**
 * Resuelve una cuenta con monedas.
 *
 * `enBolivares` lleva cuántos bolívares vale una unidad de cada moneda; el
 * bolívar contra sí mismo es 1. `alias` traduce lo que escribe la gente —`$`,
 * `bs`, `euros`— al código del catálogo.
 */
export function calcular(
  texto: string,
  alias: Map<string, string>,
  enBolivares: Map<string, number>,
  nombre: (c: string) => string,
  simbolo: (c: string) => string,
): Resultado | null {
  if (!texto.trim()) return null

  const fichas = trocear(texto, alias, simbolo)
  if (fichas.length === 0) return null

  const arbol = analizar(fichas)
  const valor = evaluar(arbol, enBolivares, nombre)

  if (!Number.isFinite(valor.bs)) throw new ErrorDeCuenta('La cuenta no da un número.')

  // Los paréntesis de fuera sobran: envuelven la cuenta entera y no aclaran
  // nada. Los de dentro se quedan, que son los que dicen el orden.
  let leida = escribir(arbol, simbolo)
  if (arbol.t === 'op' && (arbol.op === '+' || arbol.op === '-')) {
    leida = leida.slice(1, -1)
  }

  return { valor, comoSeLeyo: leida }
}
