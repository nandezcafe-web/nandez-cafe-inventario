import fs from 'node:fs';
import path from 'node:path';
import { ErrorHttp } from './errores.js';

// Dónde se guardan las fotos y los documentos adjuntos.
//
//   - En el computador: la carpeta data/uploads.
//   - En línea (Vercel): Supabase Storage. Vercel no tiene disco propio: lo que
//     se escribe en /tmp desaparece con la función, así que guardar ahí sería
//     aceptar la foto y perderla sin aviso.
//   - En línea sin Storage configurado: la subida se rechaza con un mensaje
//     claro, en vez de aceptarla y perderla.
//
// Todos tienen la misma forma: guardar(nombre, datos, mime), leer(nombre),
// borrar(nombre). Los nombres los genera el servidor; aquí además se limpian
// con basename para que nadie pueda pedir "../../.env".
export function crearAlmacen(config) {
  if (config.storage) return almacenSupabase(config.storage);
  if (config.enLinea) return almacenNoDisponible();
  return almacenLocal(config.uploadsDir);
}

function almacenLocal(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ruta = (nombre) => path.join(dir, path.basename(nombre));
  return {
    disponible: true,
    async guardar(nombre, datos) {
      await fs.promises.writeFile(ruta(nombre), datos);
    },
    async leer(nombre) {
      try {
        return await fs.promises.readFile(ruta(nombre));
      } catch {
        return null;
      }
    },
    async borrar(nombre) {
      await fs.promises.rm(ruta(nombre), { force: true });
    },
  };
}

function almacenSupabase({ url, clave, bucket }) {
  const base = `${url.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}`;
  const auth = { Authorization: `Bearer ${clave}`, apikey: clave };
  const objeto = (nombre) => `${base}/${encodeURIComponent(path.basename(nombre))}`;

  return {
    disponible: true,
    async guardar(nombre, datos, mime) {
      const r = await fetch(objeto(nombre), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' },
        body: datos,
      });
      if (!r.ok) throw new ErrorHttp(502, `No se pudo guardar el archivo en Supabase Storage (${r.status})`);
    },
    async leer(nombre) {
      const r = await fetch(objeto(nombre), { headers: auth });
      // Storage responde 400 con "Object not found" para lo que no existe.
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new ErrorHttp(502, `No se pudo leer el archivo de Supabase Storage (${r.status})`);
      return Buffer.from(await r.arrayBuffer());
    },
    async borrar(nombre) {
      await fetch(base, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path.basename(nombre)] }),
      });
    },
  };
}

function almacenNoDisponible() {
  const motivo = 'En línea, las fotos y documentos necesitan Supabase Storage, que no está configurado '
    + '(SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY). Ver DESPLIEGUE.md.';
  const rechazar = () => { throw new ErrorHttp(503, motivo); };
  return { disponible: false, motivo, guardar: rechazar, leer: async () => null, borrar: async () => {} };
}
