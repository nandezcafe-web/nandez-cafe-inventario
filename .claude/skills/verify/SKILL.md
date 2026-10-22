---
name: verify
description: Cómo levantar Nández Café y conducir el panel para verificar un cambio con evidencia de ejecución real.
---

# Verificar Nández Café

Superficie: **GUI** (el panel web). La API es la superficie secundaria y se
conduce con `curl`. No hay repositorio git en esta carpeta: el alcance es lo que
el usuario nombre o los archivos que se hayan tocado.

## Levantar

```bash
npm install          # solo la primera vez
npm start            # usa .env si existe; puerto 3000
```

`.claude/launch.json` tiene la configuración `cafe-servidor` para el panel del
navegador integrado (`preview_start`).

### Instancia de verificación, sin tocar los datos reales

La base real es `data/cafe.db`. Para conducir sin escribir en ella, o para
saltarse la clave de acceso que está en `.env`:

```bash
# Misma base, sin clave y sin sincronizar clima (solo para leer y navegar)
PORT=3100 API_TOKEN= CLIMA_AUTO_HORAS=0 node src/server.js
```

```bash
# Base desechable: para probar flujos que escriben (procesos, ventas, gastos)
PORT=3100 DB_PATH=/tmp/prueba.db UPLOADS_DIR=/tmp/subidas CLIMA_AUTO_HORAS=0 node src/server.js
```

Para probar el flujo de la clave de acceso sin usar la real, levantar una
instancia con una clave desechable:

```bash
PORT=3101 API_TOKEN=clave-de-prueba-123 CLIMA_AUTO_HORAS=0 node src/server.js
```

**No usar `npm start` para estas instancias:** `--env-file-if-exists=.env`
sobrescribe las variables del shell con las del `.env`. Llamar a `node
src/server.js` directo.

## Conducir

El panel es una sola página con rutas por hash. Se puede llegar directo a
cualquier sección: `#/resumen` (inicio, café comprado), `#/cultivo` (resumen de
la finca), `#/registrar`, `#/costos`, `#/precios`, `#/pyg`, `#/inventario`,
`#/tengo`, `#/plan`, `#/prediccion`, `#/mapa`, y una por cada recurso
(`#/ventas`, `#/gastos`, `#/lotes_cafe`, …).

**El inicio y el cultivo están separados a propósito:** `#/resumen` solo muestra
alertas con `grupo: "cafe"` y `#/cultivo` las de `grupo: "cultivo"`. Al cambiar
algo de alertas, revisar que ninguna quede sin grupo y por tanto invisible.

Lo más rápido es manejarlo con JavaScript en la página en vez de clics:

```js
location.hash = '#/costos';
await new Promise((r) => setTimeout(r, 700));   // las vistas cargan con fetch
document.querySelector('#vista h1').innerText;
```

Puntos que conviene revisar en cualquier cambio de navegación o de panel:

- **Los dos niveles del menú:** `#nav` (áreas) y `#subnav` (secciones del área).
  El área activa lleva `aria-current="true"`, la sección `aria-current="page"`.
- **Memoria del área:** entrar a una sección, cambiar de área y volver — debe
  regresar a donde estaba (`ultimaSeccion` en `public/app.js`).
- **Direcciones fuera del mapa** (`#/adjuntos`, `#/noexiste`): ninguna área debe
  quedar marcada y el botón **Hoy** debe seguir apuntando a `#/resumen`.
- **Ancho de celular:** emular 320 y 375 px. `#nav` no debe desbordarse
  (`nav.scrollWidth > nav.getBoundingClientRect().width`) y la página no debe
  tener desplazamiento horizontal.
- **Objetivos de toque:** 44 px en las áreas, 40 px en las secciones.
- **Modo oscuro:** emularlo; todo el color sale de variables en `:root`.

## Trampas conocidas

- **Reiniciar el servidor después de editar `src/`.** Node cachea los módulos:
  un cambio en `src/resources.js` (p. ej. las `columnas` de una lista) no aparece
  en `/api/esquema` hasta reiniciar el proceso. Si el panel ignora un cambio del
  modelo, es esto antes que un error de código.
- **Campos dentro de un `<details>` cerrado miden alto > 0** en Chrome, así que
  `getBoundingClientRect().height > 0` los cuenta como visibles. Para contar lo
  que de verdad se ve, usar `e.checkVisibility()` o
  `!e.closest('details') || e.closest('details').open`.
- **Medir densidad con datos, no con la base vacía.** `#/precios` pasa de 1,4 a
  5,3 pantallas según cuántas presentaciones tenga el lote; con la base vacía
  parece simple y no lo es. Hay un sembrador de escenario realista en el
  historial de esta skill: tres lotes en distinto avance, cuatro presentaciones
  con precio, ocho ventas por varios canales y gastos del periodo.
- **`/api/resumen` es la consulta más pesada** (recalcula la cadena de costos de
  todos los lotes). Contar las llamadas por carga con
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/'))`;
  debe ser **una** en el inicio.
- **Caché del módulo.** `app.js` se sirve estático sin versión en la URL.
  Después de editarlo, navegar a la misma dirección puede seguir ejecutando el
  módulo viejo. Forzar con `?cb=<timestamp>`: `http://localhost:3100/?cb=1#/costos`.
  Comprobar lo que sirve el servidor con
  `await (await fetch('/app.js?v=' + Date.now())).text()`.
- **La clave de acceso.** Si `.env` define `API_TOKEN`, el panel muestra la
  pantalla **Clave de acceso** antes de cualquier dato. El enlace
  `…/?token=<clave>` entra directo y la clave se borra de la dirección.
- **No imprimir la clave real** en comandos ni en informes: está en `.env`.
  Para probar, usar una instancia con clave desechable.
- **Escribir en la base real.** Conducir formularios que guardan (Registrar
  proceso, ventas, gastos) deja registros. Usar `DB_PATH` desechable, o borrar
  lo que se cree.
- **Procesos huérfanos en Windows.** Arrancar con `&` deja el proceso vivo
  después del comando. Cerrarlo por puerto:
  `Get-NetTCPConnection -LocalPort 3100 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`

## Datos para conducir

Si la base está vacía, un lote da material para todas las vistas de café:

```bash
curl -s -X POST http://localhost:3100/api/lotes_cafe -H 'Content-Type: application/json' \
  -d '{"codigo":"PRUEBA-01","fecha":"2026-10-21","origen":"compra","estado_inicial":"pergamino_seco","kg_inicial":51,"precio_cop_kg":22000}'
```

Después, en `#/registrar` se encadenan trilla y tueste, y con eso quedan con
contenido Inventario, Costos, Precios y Resultados.
