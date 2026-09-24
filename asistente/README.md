# Asistente para Google Chat

Un contacto más en Google Chat, "Asistente", al que cualquiera de la empresa le
escribe o le manda un audio:

- **"Pedile a Diana el presupuesto para el martes"** → a Diana le llega la tarea
  por correo, de tu parte, y aparece en su Google Tasks.
- **"Reunión con Rony mañana a las 5"** → queda en tu Google Calendar, con
  invitación a Rony.
- **Un audio de una reunión** → te llega la minuta por correo, y cada responsable
  recibe sus tareas.
- **"pendientes"**, **"pedidos"**, **"listo 12"** → para ver y cerrar tareas.
- **Cada mañana hábil a las 8**, cada persona recibe sus pendientes.

Funciona igual para todos, sin importar el plan de Google Workspace de cada uno.
No necesita servidor ni tarjeta de crédito: vive en Google Apps Script, que ya
viene con Workspace.

---

## Antes de empezar: lo que vas a necesitar

- La **clave de Gemini** que creaste en el proyecto `reuniones` (empieza con `AQ.`).
- Los **correos de hasta 5 personas** para el piloto.
- Media hora.

> **Piloto en nivel gratuito.** En el nivel gratuito de Gemini, Google puede usar
> lo que se le manda para mejorar sus productos. Durante el piloto, no le mandes
> nada confidencial. Para usarlo en serio, se activa la facturación del proyecto
> `reuniones` y listo: el código no cambia.

---

## Parte 1 — Crear el Asistente (10 minutos)

1. Entrá a **script.google.com** con tu cuenta de la empresa y tocá **Nuevo
   proyecto**.
2. Arriba a la izquierda, donde dice *Proyecto sin título*, ponele **Asistente**.
3. Vas a ver un archivo `Código.gs` con unas líneas. **Borrá todo** lo que tiene.
4. Abrí en otra pestaña el archivo
   [`asistente/dist/Asistente.gs`](dist/Asistente.gs) de este repositorio, tocá
   el botón de **copiar** (arriba a la derecha del archivo) y **pegalo** en
   `Código.gs`. Guardá con el ícono del disquete.
5. Tocá el **engranaje** de la izquierda (*Configuración del proyecto*) y marcá
   **Mostrar el archivo de manifiesto "appsscript.json" en el editor**.
6. Volvé al editor (el ícono `< >`). Apareció un archivo `appsscript.json`.
   Abrilo, borrá todo y pegá el contenido de
   [`asistente/dist/appsscript.json`](dist/appsscript.json). Guardá.
7. Otra vez en el **engranaje**, bajá hasta **Propiedades del script** →
   **Agregar propiedad del script**:
   - Propiedad: `GEMINI_API_KEY`
   - Valor: tu clave de Gemini

   Guardá.
8. Volvé al editor. Arriba, al lado de *Ejecutar*, hay una lista de funciones:
   elegí **instalar** y tocá **Ejecutar**.
9. Google te va a pedir permisos. Tocá **Revisar permisos**, elegí tu cuenta y
   **Permitir**. Si aparece *"Google no verificó esta app"*, es normal porque la
   app es tuya: tocá **Configuración avanzada** → **Ir a Asistente**.
10. Abajo aparece el registro. Tiene que terminar con **"Listo. Todo instalado y
    la clave de Gemini funciona."**

Eso creó en tu Drive una carpeta **Asistente**, con la planilla que hace de base.

11. En Drive, **arrastrá la carpeta Asistente a la unidad compartida del
    proyecto**. Los enlaces y el código siguen funcionando: se guían por el
    identificador, no por el lugar.
12. **Sumá a las personas del piloto a la unidad compartida** como
    **Administrador de contenido** (en la unidad: *Administrar miembros*). Sin
    esto, el Asistente no puede anotar lo que ellas le piden ni guardar sus
    reuniones.

---

## Parte 2 — Conectarlo a Google Chat (15 minutos)

Esta parte es la más larga, pero se hace una sola vez.

### 2a. Preparar el proyecto de Google Cloud

1. Entrá a **console.cloud.google.com** y, arriba a la izquierda, elegí el
   proyecto **reuniones**.
