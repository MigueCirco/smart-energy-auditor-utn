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

## Módulo de facturación

La pantalla **Tarifas y factura** organiza el cálculo alrededor de dos tipos de usuario fáciles de entender: **Residencial** y **Empresa / Comercio**. Los IDs internos de Firebase se mantienen por compatibilidad, pero el usuario primero elige el tipo de suministro y, solo en Residencial, selecciona el subsidio correspondiente: N3, N2 o sin subsidio.

- **Cargo de energía**: es la parte proporcional al consumo. Se calcula como kWh del período por el precio de energía del perfil tarifario.
- **Cargo de red por categoría**: depende del tramo de consumo del período. No aumenta kWh por kWh, sino que cambia cuando el consumo pasa de una categoría a otra.
- **Subsidio residencial**: reduce una parte del cargo de energía hasta un límite de kWh definido para N2 o N3. El consumo que supera ese límite se estima sin descuento. En Empresa / Comercio no aplica subsidio residencial.
- **Impuestos y tasas**: se muestran separados por tipo de usuario. Algunos porcentajes de referencia, como IVA o percepción de ingresos brutos para comercio, pueden estimarse; otros conceptos quedan configurables si no hay datos oficiales en la referencia.
- **Cargos no modelados**: recargos punitorios, deudas anteriores, ajustes especiales, tasas municipales o cargos regulados pueden aparecer en la factura sin depender directamente de la medición instantánea del auditor. Cuando falta un dato exacto, la app muestra "Configurable" o "No disponible en factura de referencia" en lugar de inventar valores.

La estimación es orientativa y ayuda a entender qué conceptos componen la factura. No reemplaza la liquidación oficial de la distribuidora.

## Cómo activar GitHub Pages

1. Subir estos archivos a la rama principal del repositorio.
2. Entrar a **Settings** → **Pages** en GitHub.
3. En **Build and deployment**, seleccionar **Deploy from a branch**.
4. Elegir la rama principal y la carpeta raíz `/`.
5. Guardar la configuración y esperar a que GitHub publique la URL del sitio.

## Instalación como app en celular

- **Android/Chrome**: abrir la web → menú → **Instalar app** o **Agregar a pantalla principal**.
- **iPhone/Safari**: compartir → **Agregar a pantalla de inicio**.
- El ícono instalado usa `manifest.webmanifest` y `apple-touch-icon`.

## Actualizaciones de la app instalada

La app usa `service-worker.js` para mantener una copia local de los archivos principales y permitir que la PWA instalada cargue incluso si la red falla momentáneamente. El service worker usa una estrategia **network-first**: intenta obtener primero `index.html`, `app.js`, `styles.css`, `manifest.webmanifest`, los íconos y la navegación desde GitHub Pages, y solo usa caché como respaldo.

El front también consulta `version.json` con `fetch(..., { cache: "no-store" })` y busca actualizaciones automáticamente al cargar y luego cada 5 minutos. Para evitar banners persistentes en la pantalla principal, las actualizaciones se gestionan desde el botón discreto **Actualizar app** en la sección **Más**.

Si el usuario ve datos o pantallas viejas en la app instalada, puede entrar a la sección **Más** y tocar **Actualizar app**. En casos extremos, borrar el acceso instalado del celular y volver a agregarlo desde el navegador.

## Limitaciones actuales

- Los datos dependen de que Firebase Realtime Database permita lectura pública de los nodos utilizados.
- El perfil tarifario visual se guarda en `localStorage` y no escribe cambios en Firebase.
- El cálculo económico es aproximado y no reemplaza la liquidación oficial de la distribuidora.
- No hay autenticación ni reglas de seguridad endurecidas para un entorno productivo.
- No incluye gráficas históricas ni persistencia local avanzada.

## Próximas etapas

- Escribir el perfil activo en Firebase.
- Integrar ESP32 para enviar mediciones reales.
- Agregar gráficas históricas.
- Agregar autenticación.
- Endurecer reglas de seguridad.
