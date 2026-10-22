# Poner Nández Café en línea (Render)

Objetivo: que usted y su hermano puedan registrar y consultar desde el celular,
desde cualquier parte, sin depender de que el computador de la casa esté
prendido.

Costo: **US$7/mes** del servicio + **US$0,25/mes** del disco de 1 GB ≈ **29.000
pesos al mes**.

La configuración ya está lista en [render.yaml](render.yaml). Lo que sigue es lo
que le toca a usted en el navegador.

---

## 1. Subir el proyecto a GitHub

El repositorio local ya está hecho, con el primer commit. Falta crear el
repositorio remoto y empujarlo.

1. Entre a <https://github.com/new>.
2. Nombre: `nandez-cafe`. **Privado** (es su contabilidad).
3. **No** marque "Add a README", "Add .gitignore" ni licencia: el proyecto ya
   los trae y chocarían.
4. Cree el repositorio y copie la URL que le muestra.

Después, en la terminal del proyecto:

```bash
git remote add origin https://github.com/USUARIO/nandez-cafe.git
git branch -M main
git push -u origin main
```

Cambie `USUARIO` por su usuario de GitHub. Si le pide clave, GitHub ya no acepta
la contraseña: hay que generar un token en
<https://github.com/settings/tokens> (clásico, permiso `repo`) y pegarlo como
contraseña.

**La base de datos no se sube**, y está bien: `.gitignore` excluye `data/`.
Sus lotes y ventas se quedan en su computador. El servidor en línea crea su
propia base y la siembra igual que la primera vez: la finca de 13 ha, el Lote 1,
el Lote 2 y las 8 ideas de oportunidad. Lo que **no** llega es lo del café —
el lote comprado, el productor y las presentaciones. Más abajo está cómo
pasarlo.

## 2. Crear el servicio en Render

1. Entre a <https://render.com> y cree la cuenta (puede ser con GitHub).
2. En el panel: **New** → **Blueprint**.
3. Conecte su cuenta de GitHub y autorice el repositorio `nandez-cafe`.
4. Render lee `render.yaml` solo y le muestra un servicio llamado
   **nandez-cafe** con el disco de 1 GB. Confirme.
5. Le pedirá la tarjeta, porque el plan Starter es de pago.
6. **Apply** y espere. El primer despliegue toma unos minutos: instala las
   dependencias y arranca el servidor.

Cuando termine, Render le da una dirección del estilo
`https://nandez-cafe.onrender.com`. Esa es la que se comparte.

## 3. Copiar la clave de acceso

Render generó una clave sola. Para verla:

1. Entre al servicio **nandez-cafe**.
2. Pestaña **Environment**.
3. Busque `API_TOKEN` y cópiela.

Es **distinta** de la que usa en su computador, y así debe ser: si alguna vez
hay que cambiar la de internet, la local no se toca.

### Y las claves de cada uno

En la misma pestaña **Environment** hay una variable `USUARIOS`, vacía. Ahí va
una clave por persona, para que cada registro quede con nombre:

```
Maick:CLAVE_SUYA,Hermano:CLAVE_DE_EL
```

Sin espacios alrededor de la coma, y cambie `Hermano` por el nombre real: ese es
el nombre que va a quedar en los registros. Las claves las puede sacar del
archivo `.env` de su computador, donde ya hay dos generadas, o inventar otras
largas. Guarde y Render reinicia el servicio solo.

Cada uno entra con **su** clave, no con la compartida. Cuando confirme que los
dos entran bien, **borre `API_TOKEN`** del panel: así ningún registro queda sin
nombre.

## 4. Entrar desde los celulares

1. Abra `https://nandez-cafe.onrender.com` en el celular.
2. El panel muestra la pantalla **Clave de acceso**.
3. Pegue la clave y toque **Entrar**. Queda guardada en ese celular; no la vuelve
   a pedir.

Lo mismo en el celular de su hermano. La misma clave sirve para los dos.

## 5. Pasar lo que ya tiene registrado

El servidor en línea arranca con la finca y sus dos lotes ya sembrados, pero sin
nada del café que usted compra. Hoy eso es poco: un lote, cuatro presentaciones
y un productor. Lo más sencillo es volver a registrarlo a mano desde el panel en
línea, son unos minutos:

- **Finca → Productores:** Productor Uno, Chinácota.
- **Café → Lotes:** DT-2026-01, 2026-10-21, compra, castillo, pergamino seco,
  51 kg, $22.000/kg (valor total $1.122.000).
- **Café → Presentaciones:** las cuatro bolsas, con su costo de empaque y precio
  cuando los tenga.

De ahí en adelante registre siempre en el de internet, para no terminar con dos
contabilidades distintas. Cuando confirme que todo está en línea, deje de usar
el local.

---

## Lo que falta decidir

**Respaldos: bájelos usted.** El disco de Render guarda el archivo entre
despliegues, pero el plan Starter no le hace copias. En el inicio del panel, en
la tarjeta **Qué hay registrado**, hay un enlace **⬇ Descargar respaldo**: le
entrega toda la base en un archivo `.sqlite` consistente, listo para guardar en
el computador o en la nube. Hágalo al menos una vez por semana, y siempre
después de un día de mucho registro.

Para volver de un respaldo: pare el servicio en Render, suba el archivo al disco
como `/data/cafe.db` (pestaña **Shell** del servicio) y vuelva a arrancarlo.
Todavía no hay un botón para restaurar; se hace a mano y conviene practicarlo
una vez antes de necesitarlo.

Lo que falta para no depender de acordarse: una tarea programada que baje la
copia sola. Pendiente.

**Una clave por persona: ya está.** Cada lote, proceso, venta y gasto queda
marcado con el nombre de quien lo registró, según la clave con la que entró. Se
ve en las listas de Procesos y de Ventas, en la columna *Registrado por*. No se
puede cambiar después ni escribir a mano. Falta configurarlo en Render (arriba).

## Si algo sale mal

- **El despliegue falla en `npm ci`:** revise que `package-lock.json` esté
  subido (sí lo está) y que Render use Node 24 (`NODE_VERSION` ya lo fija).
- **Responde "Token inválido o ausente":** la clave está mal copiada. Vuelva a
  copiarla de Environment, completa y sin espacios.
- **El panel carga pero sin su café:** normal al principio. El servidor en línea
  tiene su propia base, sembrada con la finca y los dos lotes, pero sin el lote
  comprado ni las presentaciones: hay que registrarlos allá (paso 5).
- **Cambió algo en el código:** con `git push` Render vuelve a desplegar solo.
- **Ver qué pasó:** pestaña **Logs** del servicio en Render.
