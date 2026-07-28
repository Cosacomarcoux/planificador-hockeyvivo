#!/usr/bin/env node
/**
 * import_biblioteca.js — Baja el dataset free-exercise-db (dominio público),
 * filtra SOLO los ejercicios funcionales que sirven para el gimnasio de hockey,
 * mapea nivel (beginner/intermediate/expert → Iniciado/Intermedio/Avanzado) y
 * grupo muscular (Core/Upper/Lower/Full Body), TRADUCE nombre e instrucciones
 * al español con la API de Claude, y escribe public/biblioteca.json.
 *
 * Correr donde haya internet (tu compu o el server):
 *     ANTHROPIC_API_KEY=sk-... node import_biblioteca.js
 *
 * (En Windows PowerShell:  $env:ANTHROPIC_API_KEY="sk-..."; node import_biblioteca.js)
 *
 * Si NO pasás la API key, igual funciona: baja y filtra en inglés, y las
 * etiquetas (equipo/categoría) quedan traducidas por diccionario. Después podés
 * correrlo de nuevo con la key para traducir todo.
 *
 * No pisa tu banco de hockey: solo genera la "biblioteca" de genéricos aparte.
 * Fuente: https://github.com/yuhonas/free-exercise-db (Unlicense, dominio público)
 */
const fs = require('fs');
const path = require('path');

const FUENTE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const RAW_IMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const SALIDA = path.join(__dirname, 'public', 'biblioteca.json');
const MODELO = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// La API key puede venir de: (1) argumento en la línea de comando (lo más fácil),
// (2) variable de entorno ANTHROPIC_API_KEY, (3) archivo .env con ANTHROPIC_API_KEY=...
function resolverApiKey() {
  const arg = process.argv.find(a => a.startsWith('sk-'));
  if (arg) return arg.trim();
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    const m = env.match(/ANTHROPIC_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
    if (m) return m[1].trim();
  } catch {}
  return null;
}
const API_KEY = resolverApiKey();