2. Anotá el **Número de proyecto**: son solo dígitos, y no es lo mismo que el
   ID (los proyectos creados desde AI Studio tienen un ID tipo
   `gen-lang-client-…`). Está en **IAM y administración → Configuración**.
3. Buscá **Google Auth Platform** (en algunas cuentas, *Pantalla de
   consentimiento de OAuth*). Si dice **Comenzar**: nombre de la app
   **Asistente**, tu correo, público **Interno**, y crear. El botón *Crear
   cliente de OAuth* no hace falta. Si ya estaba configurada, seguí.

   Si **Interno** no aparece, el proyecto quedó fuera de la organización de la
   empresa: en *Administrar recursos* se ve bajo qué organización está.

### 2b. Unir el Asistente a ese proyecto

4. Volvé a **script.google.com**, al proyecto Asistente → **engranaje** →
   **Proyecto de Google Cloud** → **Cambiar proyecto**.
5. Pegá el **Número de proyecto** del paso 2 y tocá **Establecer proyecto**.

### 2c. Habilitar las APIs

Al unir el Asistente a un proyecto propio, Google tiene que habilitar ahí las
APIs que usa, y a veces no puede hacerlo solo (el error dice *Permission denied
while enabling APIs*). Desde **console.cloud.google.com**, con el proyecto
elegido, buscá cada una y tocá **Habilitar**:

- Google Drive API
- Google Sheets API
- Google Docs API
- Google Chat API
- Google Calendar API
- Google Tasks API

Después volvé a correr **instalar**: al cambiar de proyecto se pierden los
permisos que habías dado, y así se vuelven a pedir.

### 2d. Sacar el identificador de implementación

6. En el editor, arriba a la derecha: **Implementar** → **Implementaciones de
   prueba**.
7. Copiá el **ID de implementación HEAD**. Si aparece otro más abajo, bajo
   *Complemento de Google Workspace*, es el mismo.

> Esta implementación de prueba siempre usa la última versión guardada del
> código. Cuando haya una versión nueva, alcanza con pegarla y guardar.

### 2e. Dar de alta la app de Chat

Google Chat ahora crea las apps como **complementos de Workspace**. Arriba de
todo hay una casilla, **"Crea esta app de Chat como complemento de
Workspace"**: dejala **marcada**. Desmarcarla no tiene vuelta atrás, y el
Asistente entiende los dos formatos.

8. En **console.cloud.google.com** (proyecto reuniones), entrá a **Google Chat
   API** → pestaña **Configuración**.
9. Completá:
   - **Nombre de la app:** `Asistente`
   - **URL del avatar:** `https://developers.google.com/chat/images/quickstart-app-avatar.png`
     (o cualquier imagen pública)
   - **Descripción:** `Anota tareas y arma minutas`
   - **Funciones interactivas:** habilitadas.
   - **Funcionalidad:** marcá **Unirse a espacios y conversaciones grupales**.
   - **Configuración de conexión:** **Apps Script**, y pegá el **ID de
     implementación** del paso 7. La nota que recomienda una implementación con
     versiones se puede ignorar en el piloto.
   - **Activadores:** los nombres de las funciones, exactamente así:

     | Activador | Función |
     |---|---|
     | Comando de la app | `onMessage` |
     | Se agregó al espacio | `onAddedToSpace` |
     | Mensaje | `onMessage` |
     | Se quitó del espacio | `onRemovedFromSpace` |

     Si ofrece una sola función común para todos, poné `onMessage`.
   - **Visibilidad:** personas y grupos específicos, con los correos del piloto
     (hasta 5), incluido el tuyo.
   - **Registros:** marcá **Registrar errores en Logging**.
10. **Guardar**.

---

## Parte 3 — Usarlo

1. Abrí **Google Chat**, tocá **Nuevo chat** y buscá **Asistente**.
2. Escribile **hola**.
3. La primera vez, Chat te muestra un botón **Configurar**: son los permisos para
   que el Asistente actúe con tu cuenta. Aceptalos y **volvé a escribir hola**.
4. Probá: *"recordame llamar al banco el lunes"*, y después *"pendientes"*.

Cada persona del piloto hace estos mismos cuatro pasos. **Una persona tiene que
haberle escrito al Asistente al menos una vez para que se le puedan asignar
tareas:** así la conoce.

