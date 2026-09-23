# Reuniones

> **El camino actual es el [Asistente para Google Chat](asistente/README.md).**
> Funciona igual para toda la empresa sin importar el plan de Workspace, sin
> servidor y sin costo en el piloto. La app web de más abajo fue el primer
> prototipo y queda como referencia.

Grabadora de reuniones para toda la empresa. Cada persona entra con su cuenta de
Google, graba desde el teléfono, y al terminar quedan el audio, la transcripción
y la minuta en su carpeta de Drive, sin pasos manuales.

Pensada para la **reunión presencial**, que es la que no cubre ningún bot de
videollamada: el comité, la visita al cliente, la conversación en la oficina.

## Cómo levantarlo

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sin tocar `.env.local` la app arranca en **modo de prueba**: entra sin Google, usa
un transcriptor y un resumidor falsos, y deja los archivos en `.data/salida/` con
el mismo árbol de carpetas que usaría en Drive. Sirve para recorrer la app entera
sin una sola credencial.

```bash
npm test         # pruebas de la lógica pura
npm run build    # compila
```

## Cómo funciona

```
teléfono                 servidor                       afuera
────────                 ────────                       ──────
MediaRecorder
  └─ trozo cada 30s ──▶  .data/audio/<id>/000001.part
                              │
  "terminar" ──────────▶  arma el audio completo
                              ├─ transcribe ──────────▶  Gemini (audio → turnos)
                              ├─ escribe la minuta ───▶  Gemini (texto → minuta)
                              └─ publica ─────────────▶  Drive: audio, transcripción,
                                                         minuta como documento
```

El audio se sube **mientras la reunión pasa**, no al final. Un trozo cada 30
segundos, numerado y reintentable: si el teléfono se queda sin batería a la hora
y media, lo grabado hasta ahí está en el servidor. Reenviar un trozo que ya
llegó lo pisa en lugar de duplicarlo, así que la reconexión no corrompe nada.

## Cuánto cuesta procesar una reunión

Gemini escucha el audio directo, así que no hace falta pagar un transcriptor
aparte. Gemini cuenta el audio a razón de unos **32 tokens por segundo**: una
hora de reunión son ~115.000 tokens de entrada. Con un modelo de la familia
Flash eso da **centavos de dólar por hora**, y la minuta, que se arma sobre el
texto y no sobre el audio, es una fracción de eso.

La API de Gemini además tiene **nivel gratuito** con límite de pedidos por día.
Para un equipo chico puede alcanzar sin pagar nada. Conviene confirmar precios y
límites vigentes antes de dimensionar: cambian seguido.

Por eso la minuta se arma sobre el texto ya transcrito y no mandando el audio de
nuevo: el audio se paga una vez.

## Configuración

Todo en `.env.example`. Lo que hay que decidir:

| Variable | Para qué |
|---|---|
| `GOOGLE_CLIENT_ID` / `SECRET` | Login de los usuarios y escritura en su Drive |
| `ALLOWED_DOMAIN` | Deja entrar solo a cuentas de la empresa |
| `GEMINI_API_KEY` | Transcripción y minuta. Se saca en aistudio.google.com |
| `TRANSCRIBER` | `mock`, `gemini`, `deepgram` o `assemblyai` |
| `SUMMARIZER` | `mock` o `gemini` |
| `UPLOADER` | `mock` (disco) o `drive` |
| `DRIVE_ROOT_FOLDER_ID` | Carpeta raíz. Conviene una unidad compartida |
| `AUDIO_RETENTION_DAYS` | Días que se guarda el audio crudo |

Deepgram y AssemblyAI quedan como alternativa por una razón concreta: separan
mejor las voces que Gemini cuando hay muchas personas sobre un solo micrófono.
Cuestan más. Se cambian con una variable, sin tocar código.

## La lista de gente

Al abrir una reunión se elige quiénes están tocando nombres, no escribiéndolos.
La lista es común a toda la empresa y **se arma sola**: entra quien usa la app y
entra cada nombre que alguien confirma al corregir una voz. Nadie mantiene una
nómina.

El campo para sumar a alguien sigue estando, porque a las reuniones también va
gente de afuera: clientes, proveedores, el estudio jurídico.

> En el plan gratuito de Render esta lista se pierde cuando el servicio se
> duerme, igual que las grabaciones. Con un disco de verdad, queda.

## Quién dijo qué

La transcripción devuelve voces numeradas, nunca nombres. El nombre sale de tres
lados, en orden de confianza:

1. **Confirmado** — una persona lo corrigió en la pantalla de la reunión.
2. **Calendario** — la lista de quiénes estaban, cargada al empezar a grabar.
3. **Dicho** — el modelo lo dedujo de lo que se dice en la reunión: se nombran
   entre ellos, se asignan trabajo.

Lo que el modelo dedujo se muestra marcado como *sin confirmar* y no se da por
bueno. Corregir un nombre son diez segundos y es la pieza que faltaba para que
el sistema aprenda voces: sobre esas confirmaciones se arma después el banco de
huellas.

## Límites conocidos

- **iOS no graba con la pantalla bloqueada.** Safari suspende la captura de audio
  cuando la web pasa a segundo plano. La app pide *wake lock* para mantener la
  pantalla encendida, pero si el usuario bloquea el teléfono a propósito, la
  grabación se corta. Si el equipo es mayoritariamente iPhone, hay que
  envolverla con Capacitor y modo de audio en segundo plano. **Falta probarlo en
  un iPhone real.**
- **Contenedor en Safari.** iOS graba en `audio/mp4`, no en webm. La app negocia
  el formato, pero unir trozos de mp4 no es tan seguro como unir webm. Hay que
  verificarlo con una grabación larga real antes de confiarle una reunión.
- **El procesamiento corre en memoria del proceso.** Si el servidor se reinicia
  con una reunión a mitad de transcripción, queda a mitad. El audio no se pierde
  y se puede reintentar, pero para producción esto va a una cola de verdad.
- **Las fichas se guardan como archivos JSON.** Alcanza para un equipo chico.
  Con concurrencia real pasa a Postgres sin cambiar quién lo llama.
- **Scope `drive.file`.** La app solo ve los archivos que ella crea. Si
  `DRIVE_ROOT_FOLDER_ID` apunta a una carpeta preexistente de una unidad
  compartida, Google puede rechazar la escritura; conviene dejar que la app cree
  su carpeta raíz una vez y usar ese id.

## Antes de usarlo en serio

- **Aviso de grabación.** Grabar una reunión con un cliente sin avisar es
  exposición legal. La pantalla de inicio lo recuerda, pero hace falta una
  política escrita.
- **Retención.** El audio crudo de una reunión de directorio tiene material
  sensible. Por defecto se conserva 90 días (`AUDIO_RETENTION_DAYS`); la minuta
  y la transcripción quedan siempre. Falta el trabajo programado que lo borra.
- **Privacidad.** Hoy cada grabación es privada de quien la hizo. Compartir a
  una carpeta común es deliberadamente un paso aparte: si todo se comparte solo,
  nadie graba lo incómodo, y lo incómodo suele ser lo importante.

## Qué sigue

1. Probar en un iPhone y en un Android reales, con una reunión de dos horas.
2. Traer los invitados del evento de Google Calendar para que los nombres salgan
   solos.
3. Banco de huellas de voz sobre las confirmaciones, para reconocer a las
   personas sin preguntar.
4. Carpeta compartida de la empresa además de la personal.
5. Borrado automático del audio al vencer la retención.
