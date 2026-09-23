# Cómo ponerlo a andar

Guía para alguien que no es técnico. Son tres cosas, en este orden.

> **Por qué hace falta un servidor.** El navegador no te deja usar el micrófono
> en una página que no sea `https://`. Por eso la app tiene que vivir en una
> dirección de internet de verdad; no alcanza con abrirla en tu computadora.

---

## Paso 1 — La clave de Gemini (2 minutos)

Es la que escucha el audio y escribe la minuta.

1. Entrá a **aistudio.google.com/apikey** con tu cuenta de Google.
2. Botón **Crear clave de API**.
3. Copiá la clave que aparece y guardala en algún lado. Es un texto largo que
   empieza con `AIza...`.

Tiene nivel gratuito con un tope de pedidos por día. Para empezar, alcanza.

---

## Paso 2 — Poner la app en internet

Hay dos caminos. Empezá por el gratis.

> **GitHub Pages no sirve para esto**, aunque sea lo más a mano. Pages solo
> entrega páginas quietas: no puede correr un programa. Y esta app necesita uno
> del lado del servidor por tres motivos concretos: la clave de Gemini tiene que
> quedar escondida (si viaja al teléfono, cualquiera la ve y la usa a tu
> nombre), los tramos de audio necesitan dónde caer mientras la reunión pasa, y
> el login de Google se resuelve del lado del servidor. Lo mismo vale para
> Vercel en su plan gratuito: sirve páginas, pero no te garantiza un lugar fijo
> donde vayan cayendo los tramos.

### Opción A — Gratis, para probar (10 minutos, sin tarjeta)

**Render**, plan gratuito.

1. Entrá a **render.com** y elegí **Get Started with GitHub**.
2. **New** → **Blueprint**.
3. Elegí el repositorio `meetings-brain`. Render lee solo el archivo
   `render.yaml` que ya está en el proyecto y deja todo configurado.
4. Te va a pedir una sola cosa: **`GEMINI_API_KEY`**. Pegá la clave del paso 1.
5. **Apply**. En unos minutos te da una dirección tipo
   `https://reuniones.onrender.com`.

Dos cosas a saber de la versión gratuita, para que no te sorprendan:

- **Se duerme a los 15 minutos sin uso.** La primera vez que entrás después de
  un rato, tarda como un minuto en despertar. Mientras grabás no se duerme,
  porque la app le está hablando cada 30 segundos.
- **No tiene disco propio.** Las grabaciones viven mientras el servicio esté
  despierto y se pierden cuando se duerme o se actualiza. Para probar está
  perfecto. Para usarlo en serio, andá a la opción B.

### Opción B — Para usarlo de verdad (15 minutos, unos 5 dólares al mes)

**Railway**, que sí te da un disco que no se borra.

1. Entrá a **railway.com** y elegí **Login with GitHub**.
2. **New Project** → **Deploy from GitHub repo** → elegí `meetings-brain`.
   Si no aparece, dale permiso a Railway sobre el repositorio.
3. Cuando cree el servicio, entrá a **Settings** y en **Branch** elegí
   `claude/meeting-recording-drive-app-6ugk55`.
4. En **Settings → Volumes**, botón **Add volume**. En *Mount path* escribí:

   ```
   /datos
   ```

   Esto es el disco donde se guardan las grabaciones. Sin esto, cada vez que se
   actualice la app se borra todo lo grabado.
5. Andá a **Variables** y agregá estas, una por una:

   | Nombre | Valor |
   |---|---|
   | `GEMINI_API_KEY` | la clave del paso 1 |
   | `TRANSCRIBER` | `gemini` |
   | `SUMMARIZER` | `gemini` |
   | `UPLOADER` | `mock` |
   | `DATA_DIR` | `/datos` |

6. En **Settings → Networking**, botón **Generate Domain**. Te va a dar una
   dirección tipo `https://reuniones-production.up.railway.app`.

*(En Render también se puede: es el mismo plan pagando el disco aparte.)*

**Ya podés probar.** Abrí esa dirección en el teléfono, tocá *Entrar en modo de
prueba*, y grabá. Al terminar vas a ver la transcripción y la minuta de verdad,
hechas por Gemini.

