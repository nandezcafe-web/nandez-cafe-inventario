import { invalido } from './errores.js';
import { geometriaValida } from './geo.js';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(s) {
  if (!RE_FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

// Convierte y valida un valor según la definición del campo.
// Devuelve { valor } o { error }.
function convertir(def, valor) {
  if (valor === '' || valor === null || valor === undefined) return { valor: null };

  switch (def.tipo) {
    case 'texto':
      return { valor: String(valor).trim() };

    case 'entero':
    case 'ref': {
      const n = Number(valor);
      if (!Number.isInteger(n)) return { error: 'debe ser un número entero' };
      return rango(def, n);
    }

    case 'real': {
      const n = typeof valor === 'string' ? Number(valor.replace(',', '.')) : Number(valor);
      if (!Number.isFinite(n)) return { error: 'debe ser un número' };
      return rango(def, n);
    }

    case 'fecha': {
      const s = String(valor).slice(0, 10);
      return fechaValida(s) ? { valor: s } : { error: 'fecha inválida (AAAA-MM-DD)' };
    }

    case 'fechahora': {
      const s = String(valor);
      if (RE_FECHA.test(s)) return fechaValida(s) ? { valor: `${s}T00:00` } : { error: 'fecha inválida' };
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || Number.isNaN(Date.parse(s))) {
        return { error: 'fecha y hora inválida (AAAA-MM-DDTHH:MM)' };
      }
      return { valor: s };
    }

    case 'opcion': {
      const s = String(valor);
      return def.opciones.includes(s)
        ? { valor: s }
        : { error: `opción inválida; use: ${def.opciones.join(', ')}` };
    }

    case 'json': {
      let objeto = valor;
      if (typeof valor === 'string') {
        try {
          objeto = JSON.parse(valor);
        } catch {
          return { error: 'JSON inválido' };
        }
      }
      if (def.geojson && !geometriaValida(objeto)) {
        return { error: 'debe ser un polígono GeoJSON (Polygon o MultiPolygon) con al menos 3 vértices' };
      }
      return { valor: JSON.stringify(objeto) };
    }

    default:
      return { error: `tipo desconocido ${def.tipo}` };
  }
}

function rango(def, n) {
  if (def.min !== undefined && n < def.min) return { error: `debe ser ≥ ${def.min}` };
  if (def.max !== undefined && n > def.max) return { error: `debe ser ≤ ${def.max}` };
  return { valor: n };
}

// parcial=true (PATCH): solo valida los campos presentes y no exige requeridos.
export function validarRegistro(rec, cuerpo, { parcial = false } = {}) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    throw invalido({ _: 'se esperaba un objeto JSON' });
  }

  const errores = {};
  const limpio = {};

  for (const [nombre, def] of Object.entries(rec.campos)) {
    const presente = Object.hasOwn(cuerpo, nombre);
    if (!presente) {
      if (!parcial && def.defecto !== undefined) limpio[nombre] = def.defecto;
      else if (!parcial && def.requerido) errores[nombre] = 'es obligatorio';
      continue;
    }
    const { valor, error } = convertir(def, cuerpo[nombre]);
    if (error) errores[nombre] = error;
    else if (valor === null && def.requerido) errores[nombre] = 'es obligatorio';
    else limpio[nombre] = valor;
  }

  const desconocidos = Object.keys(cuerpo).filter(
    (k) => !Object.hasOwn(rec.campos, k) && !['id', 'creado_en', 'actualizado_en'].includes(k),
  );
  for (const k of desconocidos) errores[k] = 'campo desconocido';

  if (Object.keys(errores).length) throw invalido(errores);
  return limpio;
}

// Deserializa campos JSON al leer de la base de datos.
export function aSalida(rec, fila) {
  if (!fila) return fila;
  const out = { ...fila };
  for (const [n, d] of Object.entries(rec.campos)) {
    if (d.tipo === 'json' && typeof out[n] === 'string') {
      try {
        out[n] = JSON.parse(out[n]);
      } catch {
        /* se deja como texto */
      }
    }
  }
  return out;
}
