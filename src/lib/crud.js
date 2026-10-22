import { Router } from 'express';
import { ErrorHttp, noEncontrado } from './errores.js';
import { validarRegistro, aSalida } from './validar.js';
import { derivados } from './derivados.js';

const LIMITE_DEFECTO = 200;
const LIMITE_MAX = 5000;

export function traducirErrorSql(e) {
  const msg = String(e?.message ?? '');
  if (msg.includes('FOREIGN KEY')) {
    return new ErrorHttp(409, 'Referencia inválida o registro en uso por otros datos (no se puede borrar mientras tenga registros asociados)');
  }
  if (msg.includes('UNIQUE')) return new ErrorHttp(409, 'Ya existe un registro con esos mismos datos');
  return e;
}

export function leerUno(db, tabla, rec, id) {
  const fila = db.prepare(`SELECT * FROM "${tabla}" WHERE id = ?`).get(id);
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

  r.get('/', (req, res) => {
    const { sql, params } = filtrosDesdeQuery(rec, req.query);
    const columnasOrden = new Set(['id', 'creado_en', 'actualizado_en', ...Object.keys(rec.campos)]);
    const orden = columnasOrden.has(req.query.orden) ? req.query.orden : (rec.campoFecha ?? 'id');
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const limite = Math.min(Math.max(Number(req.query.limite) || LIMITE_DEFECTO, 1), LIMITE_MAX);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const total = db.prepare(`SELECT COUNT(*) AS n FROM "${tabla}" ${sql}`).get(...params).n;
    const filas = db
      .prepare(`SELECT * FROM "${tabla}" ${sql} ORDER BY "${orden}" ${dir}, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limite, offset);

    res.json({ datos: filas.map((f) => salida({ ...f })), total, limite, offset });
  });

  r.get('/:id', (req, res) => {
    const fila = leerUno(db, tabla, rec, Number(req.params.id));
    if (!fila) throw noEncontrado();
    res.json(fila);
  });

  if (rec.soloLectura) return r;

  r.post('/', (req, res) => {
    const datos = validarRegistro(rec, req.body);
    const cols = Object.keys(datos);
    try {
      const info = cols.length
        ? db
          .prepare(`INSERT INTO "${tabla}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((c) => datos[c]))
        : db.prepare(`INSERT INTO "${tabla}" DEFAULT VALUES`).run();
      res.status(201).json(leerUno(db, tabla, rec, Number(info.lastInsertRowid)));
    } catch (e) {
      throw traducirErrorSql(e);
    }
  });

  const actualizar = (parcial) => (req, res) => {
    const id = Number(req.params.id);
    if (!leerUno(db, tabla, rec, id)) throw noEncontrado();
    const datos = validarRegistro(rec, req.body, { parcial });
    // En PUT, los campos omitidos quedan vacíos (reemplazo completo).
    if (!parcial) {
      for (const c of Object.keys(rec.campos)) if (!Object.hasOwn(datos, c)) datos[c] = null;
    }
    const cols = Object.keys(datos);
    if (cols.length) {
      try {
        db.prepare(
          `UPDATE "${tabla}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')},
           actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        ).run(...cols.map((c) => datos[c]), id);
      } catch (e) {
        throw traducirErrorSql(e);
      }
    }
    res.json(leerUno(db, tabla, rec, id));
  };

  r.put('/:id', actualizar(false));
  r.patch('/:id', actualizar(true));

  r.delete('/:id', (req, res) => {
    try {
      const info = db.prepare(`DELETE FROM "${tabla}" WHERE id = ?`).run(Number(req.params.id));
      if (!info.changes) throw noEncontrado();
    } catch (e) {
      throw traducirErrorSql(e);
    }
    res.status(204).end();
  });

  return r;
}
