import { Router } from 'express';
import { ErrorHttp, noEncontrado } from './errores.js';
import { validarRegistro, aSalida } from './validar.js';
import { derivados, calculados } from './derivados.js';

const LIMITE_DEFECTO = 200;
const LIMITE_MAX = 5000;

// SQLite y Postgres dicen lo mismo con palabras distintas ("FOREIGN KEY
// constraint failed" / "violates foreign key constraint"), por eso se compara
// sin mayúsculas.
export function traducirErrorSql(e) {
  const msg = String(e?.message ?? '').toLowerCase();
  if (msg.includes('foreign key')) {
    return new ErrorHttp(409, 'Referencia inválida o registro en uso por otros datos (no se puede borrar mientras tenga registros asociados)');
  }
  if (msg.includes('unique')) return new ErrorHttp(409, 'Ya existe un registro con esos mismos datos');
  return e;
}

export async function leerUno(db, tabla, rec, id) {
  const fila = await db.uno(`SELECT * FROM "${tabla}" WHERE id = ?`, [id]);
  if (!fila) return null;
  const salida = aSalida(rec, { ...fila });
  return derivados[tabla] ? derivados[tabla](salida) : salida;
}

// Construye WHERE a partir de la query: ?campo=valor, ?desde=&hasta= y ?q=
export function filtrosDesdeQuery(rec, query) {
  const where = [];
  const params = [];
  for (const [campo, def] of Object.entries(rec.campos)) {
    if (query[campo] === undefined || def.tipo === 'json') continue;
    where.push(`"${campo}" = ?`);
    params.push(['entero', 'ref', 'real'].includes(def.tipo) ? Number(query[campo]) : String(query[campo]));
  }
  if (rec.campoFecha) {
    if (query.desde) {
      where.push(`"${rec.campoFecha}" >= ?`);
      params.push(String(query.desde));
    }
    if (query.hasta) {
      // "hasta" incluye el día completo también para fecha y hora
      where.push(`substr("${rec.campoFecha}", 1, 10) <= ?`);
      params.push(String(query.hasta).slice(0, 10));
    }
  }
  if (query.q) {
    const textos = Object.entries(rec.campos).filter(([, d]) => d.tipo === 'texto').map(([n]) => n);
    if (textos.length) {
      where.push(`(${textos.map((n) => `"${n}" LIKE ?`).join(' OR ')})`);
      params.push(...textos.map(() => `%${query.q}%`));
    }
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function crearRouterCrud(db, tabla, rec) {
  const r = Router();
  const salida = (fila) => {
    const s = aSalida(rec, fila);
    return derivados[tabla] ? derivados[tabla](s) : s;
  };

  r.get('/', async (req, res) => {
    const { sql, params } = filtrosDesdeQuery(rec, req.query);
    const columnasOrden = new Set(['id', 'creado_en', 'actualizado_en', ...Object.keys(rec.campos)]);
    const orden = columnasOrden.has(req.query.orden) ? req.query.orden : (rec.campoFecha ?? 'id');
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const limite = Math.min(Math.max(Number(req.query.limite) || LIMITE_DEFECTO, 1), LIMITE_MAX);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const total = Number((await db.uno(`SELECT COUNT(*) AS n FROM "${tabla}" ${sql}`, params)).n);
    const filas = await db.todos(
      `SELECT * FROM "${tabla}" ${sql} ORDER BY "${orden}" ${dir}, id DESC LIMIT ? OFFSET ?`,
      [...params, limite, offset],
    );

    res.json({ datos: filas.map((f) => salida({ ...f })), total, limite, offset });
  });

  r.get('/:id', async (req, res) => {
    const fila = await leerUno(db, tabla, rec, Number(req.params.id));
    if (!fila) throw noEncontrado();
    res.json(fila);
  });

  if (rec.soloLectura) return r;

  // Campos que pone el servidor, no el cliente: se asignan después de validar
  // para que nadie los mande en el cuerpo, y no se tocan al actualizar.
  const automaticos = Object.entries(rec.campos).filter(([, d]) => d.auto).map(([n]) => n);

  r.post('/', async (req, res) => {
    const datos = validarRegistro(rec, req.body);
    for (const n of automaticos) delete datos[n];
    if (rec.campos.registrado_por && req.usuario) datos.registrado_por = req.usuario;
    calculados[tabla]?.(datos);
    const cols = Object.keys(datos);
    let creado;
    try {
      creado = cols.length
        ? await db.uno(
          `INSERT INTO "${tabla}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING id`,
          cols.map((c) => datos[c]),
        )
        : await db.uno(`INSERT INTO "${tabla}" DEFAULT VALUES RETURNING id`);
    } catch (e) {
      throw traducirErrorSql(e);
    }
    res.status(201).json(await leerUno(db, tabla, rec, Number(creado.id)));
  });

  const actualizar = (parcial) => async (req, res) => {
    const id = Number(req.params.id);
    const actual = await leerUno(db, tabla, rec, id);
    if (!actual) throw noEncontrado();
    const datos = validarRegistro(rec, req.body, { parcial });
    // En PUT, los campos omitidos quedan vacíos (reemplazo completo).
    if (!parcial) {
      for (const c of Object.keys(rec.campos)) if (!Object.hasOwn(datos, c)) datos[c] = null;
    }
    // Quién registró no se reescribe: ni al editar ni con un PUT completo.
    for (const n of automaticos) delete datos[n];
    // Los calculados se recalculan sobre el registro completo, no solo sobre
    // lo que llegó en un PATCH.
    if (calculados[tabla]) {
      const completo = { ...actual, ...datos };
      if (!Object.hasOwn(req.body ?? {}, 'total_cop')) completo.total_cop = null;
      calculados[tabla](completo);
      for (const [k, v] of Object.entries(completo)) {
        if (Object.hasOwn(rec.campos, k) && v !== actual[k]) datos[k] = v;
      }
    }
    const cols = Object.keys(datos);
    if (cols.length) {
      try {
        // La hora se pone aquí y no con strftime(), que solo existe en SQLite.
        await db.ejecutar(
          `UPDATE "${tabla}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')}, actualizado_en = ? WHERE id = ?`,
          [...cols.map((c) => datos[c]), new Date().toISOString(), id],
        );
      } catch (e) {
        throw traducirErrorSql(e);
      }
    }
    res.json(await leerUno(db, tabla, rec, id));
  };

  r.put('/:id', actualizar(false));
  r.patch('/:id', actualizar(true));

  r.delete('/:id', async (req, res) => {
    let info;
    try {
      info = await db.ejecutar(`DELETE FROM "${tabla}" WHERE id = ?`, [Number(req.params.id)]);
    } catch (e) {
      throw traducirErrorSql(e);
    }
    if (!info.cambios) throw noEncontrado();
    res.status(204).end();
  });

  return r;
}