const EQUIP_OK = new Set(['body only', 'kettlebells', 'bands', 'medicine ball', 'exercise ball', 'foam roll', 'dumbbell']);
const EQUIP_NO = new Set(['barbell', 'machine', 'cable', 'e-z curl bar']);
const LOWER = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
const UPPER = new Set(['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'middle back', 'traps', 'neck']);
const CORE  = new Set(['abdominals', 'lower back']);
const NIVEL = { beginner: 'Iniciado', intermediate: 'Intermedio', expert: 'Avanzado' };
// Etiquetas al español (vocabulario cerrado, siempre traducidas)
const EQUIPO_ES = {
  'body only': 'peso corporal', 'kettlebells': 'pesa rusa', 'bands': 'banda elástica',
  'medicine ball': 'pelota medicinal', 'exercise ball': 'pelota de ejercicio',
  'foam roll': 'rodillo', 'dumbbell': 'mancuerna', 'other': 'otro', 'none': '—',
};
const CATEGORIA_ES = {
  strength: 'fuerza', stretching: 'movilidad', plyometrics: 'pliometría',
  cardio: 'cardio', powerlifting: 'powerlifting', strongman: 'strongman',
};

function grupo(ex) {
  const prims = ex.primaryMuscles || [];
  if (!prims.length) return 'Full Body';
  const regs = new Set();
  for (const m of prims) {
    if (LOWER.has(m)) regs.add('L');
    else if (UPPER.has(m)) regs.add('U');
    else if (CORE.has(m)) regs.add('C');
  }
  if (regs.size === 1 && regs.has('C')) return 'Core';
  if (regs.size === 1 && regs.has('U')) return 'Upper';
  if (regs.size === 1 && regs.has('L')) return 'Lower';
  return 'Full Body';
}

function esFuncional(ex) {
  const eq = ex.equipment, cat = ex.category;
  if (EQUIP_NO.has(eq)) return false;
  if (EQUIP_OK.has(eq)) return true;
  if (cat === 'plyometrics' || cat === 'stretching') return true;
  return false;
}

// Traduce un lote de ejercicios con Claude (Haiku). Devuelve [{nombre_es, instrucciones_es}]
async function traducirLote(lote) {
  const items = lote.map((e, i) => `${i}. NOMBRE: ${e.nombre}\nINSTRUCCIONES: ${e.instrucciones}`).join('\n\n');
  const prompt = `Sos traductor de fitness. Traducí al español rioplatense (Argentina) estos ejercicios. Devolvé SOLO un array JSON válido, sin texto extra, con el formato [{"i":0,"nombre_es":"...","instrucciones_es":"..."}]. Mantené términos técnicos claros y naturales para un profe de gimnasio.\n\n${items}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('API ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  let txt = data.content[0].text.trim();
  const a = txt.indexOf('['), b = txt.lastIndexOf(']');
  return JSON.parse(txt.slice(a, b + 1));
}

(async () => {
  console.log('Descargando dataset...');
  const res = await fetch(FUENTE);
  if (!res.ok) { console.error('Error al descargar:', res.status); process.exit(1); }
  const data = await res.json();
  console.log('Dataset completo:', data.length, 'ejercicios');

  const bib = data.filter(esFuncional).map(ex => ({
    id: ex.id,
    nombre: ex.name,
    nombre_es: null,
    grupo: grupo(ex),
    nivel: NIVEL[ex.level] || 'Intermedio',
    equipo: EQUIPO_ES[ex.equipment] || ex.equipment || 'peso corporal',
    categoria: CATEGORIA_ES[ex.category] || ex.category,
    instrucciones: (ex.instructions || []).join(' '),
    instrucciones_es: null,
    imagen: ex.images && ex.images.length ? RAW_IMG + ex.images[0] : null,
  }));
  console.log('Funcionales filtrados:', bib.length);

  if (API_KEY) {
    console.log('🔑 API key detectada (termina en ...' + API_KEY.slice(-6) + '). Modelo:', MODELO);
    // Prueba con 1 ejercicio: si la API falla, cortamos acá con el error REAL
    // en vez de generar un archivo sin traducir "en silencio".
    console.log('Probando la API con 1 ejercicio...');
    try {
      const test = await traducirLote([bib[0]]);
      console.log('   ✅ Prueba OK →', test[0] && test[0].nombre_es);
    } catch (err) {
      console.error('\n❌ La API falló:', err.message);
      console.error('   No traduje nada. Revisá la key o el modelo y reintentá.');
      console.error('   (Podés forzar otro modelo con:  $env:ANTHROPIC_MODEL="claude-3-5-haiku-latest")');
      process.exit(1);
    }
    console.log('Traduciendo al español con Claude (en lotes de 8)...');
    const LOTE = 8;
    for (let i = 0; i < bib.length; i += LOTE) {
      const lote = bib.slice(i, i + LOTE);
      try {
        const tr = await traducirLote(lote);
        for (const t of tr) {
          const e = lote[t.i];
          if (e) { e.nombre_es = t.nombre_es || e.nombre_es; e.instrucciones_es = t.instrucciones_es || null; }
        }
        console.log(`  traducidos ${Math.min(i + LOTE, bib.length)}/${bib.length}`);
      } catch (err) {
        console.warn(`  ⚠️ lote ${i}-${i + LOTE} falló (${err.message}) — quedan en inglés`);
      }
    }
  } else {
    console.log('\n⚠️  NO se encontró la API key — nada se tradujo.');
    console.log('   Corré así (poné tu key de Claude directo):');
    console.log('     node import_biblioteca.js sk-ant-TU-KEY-ACA\n');
  }

  fs.writeFileSync(SALIDA, JSON.stringify(bib, null, 1));
  const conES = bib.filter(b => b.nombre_es).length;
  console.log(`\n✅ biblioteca.json: ${bib.length} ejercicios (${conES} traducidos al español)`);
  console.log('   Guardado en:', SALIDA);
})();
