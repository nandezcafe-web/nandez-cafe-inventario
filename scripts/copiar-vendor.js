import fs from 'node:fs';
import path from 'node:path';

// En línea, Vercel sirve public/ tal cual, sin pasar por Express: Leaflet (el
// mapa) tiene que estar ahí adentro. En el computador lo sirve Express desde
// node_modules y esto no hace falta. Se corre con `npm run build`.
const raiz = path.resolve(import.meta.dirname, '..');
const origen = path.join(raiz, 'node_modules', 'leaflet', 'dist');
const destino = path.join(raiz, 'public', 'vendor', 'leaflet');

fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(origen, destino, { recursive: true });
console.log(`Leaflet copiado a ${path.relative(raiz, destino)}`);
