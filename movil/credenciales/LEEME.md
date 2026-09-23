# Firma de la app de Android

`asistente.keystore` firma el APK del piloto. Tiene que ser siempre la misma:
Android solo deja instalar una versión nueva encima de la anterior si las dos
vienen firmadas con la misma clave. Si se pierde o se cambia, cada persona
tiene que desinstalar la app y volver a instalarla (y vincularla de nuevo).

Usa el alias y las contraseñas que espera el proyecto que genera Expo
(`androiddebugkey` / `android`), así la compilación no necesita configuración.

Para publicar en Google Play no se usa esta: ahí la firma la maneja Google.
