#!/usr/bin/env node
/**
 * import_biblioteca.js — Baja el dataset free-exercise-db (dominio público),
 * filtra SOLO los ejercicios funcionales que sirven para el gimnasio de hockey,
 * mapea nivel (beginner/intermediate/expert → Iniciado/Intermedio/Avanzado) y
 * grupo muscular (Core/Upper/Lower/Full Body), y escribe public/biblioteca.json.
 *
 * Correr donde haya internet (tu compu o el server):
 *     node import_biblioteca.js
 *
 * No pisa tu banco de hockey: solo genera la "biblioteca" de genéricos aparte.
 * Fuente: https://github.com/yuhonas/free-exercise-db (Unlicense, dominio público)
 */
const fs = require('fs');
const path = require('path');

const FUENTE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const RAW_IMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const SALIDA = path.join(__dirname, 'public', 'biblioteca.json');

const EQUIP_OK = new Set(['body only', 'kettlebells', 'bands', 'medicine ball', 'exercise ball', 'foam roll', 'dumbbell']);
const EQUIP_NO = new Set(['barbell', 'machine', 'cable', 'e-z curl bar']);
const LOWER = new Set(['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors']);
const UPPER = new Set(['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'middle back', 'traps', 'neck']);
const CORE  = new Set(['abdominals', 'lower back']);
const NIVEL = { beginner: 'Iniciado', intermediate: 'Intermedio', expert: 'Avanzado' };

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

(async () => {
  console.log('Descargando dataset...');
  const res = await fetch(FUENTE);
  if (!res.ok) { console.error('Error al descargar:', res.status); process.exit(1); }
  const data = await res.json();
  console.log('Dataset completo:', data.length, 'ejercicios');

  const bib = data.filter(esFuncional).map(ex => ({
    id: ex.id,
    nombre: ex.name,
    grupo: grupo(ex),
    nivel: NIVEL[ex.level] || 'Intermedio',
    equipo: ex.equipment || 'peso corporal',
    categoria: ex.category,
    instrucciones: (ex.instructions || []).join(' '),
    imagen: ex.images && ex.images.length ? RAW_IMG + ex.images[0] : null,
  }));

  fs.writeFileSync(SALIDA, JSON.stringify(bib, null, 1));
  const porGrupo = bib.reduce((a, b) => (a[b.grupo] = (a[b.grupo] || 0) + 1, a), {});
  const porNivel = bib.reduce((a, b) => (a[b.nivel] = (a[b.nivel] || 0) + 1, a), {});
  console.log('\n✅ biblioteca.json generado:', bib.length, 'ejercicios funcionales');
  console.log('   Por grupo:', porGrupo);
  console.log('   Por nivel:', porNivel);
  console.log('   Guardado en:', SALIDA);
})();
