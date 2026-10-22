// Utilidades geográficas para lotes dibujados como polígonos GeoJSON.

const R = 6_371_008.8; // radio medio de la Tierra (m)

// Anillos exteriores de un Polygon o MultiPolygon GeoJSON (acepta Feature).
function anillosExteriores(geo) {
  const g = geo?.type === 'Feature' ? geo.geometry : geo;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}

// Área de un anillo [lon, lat] con fórmula esférica (suficiente para lotes de finca).
function areaAnilloM2(anillo) {
  if (!anillo || anillo.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < anillo.length; i++) {
    const [lon1, lat1] = anillo[i];
    const [lon2, lat2] = anillo[(i + 1) % anillo.length];
    total += ((lon2 - lon1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs((total * R * R) / 2);
}

export function areaHectareas(geo) {
  const m2 = anillosExteriores(geo).reduce((s, a) => s + areaAnilloM2(a), 0);
  return m2 ? Math.round((m2 / 10_000) * 100) / 100 : null;
}

export function centroide(geo) {
  const puntos = anillosExteriores(geo).flat();
  if (!puntos.length) return null;
  const [slon, slat] = puntos.reduce(([a, b], [lon, lat]) => [a + lon, b + lat], [0, 0]);
  return { latitud: Math.round((slat / puntos.length) * 1e6) / 1e6, longitud: Math.round((slon / puntos.length) * 1e6) / 1e6 };
}

// Valida que sea un Polygon/MultiPolygon con coordenadas numéricas plausibles.
export function geometriaValida(geo) {
  const anillos = anillosExteriores(geo);
  return anillos.length > 0 && anillos.every((a) => Array.isArray(a) && a.length >= 4
    && a.every((p) => Array.isArray(p) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90));
}
