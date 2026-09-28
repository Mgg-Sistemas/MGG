/* ============================================================
   MGG · Cocina · Leyenda del panel del mercado

   Las mismas preguntas vuelven cada ciclo: por qué «Queda» sale
   negativo, por qué un víver que sí está en el almacén no aparece
   en la lista, por qué el mercado dice un número y el inventario
   dice otro. Se venían respondiendo de a una, por mensaje.

   Van acá abajo, cerradas: quien ya sabe no las ve, quien no sabe
   las encuentra donde le aparece la duda y no tiene que preguntar.

   Lleva la clase `hint`, así el botón «?» del topbar también la
   esconde junto con el resto de las ayudas del sistema.
   ============================================================ */

interface Entrada {
  pregunta: string;
  respuesta: React.ReactNode;
}

/**
 * Las dudas frecuentes del panel, en el orden en que aparecen mirando la
 * pantalla de arriba abajo: primero los números del encabezado, después la
 * tabla, y al final las acciones del ciclo.
 */
const DUDAS: Entrada[] = [
  {
    pregunta: '¿Qué es «Disponible» y qué es «Queda»?',
    respuesta: (
      <>
        <strong>Disponible</strong> es lo que el ciclo tuvo para cocinar: el saldo con el que
        abrió, más lo que entró al almacén durante sus días, más o menos lo que se trasladó.{' '}
        <strong>Queda</strong> es eso menos lo que se consumió en las comidas y menos las{' '}
        <strong>mermas / salidas</strong>. Uno dice cuánto hubo, el otro cuánto sobra.
      </>
    ),
  },
  {
    pregunta: '¿«Queda» en negativo es un error?',
    respuesta: (
      <>
        No es un error de cálculo ni significa que el almacén esté en cero. El inventario real
        nunca baja de cero. Quiere decir que <strong>la cocina registró más consumo del que este
        ciclo vio entrar</strong>, y casi siempre es una de tres cosas:
        <ul style={{ margin: '.3rem 0 0', paddingLeft: '1.1rem' }}>
          <li>El víver ya estaba en el almacén <strong>antes</strong> de que abriera el ciclo.</li>
          <li>Entró por un movimiento que el ciclo no cuenta: otro almacén, o un movimiento
            cargado sin almacén.</li>
          <li>Se cargó de más en alguna comida.</li>
        </ul>
        Tocá el víver: el detalle muestra entradas, traslados, consumos y mermas, y ahí suele
        estar la respuesta.
      </>
    ),
  },
  {
    pregunta: 'Hay un víver en el almacén que no aparece en la lista. ¿Por qué?',
    respuesta: (
      <>
        La lista muestra los víveres <strong>de este ciclo</strong>: los que traía el saldo
        inicial, los que entraron y los que se consumieron. Si al abrir el mercado un víver dio
        saldo cero, no entró al libro, y recién aparece cuando alguien lo cocina — ahí es cuando
        se ve en negativo. También quedan fuera los que están en otro centro: cada cocina solo
        mira los almacenes de su sede.
      </>
    ),
  },
  {
    pregunta: 'El mercado dice que quedan X pero el inventario dice otra cosa.',
    respuesta: (
      <>
        El libro del mercado resta lo que sale por <strong>comidas</strong>, por{' '}
        <strong>traslados</strong> y por <strong>mermas / salidas</strong> (pérdidas, salidas
        manuales, ajustes a la baja), así que normalmente coincide con el almacén. Si igual hay
        diferencia, algo movió el stock sin quedar registrado en ninguna de esas tres: por ejemplo
        una comida borrada o editada a mano. Si el ciclo ya pasó su último día, se compara contra el
        inventario de ese día y no contra el de hoy. Cuando hay diferencia, el panel lo avisa
        arriba y el botón{' '}
        <strong>«Ver solo estos»</strong> deja en pantalla únicamente los víveres descuadrados.
      </>
    ),
  },
  {
    pregunta: '¿Qué es la columna «Traslados»? ¿Cómo reparto el mercado?',
    respuesta: (
      <>
        Los traslados entre almacenes se cuentan aparte y con signo: <strong>−</strong> lo que
        este centro envió y <strong>+</strong> lo que recibió. Así la cocina que reparte no queda
        con un faltante y la que recibe no lo cuenta como compra. Un traslado entre dos almacenes
        del mismo centro se anula solo.
        <br />
        Para repartir, <strong>«🚚 Repartir a otra cocina»</strong>. Desde acá el traslado{' '}
        <strong>no lleva autorización</strong> y se hace en el momento: la comida pasa de una cocina de
        la empresa a otra, no se va a ningún lado. Queda igual el registro en Salidas, con su código de
        traslado y su papel, marcado «no requiere autorización». Da igual si se hace antes o después de
        cerrar: cae en el ciclo que esté corriendo ese día.
        <br />
        El <strong>mismo traslado hecho desde el módulo de Traslados sí se autoriza</strong>, como
        siempre: ahí no se sabe si lo que sale va a otra cocina o a la calle. Mientras esa solicitud no
        se ejecuta, figura arriba como pendiente y el libro no la cuenta.
      </>
    ),
  },
  {
    pregunta: 'Un traslado dice «no aparece la llegada».',
    respuesta: (
      <>
        Salió de un almacén de este centro y no entró a ningún otro. No descuadra el mercado —el
        libro ya lo resta de acá— pero la mercancía falta en el camino: hay que revisarlo en
        Inventario con la fecha y la cantidad que muestra el aviso.
      </>
    ),
  },
  {
    pregunta: '¿Qué cuenta como consumo?',
    respuesta: (
      <>
        Solo lo que se registra en una comida desde esta pantalla. Si alguien saca víveres con una
        salida manual, registra una pérdida o corrige el stock con un ajuste, eso va a{' '}
        <strong>«Mermas / salidas»</strong>: resta de lo que queda, pero no es consumo y no sube el
        costo por plato. Su valor se ve aparte, en <strong>«Mermas valoradas»</strong>, y el detalle
        del víver dice quién la hizo y por qué.
      </>
    ),
  },
  {
    pregunta: '¿Cuánto dura un ciclo y cuándo se puede cerrar?',
    respuesta: (
      <>
        Veintiún días contados desde la fecha de apertura. El botón de cerrar se habilita recién
        pasado el último día. Si hace falta cortarlo antes, está{' '}
        <strong>«Cerrar mercado anticipadamente»</strong>.
      </>
    ),
  },
  {
    pregunta: '¿Con qué saldo arranca el mercado siguiente?',
    respuesta: (
      <>
        Con el remanente congelado al cerrar el anterior: lo que quedó es lo que abre. Si no hay
        ciclo anterior del cual heredar, o el anterior se descartó, el saldo es el{' '}
        <strong>inventario real del momento en que se aprieta «Iniciar mercado»</strong>, y el
        ciclo cuenta desde ese momento: lo que pasó antes ese mismo día ya está en el saldo.
      </>
    ),
  },
  {
    pregunta: '¿Al cerrar se pierde lo que quedó en la despensa?',
    respuesta: (
      <>
        <strong>No. El cierre nunca descarta lo que hay.</strong> Lo que quedó sin consumir se
        congela y pasa tal cual como <strong>saldo inicial del mercado nuevo</strong>, porque los
        víveres siguen en la despensa: el ciclo se termina, la comida no. A eso se le suman las
        <strong> entradas nuevas</strong>, y esa es la disponibilidad con la que arranca el corte.
        <br /><br />
        Hasta el 28/09/2026 existía un botón «Descartar mercado» que cerraba el ciclo sin pasarle
        el remanente. Se quitó: dejaba en cero una despensa que estaba llena, y cada cierre
        terminaba discutiendo kilos que nadie se había comido. Los dos ciclos que ya se
        descartaron se siguen leyendo como se cerraron.
      </>
    ),
  },
  {
    pregunta: '¿Qué pasa con los movimientos del ciclo que cierro?',
    respuesta: (
      <>
        Pasan <strong>todos al histórico</strong>: al cerrar, el sistema <strong>congela la lista
        completa</strong> —cada entrada, cada comida, cada traslado y cada merma— dentro del
        cierre. Desde ese momento el corte es una foto: si alguien carga después una comida con
        fecha vieja, <strong>el ciclo cerrado ya no cambia</strong>.
        <br /><br />
        El mercado nuevo arranca <strong>en el instante exacto del cierre</strong>, no al día
        siguiente del calendario. Así no queda un hueco entre los dos: todo movimiento cae en uno
        y solo uno, y nada se pierde ni se cuenta dos veces.
      </>
    ),
  },
  {
    pregunta: 'Quiero abrir un mercado y el sistema no me deja.',
    respuesta: (
      <>
        Dos ciclos no pueden compartir días: los mismos consumos se contarían dos veces. Si el
        anterior se cerró, el siguiente ya se abrió solo. Si se descartó, se puede abrir otro en
        el momento. Conviene abrirlo <strong>con el conteo y las entradas del día ya cargados</strong>:
        el saldo inicial es lo que hay en el inventario en ese instante.
      </>
    ),
  },
];

/** Preguntas frecuentes del panel, plegadas al pie. */
export function LeyendaMercado() {
  return (
    <details
      className="hint"
      style={{
        marginTop: '1rem', border: '1px solid var(--border)', borderRadius: 'var(--r-sm, 6px)',
        padding: '.5rem .75rem', background: 'var(--bg-1)',
      }}
    >
      <summary style={{ cursor: 'pointer', fontSize: '.82rem', color: 'var(--text-muted)', userSelect: 'none' }}>
        ❔ Cómo se leen estos números · dudas frecuentes
      </summary>
      <dl style={{ margin: '.6rem 0 .1rem', fontSize: '.82rem', lineHeight: 1.55 }}>
        {DUDAS.map((d) => (
          <div key={d.pregunta} style={{ marginBottom: '.7rem' }}>
            <dt style={{ fontWeight: 600, marginBottom: '.15rem' }}>{d.pregunta}</dt>
            <dd className="muted" style={{ margin: 0 }}>{d.respuesta}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
