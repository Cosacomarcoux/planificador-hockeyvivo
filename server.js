const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
// Clave de acceso simple. En Railway: Variables → PLANIFICADOR_PASS
// Sin la variable configurada, el acceso es libre (útil solo en local).
const PASS = process.env.PLANIFICADOR_PASS || null;

// ── Base de datos: estado compartido entre dispositivos ──
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pool.query(`CREATE TABLE IF NOT EXISTS planificador_estado (
    clave TEXT PRIMARY KEY,
    valor JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`).then(() => console.log('Tabla planificador_estado lista'))
    .catch(e => console.error('Error DB:', e.message));
} else {
  console.warn('Sin DATABASE_URL: corriendo en modo local (sin sincronización)');
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if (!PASS) return next();
  if (req.headers['x-clave'] === PASS) return next();
  res.status(401).json({ error: 'clave incorrecta' });
}

// Todo el estado compartido de una vez (se llama al abrir la app)
app.get('/api/estado', auth, async (req, res) => {
  if (!pool) return res.json({ sin_db: true, estado: {} });
  try {
    const { rows } = await pool.query('SELECT clave, valor FROM planificador_estado');
    const estado = {};
    for (const r of rows) estado[r.clave] = r.valor;
    res.json({ estado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Guardar una clave de estado (planes, intenciones, banco, memoria...)
app.put('/api/estado/:clave', auth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'sin base de datos configurada' });
  try {
    await pool.query(
      `INSERT INTO planificador_estado (clave, valor, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = $2, updated_at = NOW()`,
      [req.params.clave, JSON.stringify(req.body.valor ?? null)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Diagnóstico: estado de la base de datos
app.get('/api/health', async (req, res) => {
  if (!pool) {
    return res.json({
      db_conectada: false,
      database_url_presente: !!process.env.DATABASE_URL,
      filas: 'sin_db',
      claves: []
    });
  }
  try {
    const { rows } = await pool.query('SELECT clave FROM planificador_estado');
    res.json({
      db_conectada: true,
      database_url_presente: true,
      filas: rows.length,
      claves: rows.map(r => r.clave)
    });
  } catch (e) {
    res.status(500).json({ db_conectada: false, error: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Planificador Hockey Vivo corriendo en puerto ${PORT}`);
});
