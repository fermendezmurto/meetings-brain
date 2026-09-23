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

11. En Drive, **compartí la carpeta Asistente** con las personas del piloto,
    como **Editor**. Sin esto, el Asistente no puede anotar lo que ellas le piden.

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
- **Reunión:** grabala con la grabadora del teléfono y mandá el archivo al
  Asistente. Si escribís algo con el audio (*"reunión de producto con Diana y
  Christian"*), ayuda a saber quién dijo qué.
  - En 5 a 10 minutos te llega **la minuta por correo**, y cada responsable
    recibe sus tareas.
  - La **transcripción literal** se agrega al mismo documento en la media hora
    siguiente.
  - Todo queda en Drive: **Asistente → Reuniones → año-mes**.
- **Límite:** hasta 48 MB por audio, entre 50 minutos y hora y media según la
  calidad de grabación del teléfono. Si es más largo, partilo en dos.

> En el piloto, el Asistente no puede escribirte en Chat *después* de contestar:
> eso requiere un permiso del administrador. Por eso las minutas llegan por
> correo.

---

## Si algo sale mal

| Lo que ves | Qué pasa y qué hacer |
|---|---|
| "Falta GEMINI_API_KEY" | La propiedad del paso 7 de la Parte 1 no está, o tiene otro nombre. |
| "No puedo abrir la base" o error de permisos | No compartiste la carpeta Asistente con esa persona como Editor. |
| "Todavía no conozco a…" | Esa persona nunca le escribió al Asistente. Que le escriba *hola* una vez. |
| "Hay más de una persona que coincide" | Usá el nombre completo. |
| "Llegó al límite de pedidos del nivel gratuito" | Se agotó la cuota diaria de Gemini. Se renueva sola; con facturación activada no pasa. |
| "No pude bajar el audio de Chat" | Subí el audio a Drive y mandale el **enlace** al Asistente: lo lee igual. |
| Te llega "No pude procesar la reunión" | Lo intentó tres veces. El correo trae el motivo, y el audio sigue en Drive. |
| El Asistente no aparece en Chat | Revisá la **Visibilidad** del paso 9 de la Parte 2: tu correo tiene que estar. |
| "Asistente no responde", y en **Ejecuciones** no aparece ningún `onMessage` | Chat no está llegando al código. Revisá que `appsscript.json` sea el de [`dist/appsscript.json`](dist/appsscript.json) (tiene que tener una sección `addOns`), y el ID de implementación y los nombres de las funciones en la configuración de Chat. |
| "Permission denied while enabling APIs" | Habilitá a mano las cuatro APIs del paso 2c y volvé a correr instalar. |
| "Google retiró el modelo…" | El mismo mensaje dice qué valor poner en la propiedad `GEMINI_MODEL`. |
| "Gemini está saturado en este momento" | Es de Google y suele durar minutos; en el nivel gratuito pasa más seguido. Antes de decirlo, el Asistente ya probó con los dos modelos (ver *Qué modelos usa*). Con las reuniones sigue reintentando solo durante una hora. |

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

## Qué modelos usa

- **En Chat, primero el liviano** (`GEMINI_MODEL_NOTAS`): es el más rápido y el
  que menos se satura, y para entender una nota alcanza. Si está saturado,
  prueba el grande. `instalar` lo elige solo entre los modelos que Google
  ofrece a la clave, y en el registro muestra cuánto tardó cada uno.
- **En las reuniones, primero el grande** (`GEMINI_MODEL`), por la calidad de la
  minuta. Si está saturado, prueba el liviano (`GEMINI_MODEL_RESPALDO` lo
  cambia; `ninguno` lo apaga).
- Todos se cambian en **Propiedades del script**, sin tocar el código.

## Para conectar otros sistemas

La forma de todo lo que guarda el Asistente está en [DATOS.md](DATOS.md). Cada
reunión deja, además del documento, un `minuta.json` con decisiones,
compromisos, participantes y riesgos como datos.

## Actualizar a una versión nueva

Copiá de nuevo [`dist/Asistente.gs`](dist/Asistente.gs), pegalo encima de
`Código.gs` y guardá. Si cambió `appsscript.json`, pegalo también. Después
corré **instalar** otra vez: no duplica nada y deja todo al día.

## Abrirlo a toda la empresa

1. El **administrador de Workspace** permite la app de Chat para el dominio.
2. En la configuración de la Chat API (Parte 2, paso 9), la **Visibilidad**
   pasa a todo el dominio.
3. **Activar la facturación** del proyecto `reuniones`: sale del nivel gratuito
   y sus límites, y Google deja de usar el contenido. El costo es de centavos
   por hora de reunión.
4. Mover la carpeta Asistente a una **unidad compartida**, para que nada dependa
   de la cuenta de una persona.

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
- **Pruebas.** `npm test` corre, además de la lógica, 26 escenarios de punta a
  punta contra una imitación de los servicios de Google: instalar, anotar,
  cerrar, notas de voz, reuniones, fallas y reintentos. La imitación no
  reemplaza probarlo en Google: ver *Qué falta confirmar*.

### Qué falta confirmar en Google real

- **Bajar audios adjuntos en Chat** con la cuenta de quien escribe. Si Google lo
  rechaza, el Asistente pide el enlace de Drive, que funciona siempre.
- **El formato de las notas de voz de Chat** y de la grabadora de cada teléfono.
  Si Gemini no acepta alguno, el error lo dice y se agrega la conversión.
- **Cuánto tarda Gemini con una reunión de una hora.** Si la minuta de una
  reunión larga pasa el minuto de Apps Script, se reintenta y avisa; habría que
  bajar el límite de duración.
