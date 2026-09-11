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
        abrió más todo lo que entró al almacén durante sus días.{' '}
        <strong>Queda</strong> es eso menos lo que se consumió en las comidas. Uno dice cuánto
        hubo, el otro cuánto sobra.
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
        Tocá el víver: el detalle muestra los movimientos que el ciclo no cuenta y ahí suele
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
        El libro del mercado solo resta lo que sale por <strong>comidas</strong>. Una salida
        manual, un ajuste o un traslado mueven el almacén sin tocar la columna «Consumido»: de
        ahí sale la diferencia. Cuando la hay, el panel lo avisa arriba y el botón{' '}
        <strong>«Ver solo estos»</strong> deja en pantalla únicamente los víveres descuadrados.
      </>
    ),
  },
  {
    pregunta: '¿Qué cuenta como consumo?',
    respuesta: (
      <>
        Solo lo que se registra en una comida desde esta pantalla. Si la analista saca víveres
        con una salida manual o corrige el stock con un ajuste, el almacén baja pero el ciclo no
        lo cuenta como consumo. No está mal hecho: son cosas distintas, y por eso conviven las
        dos cifras.
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
        ciclo anterior del cual heredar, o el anterior se descartó, el saldo sale del{' '}
        <strong>inventario real</strong> del momento en que se abre.
      </>
    ),
  },
  {
    pregunta: '¿Qué pasa si descarto un mercado?',
    respuesta: (
      <>
        El ciclo deja de contar: no le pasa saldo al siguiente y sus cifras salen de la cadena.
        <strong> No se borra nada</strong> — las comidas, los movimientos y el historial quedan
        donde están, y el ciclo se puede seguir consultando en «Mercados cerrados», marcado como
        descartado. Hay que escribir por qué, y eso queda firmado.
      </>
    ),
  },
  {
    pregunta: 'Quiero abrir un mercado y el sistema no me deja.',
    respuesta: (
      <>
        Dos ciclos no pueden compartir días, ni siquiera con uno descartado: los mismos consumos
        se contarían dos veces. Si el ciclo anterior termina hoy, el nuevo arranca mañana. Y
        conviene <strong>dejar la fecha en el día de hoy</strong>: con una fecha pasada el saldo
        inicial se calcula hacia atrás y no coincide con lo que hay en el almacén.
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