### Notas de voz y reuniones

- **Nota de voz:** grabala desde Chat o mandá un audio corto. Se contesta en el
  momento.
- **Reunión:** grabala con la **app Asistente** del celular (Parte 4), que
  graba con la pantalla bloqueada y la manda sola. También sirve mandarle al
  Asistente el archivo de la grabadora del teléfono. Si escribís con quién era
  (*"reunión de producto con Diana y Christian"*), ayuda a saber quién dijo qué.
  - En 5 a 10 minutos te llega **la minuta por correo**, y cada responsable
    recibe sus tareas.
  - La **transcripción literal** se agrega al mismo documento en la media hora
    siguiente.
  - Todo queda en Drive: **Asistente → Reuniones → año-mes**.
- **Límite:** con la app, 500 MB (unas diez horas). Un audio mandado por Chat,
  hasta 48 MB: entre 50 minutos y hora y media según el teléfono.

> En el piloto, el Asistente no puede escribirte en Chat *después* de contestar:
> eso requiere un permiso del administrador. Por eso las minutas llegan por
> correo.

---

## Parte 4 — La app del celular (15 minutos)

La app graba con la pantalla apagada y manda la grabación sola al terminar.
Cada persona la vincula a su cuenta con un código que le da el Asistente en
Chat, así que la app no pide usuario ni contraseña.

### 4a. Publicar la entrada para la app (una sola vez, lo hace quien instaló)

1. En Apps Script, arriba a la derecha: **Implementar → Nueva implementación**.
2. Al lado de *Seleccionar tipo*, tocá el engranaje ⚙ y elegí **Aplicación web**.
3. Descripción: `App del celular`.
4. **Ejecutar como:** *Yo*. **Quién tiene acceso:** *Cualquier usuario*.
   - Si *Cualquier usuario* no aparece, el administrador de Workspace lo tiene
     bloqueado: hay que pedirle que lo permita para Apps Script.
5. **Implementar**. Si pide autorizar, aceptá.
6. Copiá la **URL de la aplicación web** (termina en `/exec`). Esa dirección
   va adentro de la app: pasásela a quien compila la app.

> Esto no reemplaza lo de la Parte 2: Chat sigue usando la implementación
> *HEAD*. Son dos puertas al mismo Asistente.

### 4b. Instalar la app

- **Android:** en GitHub, entrá al repositorio → **Releases** → la más nueva →
  **Asistente.apk**. Abrilo desde el celular. Android pregunta si permitís
  instalar apps de esa fuente: sí. Las versiones nuevas se instalan encima,
  sin perder nada.
- **iPhone:** Apple no deja repartir apps fuera de su tienda sin una cuenta de
  desarrollador (USD 99 por año). Con esa cuenta, la app se reparte por
  TestFlight a quien se invite. Para probarla en un solo iPhone sin pagar, se
  instala desde una Mac con Xcode (guía *App en iPhone*): vence cada 7 días.

### 4c. Vincular y grabar

1. En Chat, escribile **vincular** al Asistente. Contesta con un código de seis
   números.
2. Abrí la app y escribí el código. Queda vinculada a tu cuenta.
3. Tocá **Grabar**. Podés bloquear el teléfono: en Android queda un aviso fijo
   mientras graba.
4. Al terminar, la app la envía sola y muestra *Enviando…*, después *Enviada*,
   y cuando está la minuta, **Abrir**.

Si se corta la señal, la app reintenta sola y sigue desde donde quedó. Si una
llamada interrumpe la grabación, al volver tocás **Continuar**.

---

## Si algo sale mal

