# Smart Energy Auditor

Smart Energy Auditor es un tablero web estático para monitoreo energético, calidad de energía y análisis tarifario. Esta primera versión está pensada para publicarse en GitHub Pages y leer datos públicos desde Firebase Realtime Database sin backend, dependencias ni herramientas de build.

## Objetivo

Visualizar datos tarifarios, simular consumo acumulado del período y calcular una estimación económica orientativa según el perfil seleccionado. El selector de perfil funciona localmente en el navegador y todavía no escribe cambios en Firebase.

## Arquitectura

- **GitHub Pages**: hospeda `index.html`, `styles.css` y `app.js` como sitio estático.
- **Firebase Realtime Database**: expone nodos públicos `.json` consumidos con `fetch()`.
- **ESP32 futuro**: enviará mediciones eléctricas reales hacia Firebase para alimentar el panel live.

No se usa backend, Node, frameworks, Firebase SDK, API keys ni credenciales.

## Endpoints utilizados

Base URL:

```text
https://smart-energy-auditor-929f3-default-rtdb.firebaseio.com
```

Endpoints leídos por el front:

```text
https://smart-energy-auditor-929f3-default-rtdb.firebaseio.com/devices/sea_001/config/billing.json
https://smart-energy-auditor-929f3-default-rtdb.firebaseio.com/tariffProfiles.json
https://smart-energy-auditor-929f3-default-rtdb.firebaseio.com/devices/sea_001/live.json
```

## Cómo activar GitHub Pages

1. Subir estos archivos a la rama principal del repositorio.
2. Entrar a **Settings** → **Pages** en GitHub.
3. En **Build and deployment**, seleccionar **Deploy from a branch**.
4. Elegir la rama principal y la carpeta raíz `/`.
5. Guardar la configuración y esperar a que GitHub publique la URL del sitio.

## Limitaciones actuales

- Los datos dependen de que Firebase Realtime Database permita lectura pública de los nodos utilizados.
- El perfil tarifario seleccionado se cambia solo en memoria del navegador.
- El cálculo económico es aproximado y no reemplaza la liquidación oficial de la distribuidora.
- No hay autenticación ni reglas de seguridad endurecidas para un entorno productivo.
- No incluye gráficas históricas ni persistencia local avanzada.

## Próximas etapas

- Escribir el perfil activo en Firebase.
- Integrar ESP32 para enviar mediciones reales.
- Agregar gráficas históricas.
- Agregar autenticación.
- Endurecer reglas de seguridad.