> ⚠️ **No compartas todavía esa dirección.** Hasta el paso 3, cualquiera que la
> tenga entra sin contraseña y ve las grabaciones. Para probar vos solo, está
> bien.

---

## Paso 3 — El login de Google y el Drive (20 minutos)

Esto es lo que convierte la prueba en algo que puede usar todo el equipo: cada
uno entra con su cuenta y los archivos van a su Drive.

### 3a. Crear las credenciales

1. Entrá a **console.cloud.google.com** con la cuenta de la empresa.
2. Arriba a la izquierda, **crear un proyecto nuevo**. Llamalo `Reuniones`.
3. Buscador de arriba: escribí **Google Drive API**, entrá y tocá **Habilitar**.
4. Menú → **APIs y servicios** → **Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Interno** (así solo entra gente de la empresa).
   - Nombre de la app: `Reuniones`. Correo de asistencia: el tuyo. Guardá.
5. Menú → **Credenciales** → **Crear credenciales** → **ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - En *Orígenes autorizados de JavaScript* pegá tu dirección de Railway:
     `https://reuniones-production.up.railway.app`
   - En *URI de redireccionamiento autorizados* pegá la misma dirección **con
     `/api/auth/callback` al final**:
     `https://reuniones-production.up.railway.app/api/auth/callback`
   - Crear. Te muestra un **ID de cliente** y un **secreto**. Copiá los dos.

### 3b. Cargarlas en Railway

Volvé a **Variables** y agregá:

| Nombre | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | el ID de cliente |
| `GOOGLE_CLIENT_SECRET` | el secreto |
| `APP_URL` | tu dirección de Railway, sin barra al final |
| `ALLOWED_DOMAIN` | el dominio de la empresa, por ejemplo `empresa.com` |
| `SESSION_SECRET` | cualquier texto largo e inventado, 40 caracteres |
| `UPLOADER` | cambiá `mock` por `drive` |

Railway vuelve a desplegar solo. Ahora la app pide entrar con Google, solo deja
pasar cuentas del dominio, y deja los archivos en el Drive de cada persona.

---

## Cómo se usa

1. Entrás a la dirección desde el teléfono y hacés *Entrar con Google*.
2. **Agregala a la pantalla de inicio** para que se abra como una app:
   - iPhone: botón compartir → *Añadir a pantalla de inicio*.
   - Android: menú de tres puntos → *Instalar aplicación*.
3. *Grabar una reunión*. Poné un título y los nombres de quiénes están (opcional,
   pero mejora mucho la minuta).
4. *Empezar a grabar*. **Avisá a los presentes que se está grabando.**
5. **Dejá la pantalla encendida y la app abierta.** Si bloqueás el teléfono, en
   iPhone la grabación se corta.
6. *Terminar reunión*. Esperá a que diga que no quedan tramos por subir.
7. En un rato aparece la minuta, y en tu Drive la carpeta
   `Reuniones / año / mes / fecha — título` con el audio, la transcripción y la
   minuta como documento de Google.
8. Si algún nombre quedó como *sin confirmar*, tocá **Corregir**. Son diez
   segundos y es lo que le enseña al sistema quién es quién.

---

## Si algo sale mal

| Lo que ves | Qué pasa |
|---|---|
| "Esta app es solo para cuentas de…" | Entraste con una cuenta personal. Usá la de la empresa. |
| No pide el micrófono | La dirección tiene que empezar con `https://`. |
| "redirect_uri_mismatch" al entrar | La dirección del paso 3a está mal escrita. Tiene que terminar en `/api/auth/callback` y coincidir exactamente. |
| Quedaron tramos por subir | No cierres la pantalla: reintenta solo. Si seguís sin señal, esperá a tener wifi. |
| Tarda un minuto en abrir | Estás en el plan gratuito de Render y el servicio estaba dormido. Normal. |
| Desapareció una grabación vieja | El plan gratuito no guarda nada al dormirse. Es el motivo para pasar a la opción B. |
| La grabación quedó "Con error" | El audio está guardado, no se perdió. Se puede reintentar. |