| Lo que ves | Qué pasa y qué hacer |
|---|---|
| "Falta GEMINI_API_KEY" | La propiedad del paso 7 de la Parte 1 no está, o tiene otro nombre. |
| "No puedo abrir la base" o error de permisos | Esa persona no es miembro de la unidad compartida como Administrador de contenido. |
| "Todavía no conozco a…" | Esa persona nunca le escribió al Asistente. Que le escriba *hola* una vez. |
| "Hay más de una persona que coincide" | Usá el nombre completo. |
| "Llegó al límite de pedidos del nivel gratuito" | Se agotó la cuota diaria de Gemini. Se renueva sola; con facturación activada no pasa. |
| "No pude bajar el audio de Chat" | Subí el audio a Drive y mandale el **enlace** al Asistente: lo lee igual. |
| Te llega "No pude procesar la reunión" | Lo intentó tres veces. El correo trae el motivo, y el audio sigue en Drive. |
| El Asistente no aparece en Chat | Revisá la **Visibilidad** del paso 9 de la Parte 2: tu correo tiene que estar. |
| "Asistente no responde", y en **Ejecuciones** no aparece ningún `onMessage` | Chat no está llegando al código. Revisá que `appsscript.json` sea el de [`dist/appsscript.json`](dist/appsscript.json) (tiene que tener una sección `addOns`), y el ID de implementación y los nombres de las funciones en la configuración de Chat. |
| "Permission denied while enabling APIs" | Habilitá a mano las cuatro APIs del paso 2c y volvé a correr instalar. |
| "Google retiró el modelo…" | El mismo mensaje dice qué valor poner en la propiedad `GEMINI_MODEL`. |
| "Lo recibí, pero Gemini está lento en este momento" | No se perdió nada: el mensaje quedó en la bandeja y en un par de minutos llega la confirmación por correo. Pasa más seguido en el nivel gratuito. Si en media hora no se pudo, llega un correo diciéndolo. |
| "Asistente no responde" | Google cortó la ejecución antes de los 30 segundos. El mensaje ya estaba guardado: a los dos minutos se retoma solo y llega la confirmación por correo. **No hace falta repetirlo.** |

Para ver qué hizo el Asistente por dentro: en script.google.com, menú de la
izquierda → **Ejecuciones**.

---

## Calendar y Google Tasks

- Si lo que se dicta tiene **hora**, o es una **reunión, llamada o visita** con
  fecha, va al **calendario** de quien lo pidió, con invitación a los demás
  participantes que el Asistente conoce.
- Si es algo **para hacer**, va a **Google Tasks**:
  - Si es tuyo, aparece en tu lista en el momento.
  - Si es de otra persona, le llega por correo en el momento, y aparece en
    **su** Google Tasks la próxima vez que ella le escriba al Asistente. Google
    no deja escribir en la lista de otra persona sin un permiso del
    administrador de Workspace.
- **En los dos sentidos:** marcar una tarea como hecha en Google Tasks la
  cierra en el Asistente y le avisa a quien la pidió; cerrarla por Chat la
  marca como hecha en Google Tasks.
- Borrar una tarea de Google Tasks no la cierra: sigue en el resumen de la
  mañana hasta que alguien escriba *listo*.

## Cuando Gemini está lento

Chat espera la respuesta como mucho 30 segundos. Por eso:

1. **Todo mensaje se guarda primero** en la hoja Bandeja, antes de hacer nada.
2. Se intenta resolver en el momento, con un tope de unos 22 segundos.
3. Si no llega, se contesta enseguida que se termina después, y la tarea
   automática `procesarBandeja` (cada minuto) lo retoma sin apuro. La
   confirmación llega por correo.
4. Si Google cortó la ejecución a la mitad, a los dos minutos se retoma, sin
   anotar dos veces lo que ya se había anotado.

Lo que se termina fuera de Chat corre con la cuenta de quien instaló, así que
no puede tocar el calendario ni el Google Tasks de otra persona: el correo trae
un enlace para agregar el evento al calendario con un clic, y las tareas
aparecen en su Google Tasks la próxima vez que le escribe al Asistente.

## Qué modelos usa

Dos: el principal (`GEMINI_MODEL`) y uno liviano (`GEMINI_MODEL_NOTAS`, que
`instalar` elige solo entre los que Google ofrece a la clave).

- **En Chat, primero el que viene respondiendo más rápido**, según lo medido
  en la última media hora. Un modelo que acaba de fallar pasa al final de la
  fila. Si los dos vienen lentos, ni se intenta dentro de Chat: se contesta al
  instante y se termina después, así nunca aparece "no responde".
- **En las reuniones, primero el principal**, por la calidad de la minuta. Si
  está saturado, prueba el liviano (`GEMINI_MODEL_RESPALDO` lo cambia;
  `ninguno` lo apaga).
