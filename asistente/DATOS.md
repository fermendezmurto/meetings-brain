# Contrato de datos del Asistente

Qué guarda el Asistente, dónde, y con qué forma. Es lo que tiene que leer
cualquier sistema que se conecte después, como el cerebro de la empresa, sin
tener que interpretar texto libre.

Todo vive en Google Drive, dentro de la carpeta **Asistente**, y se lee con las
APIs de Google Sheets y Drive. Las formas de acá son estables: si una cambia, se
agrega al final o se sube la versión, nunca se reemplaza en silencio.

## Identificadores

| Qué | Identificador | Ejemplo |
|---|---|---|
| Tarea o evento | `N`, número correlativo, nunca se reutiliza | `12` |
| Reunión | `ID`: ocho caracteres si llegó por Chat, doce si llegó por la app del celular | `3f9a1c2e`, `a1b2c3d4e5f6` |
| Persona | correo de la empresa, en minúsculas | `diana@empresa.com` |

Una tarea que salió de una reunión lleva el `ID` de esa reunión en la columna
**Reunión**: con eso se une una tarea con la minuta que la originó.

## Planilla "Asistente — Base"

Las columnas nuevas se agregan siempre **al final**. Un sistema que lee por
posición no se rompe; uno que lee por nombre de encabezado, tampoco.

### Hoja Tareas

Tareas y eventos, una fila cada uno.

| Columna | Contenido |
|---|---|
| N | Número de la tarea |
| Creada | `AAAA-MM-DD HH:mm`, hora de Asunción |
| Qué | Lo que hay que hacer, o lo que es el evento |
| Responsable | Nombre de quien la tiene que hacer. Vacío si nadie se la llevó |
| Email responsable | Vacío si no se pudo identificar a la persona |
| Plazo | `AAAA-MM-DD`, o vacío |
| Estado | `abierta` o `cerrada` |
| Pidió | Nombre de quien la anotó o grabó la reunión |
| Email pidió | |
| Origen | `mensaje`, `nota de voz`, o `reunión: <título>` |
| Enlace | Minuta de la reunión de origen, si la hay |
| Cerrada | `AAAA-MM-DD HH:mm` en que se cerró |
| Tipo | `tarea` o `evento` |
| Hora | `HH:MM` en 24 horas, solo en eventos con hora |
| ID en Calendar | Id del evento en el calendario de quien lo pidió |
| ID en Google Tasks | Id de la tarea en la lista del responsable |
| Reunión | `ID` de la reunión de la que salió |
| Mensaje | `ID` del mensaje de la bandeja del que salió |
| Cerrada en Tasks | `sí` cuando el cierre ya se reflejó en Google Tasks |

Un **evento** cuyo día ya pasó se considera ocurrido, aunque su estado diga
`abierta`.

### Hoja Reuniones

| Columna | Contenido |
|---|---|
| ID | Identificador de la reunión |
| Recibida | `AAAA-MM-DD HH:mm` |
| Título | El que le puso la minuta |
| Grabó / Email | Quién mandó el audio |
| Nota | Lo que escribió al mandarlo |
| Carpeta / Audio | Ids de Drive |
| Estado | `recibida`, `subida`, `transcribiendo`, `completa` o `error` |
| Minuta | Enlace al documento |
| Duración (min) | Medida por Gemini |
| Participantes | Nombres, separados por coma y espacio |

Las demás columnas son de trabajo interno del procesamiento.

### Hoja Bandeja

Todo lo que llega por Chat pasa primero por acá, antes de que el Asistente
haga nada con eso. Si la ejecución se corta, o Gemini está saturado, el mensaje
no se pierde: la tarea automática de cada minuto lo retoma.

| Columna | Contenido |
|---|---|
| ID | Identificador del mensaje |
| Recibido | `AAAA-MM-DD HH:mm` |
| Quién / Email | Quién lo mandó |
| Texto | Lo que escribió, si escribió |
| Audio | Id en Drive de la nota de voz, mientras no se procesa |
| Estado | `procesando`, `pendiente`, `lista` o `error` |
| Intentos / Error | Cuántas veces se intentó y por qué falló la última |

### Hoja Personas

Nombre, email y última vez que la persona le escribió al Asistente. Es la
nómina de quienes usan el Asistente, y se arma sola.

## Carpeta de cada reunión

`Asistente / Reuniones / AAAA-MM / AAAA-MM-DD — Título /`

| Archivo | Para qué |
|---|---|
| audio | La grabación original |
| Documento de Google | La minuta, para leer y comentar |
| `minuta.json` | **La minuta como datos.** Es lo que tiene que leer otro sistema |
| `transcripcion.txt` | Transcripción literal: `[mm:ss] Nombre: texto` |

### minuta.json, versión 1

```json
{
  "version": 1,
  "tipo": "minuta",
  "id": "3f9a1c2e",
  "fecha": "2026-09-25",
  "recibida": "2026-09-25 10:04",
  "titulo": "Seguimiento comercial",
  "grabo": { "nombre": "Fernando Mendez", "email": "fernando@empresa.com" },
  "nota": "reunión con Diana",
  "duracionMinutos": 42,
  "resumen": "Tres a seis frases.",
  "participantes": [{ "nombre": "Diana Valiente", "rol": "" }],
  "decisiones": ["El precio va sin IVA."],
  "compromisos": [
    {
      "tarea": 12,
      "que": "Cerrar el presupuesto",
      "responsable": "Diana Valiente",
      "email": "diana@empresa.com",
      "plazo": "2026-09-29"
    }
  ],
  "preguntasAbiertas": [],
  "riesgos": [],
  "enlaces": { "minuta": "https://…", "carpeta": "https://…", "audio": "https://…" }
}
```

`compromisos[].tarea` es el `N` de la hoja Tareas. El estado actual de cada
compromiso (abierto o cerrado) se lee de ahí, no de este archivo, que es una
foto del momento de la reunión.

## Lo que no se guarda

- **El audio de las notas de voz.** Se guarda en `Asistente / Bandeja` solo hasta
  procesarlo, y después va a la papelera de Drive; queda la tarea.
- **Las conversaciones con el Asistente.** Solo queda lo que se anotó.

## Lo que guarda la app del celular

Fuera de la planilla, en las **propiedades del script** (no son datos para
consultar, pero conviene saber que existen):

- `TELEFONO_<clave>`: cada teléfono vinculado, con nombre, correo y fecha. Para
  desvincular uno a la fuerza, se borra esa propiedad.
- `SUBIDA_<ID>`: una grabación que está llegando. Se borra sola al terminar;
  si una queda colgada más de una semana, se puede borrar.

Una grabación de la app, una vez completa, es una reunión más: misma fila en
**Reuniones**, misma carpeta y mismo `minuta.json`.
