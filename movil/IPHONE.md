# Instalar la app en tu iPhone desde tu Mac (gratis)

Sirve para probar la app en **tu** iPhone sin pagar la cuenta de desarrollador
de Apple. Dos límites: la app **vence a los 7 días** (se reinstala en dos
minutos con el paso 6) y no sirve para repartirla a otros. Para eso está
TestFlight, con la cuenta de USD 99 por año.

La primera vez lleva alrededor de una hora, casi toda de descarga.

## 1. Instalar Xcode (una sola vez)

1. En la Mac, abrí la **App Store**, buscá **Xcode** e instalalo. Es gratis y
   pesado: tarda.
2. Abrilo una vez. Aceptá lo que pide y, si pregunta qué plataformas instalar,
   marcá **iOS**.
3. En Xcode: menú **Xcode → Settings → Accounts →** botón **+** → **Apple ID**.
   Entrá con tu Apple ID de siempre. Queda un equipo llamado *Personal Team*.

## 2. Instalar Node.js (una sola vez)

Entrá a **nodejs.org**, descargá la versión **LTS** para macOS y abrí el
instalador. Siguiente, siguiente, listo.

## 3. Bajar el código

1. En GitHub, entrá al repositorio **meetings-brain**.
2. Arriba a la izquierda, cambiá la rama a
   **claude/meeting-recording-drive-app-6ugk55**.
3. Botón verde **Code → Download ZIP**. Descomprimilo (doble clic).

## 4. Preparar el iPhone (una sola vez)

1. Conectá el iPhone a la Mac con el cable. En el iPhone, tocá **Confiar**.
2. En el iPhone: **Ajustes → Privacidad y seguridad → Modo de desarrollador →**
   activalo. Se reinicia. Al volver, confirmá **Activar**.
   (Si la opción no aparece, hacé primero el paso 6 una vez: aparece después.)

## 5. Preparar el proyecto (una sola vez)

1. Abrí la app **Terminal** (buscala con Cmd + espacio).
2. Escribí `cd ` (con un espacio al final), arrastrá la carpeta **movil** que
   está dentro de lo que descomprimiste, y apretá Enter.
3. Escribí `npm install` y Enter. Tarda un par de minutos.

## 6. Instalar la app

Con el iPhone conectado y desbloqueado, en la misma Terminal:

```
npx expo run:ios --device --configuration Release
```

- Si pregunta qué dispositivo, elegí tu iPhone con las flechas y Enter.
- Si pregunta por el equipo de desarrollo (*development team*), elegí tu
  **Personal Team**.
- Si ofrece instalar CocoaPods, aceptá.

La primera vez tarda entre 5 y 15 minutos. Al terminar, la app aparece en el
iPhone.

## 7. Confiar en la app (la primera vez)

Si al abrirla dice *Desarrollador no fiable*: **Ajustes → General → VPN y
gestión de dispositivos →** tu Apple ID **→ Confiar**.

## Cada 7 días

La app deja de abrir. Conectá el iPhone, abrí la Terminal en la carpeta
**movil** (paso 5.2) y repetí el paso 6. No se pierde el vínculo ni las
grabaciones.

## Si algo falla

Copiá lo último que dice la Terminal (o sacale captura) y mandáselo a quien
mantiene la app.