- `instalar` prueba los dos y deja en el registro cuánto tardó cada uno: esas
  mediciones son el punto de partida.
- Todo se cambia en **Propiedades del script**, sin tocar el código.

## Para conectar otros sistemas

La forma de todo lo que guarda el Asistente está en [DATOS.md](DATOS.md). Cada
reunión deja, además del documento, un `minuta.json` con decisiones,
compromisos, participantes y riesgos como datos.

## Actualizar a una versión nueva

Copiá de nuevo [`dist/Asistente.gs`](dist/Asistente.gs), pegalo encima de
`Código.gs` y guardá. Si cambió `appsscript.json`, pegalo también. Después
corré **instalar** otra vez: no duplica nada y deja todo al día.

Chat toma el código nuevo en el momento. **La app del celular no**: usa una
versión fija. Para pasarle el código nuevo: **Implementar → Administrar
implementaciones →** la de *App del celular* **→** lápiz ✏️ **→ Versión: Nueva
versión → Implementar**. La dirección no cambia.

## Abrirlo a toda la empresa

1. El **administrador de Workspace** permite la app de Chat para el dominio.
2. En la configuración de la Chat API (Parte 2, paso 9), la **Visibilidad**
   pasa a todo el dominio.
3. **Activar la facturación** del proyecto `reuniones`: sale del nivel gratuito
   y sus límites, y Google deja de usar el contenido. El costo es de centavos
   por hora de reunión.
4. La carpeta Asistente vive en una **unidad compartida**, para que nada
   dependa de la cuenta de una persona. Las personas nuevas se suman como
   miembros de la unidad.

---

## Cómo está hecho (para quien lo mantenga)

- `src/` tiene el código por partes. `dist/Asistente.gs` es lo mismo en un solo
  archivo, para pegar; se genera con `node scripts/armar-asistente.mjs` y una
  prueba falla si queda desactualizado.
- **Con qué cuenta corre.** Cuando alguien le escribe, el Asistente corre con
  la cuenta de esa persona: los correos salen en su nombre. El procesamiento de
  reuniones y el resumen de la mañana corren con la cuenta de quien lo instaló.
- **La base** es la planilla *Asistente — Base*: hojas Tareas, Reuniones y
  Personas. Se puede leer y corregir a mano.
- **Por qué las reuniones van en pasos.** Apps Script corta cualquier pedido a
  los 60 segundos y cualquier ejecución a los 6 minutos. La minuta sale en un
  solo pedido corto; la transcripción literal se pide en tramos de 10 minutos.
  Cada paso queda guardado en la hoja Reuniones, así que un corte no obliga a
  empezar de cero.
- **La app del celular** está en `movil/` (Expo, Android y iPhone). Habla con
  `Web.js`: el teléfono se vincula con un código de Chat y la grabación sube de
  a 4 MB a una subida reanudable de Drive. De Drive a Gemini el audio también
  pasa de a pedazos, así que no hay tope de 50 MB.
- **Pruebas.** `npm test` corre, además de la lógica, escenarios de punta a
  punta contra una imitación de los servicios de Google: instalar, anotar,
  cerrar, notas de voz, reuniones, la app mandando grabaciones con cortes de
  señal, fallas y reintentos. La imitación no
  reemplaza probarlo en Google: ver *Qué falta confirmar*.

### Qué falta confirmar en Google real

- **Bajar audios adjuntos en Chat** con la cuenta de quien escribe. Si Google lo
  rechaza, el Asistente pide el enlace de Drive, que funciona siempre.
- **El formato de las notas de voz de Chat** y de la grabadora de cada teléfono.
  Si Gemini no acepta alguno, el error lo dice y se agrega la conversión.
- **La subida reanudable de Drive desde Apps Script** (respuestas 308 y el
  encabezado Range), y que la aplicación web acepte pedidos sin sesión de
  Google.
- **Grabar con la pantalla apagada** en cada marca de teléfono: algunos Android
  cierran apps en segundo plano para ahorrar batería.
- **Cuánto tarda Gemini con una reunión de una hora.** Si la minuta de una
  reunión larga pasa el minuto de Apps Script, se reintenta y avisa; habría que
  bajar el límite de duración.
