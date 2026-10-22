# Poner Nández Café en línea (Vercel + Supabase)

Objetivo: que Maick, Edwin y Camila puedan registrar y consultar desde el
celular, desde cualquier parte, sin depender de que el computador de la casa
esté prendido. Sin costo mensual: Vercel y Supabase en sus planes gratis.

- **Vercel** sirve el panel y corre el servidor como funciones.
- **Supabase** guarda la base de datos (Postgres).

El código ya está preparado para las dos cosas. Lo que sigue es lo que le toca
a usted en el navegador, en este orden.

---

## 1. Crear la base en Supabase

1. En <https://supabase.com>, **New project**, en la misma organización de la
   página web.
2. Nombre: `nandez-cafe-inventario`.
3. **Región: East US (North Virginia).** Es donde Vercel corre sus funciones;
   si la base queda lejos, cada consulta cruza el continente.
4. Ponga una contraseña larga para la base y **guárdela**.
5. Cuando termine de crearse: botón **Connect** (arriba) → **Transaction
   pooler**. Copie esa cadena: empieza con `postgresql://` y usa el puerto
   **6543**. Es la que sirve para funciones que nacen y mueren con cada
   petición.
6. En el archivo `.env` del computador, agregue una línea:

   ```
   DATABASE_URL=postgresql://postgres.xxxx:SU_CONTRASEÑA@aws-0-us-east-1.pooler.supabase.com:6543/postgres
   ```

   reemplazando `[YOUR-PASSWORD]` por la contraseña del paso 4. Ese archivo no
   se sube a GitHub.

## 2. Pasar lo que ya está registrado

Lo registrado en el computador pasa a Supabase con un script. Primero, sin
cambiar nada, para ver qué hay de cada lado:

```bash
node --env-file=.env scripts/pasar-a-supabase.js
```

Si todo se ve bien, lo mismo con `--reemplazar` para copiar:

```bash
node --env-file=.env scripts/pasar-a-supabase.js --reemplazar
```

El script tiene barandas: copia todo en una sola transacción (o pasa completo o
no pasa nada), conserva los ids, y al final compara tabla por tabla. **Si
Supabase ya tiene lotes, ventas, gastos o cualquier registro hecho por alguien,
se niega**: lo único que acepta reemplazar es lo que el sistema siembra solo al
arrancar.

Desde ese momento, **registre solo en línea**. Si siguen registrando en el
computador, las dos bases se separan.

## 3. Variables en Vercel

En el proyecto de Vercel → **Settings** → **Environment Variables**, agregue
estas cuatro, para *Production* (copie los valores de su `.env`):

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la cadena de Supabase del paso 1 |
| `USUARIOS` | `Maick:…,Edwin Hernandez:…,Camila Hernandez:…` — la línea completa del `.env` |
| `CRON_SECRET` | la del `.env`; es la clave de la tarea diaria del clima |
| `API_TOKEN` | **no la ponga**. En línea conviene que cada uno entre con su clave, así ningún registro queda sin nombre |

Después: **Deployments** → el último → **⋯** → **Redeploy**. Las variables
nuevas solo se aplican en un despliegue nuevo.

## 4. Entrar desde los celulares

La dirección es la de Vercel: `https://nandez-cafe-inventario.vercel.app`.
Cada uno abre su enlace con su clave:

```
https://nandez-cafe-inventario.vercel.app/?token=SU_CLAVE
```

Entra directo, la clave queda guardada en ese celular y se borra de la
dirección. Mande a cada uno **solo su enlace**: si se pasan el archivo
completo, cada uno queda con las claves de los otros.

---

## Fotos y documentos (opcional)

Vercel no tiene disco propio: lo que se escribe ahí desaparece. Por eso, en
línea, las fotos van a **Supabase Storage**. Mientras no esté configurado, el
panel **rechaza la foto con un aviso** en vez de aceptarla y perderla.

Para activarlo:

1. En Supabase → **Storage** → **New bucket** → nombre `adjuntos`, **privado**.
2. En Supabase → **Project Settings** → **API**: copie la **Project URL** y la
   clave **service_role** (la secreta, no la `anon`).
3. En Vercel, dos variables más: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
   Redeploy.

La clave `service_role` salta todas las restricciones de Supabase: va solo en
Vercel, nunca en el panel ni en un mensaje.

En línea, el tope es **4 MB por foto**: Vercel corta a los 4,5 MB antes de que
la petición llegue al sistema.

---

## Lo que hay que saber de los planes gratis

- **Supabase gratis no hace copias de seguridad.** En el inicio del panel, en
  *Qué hay registrado*, está **⬇ Descargar respaldo**: baja toda la base en un
  archivo `.sqlite`. Hágalo cada semana y después de un día de mucho registro.
  Ese archivo además sirve para volver a levantar el sistema en el computador.
- **Supabase gratis pausa el proyecto tras una semana sin uso.** Con tres
  personas registrando no pasa; en temporada baja, se reactiva desde el panel
  de Supabase.
- **Vercel gratis (Hobby) solo permite tareas programadas una vez al día.** El
  clima se sincroniza cada mañana a las 6 a. m. hora de Colombia, no cada 3
  horas como en el computador.
- **Vercel gratis es para uso no comercial.** Esta app no cobra a visitantes ni
  muestra publicidad, es una herramienta interna; aun así, es zona gris.

## Si algo sale mal

- **El panel carga pero dice "Falta configurar DATABASE_URL en Vercel":** falta
  la variable, o se agregó sin hacer Redeploy.
- **"El servidor no pudo conectarse a la base de datos":** revise la cadena:
  puerto 6543, la contraseña puesta en lugar de `[YOUR-PASSWORD]`, y que el
  proyecto de Supabase no esté pausado. El detalle está en Vercel →
  **Logs**.
- **"Token inválido o ausente":** la clave está mal copiada, o se puso la de
  otra persona. Ver `USUARIOS` en Vercel.
- **El panel no muestra el café que registró en el computador:** falta el paso
  2.
- **Cambió algo en el código:** con `git push`, Vercel vuelve a desplegar solo.
