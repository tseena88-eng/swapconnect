const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── Config ────────────────────────────────────────────
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'mock';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = process.env.PORT || 3001;

// ── Database ──────────────────────────────────────────
const db = new Database('swap.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrations
try { db.exec('ALTER TABLE users ADD COLUMN city TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN updated_at TEXT DEFAULT (datetime(\'now\'))'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN district TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN taluk TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN designation TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN workplace TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE swaps ADD COLUMN note TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE swaps ADD COLUMN district TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE swaps ADD COLUMN taluk TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE swaps ADD COLUMN designation TEXT DEFAULT \'\''); } catch(e) {}
try { db.exec('ALTER TABLE swaps ADD COLUMN workplace TEXT DEFAULT \'\''); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    city TEXT DEFAULT '',
    district TEXT DEFAULT '',
    taluk TEXT DEFAULT '',
    designation TEXT DEFAULT '',
    workplace TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS otps (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    expires TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS swaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    district TEXT NOT NULL,
    taluk TEXT NOT NULL,
    designation TEXT DEFAULT '',
    workplace TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    swap_a_id INTEGER NOT NULL,
    swap_b_id INTEGER NOT NULL,
    revealed_a INTEGER DEFAULT 0,
    revealed_b INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (swap_a_id) REFERENCES swaps(id),
    FOREIGN KEY (swap_b_id) REFERENCES swaps(id)
  );
`);

// ── SMS Service ───────────────────────────────────────
const sms = {
  async send(phone, message) {
    console.log(`📱 SMS to ${phone}: ${message}`);
    return { success: true, provider: SMS_PROVIDER };
  }
};

// ── Auth Helpers ──────────────────────────────────────
function generateOTP() {
  return SMS_PROVIDER === 'mock' ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Login required' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires > datetime(?)').get(token, new Date().toISOString());
  if (!session) return res.status(401).json({ error: 'Session expired. Login again.' });
  req.userId = session.user_id;
  req.user = db.prepare('SELECT id, phone, name, city, district, taluk, designation, workplace FROM users WHERE id = ?').get(session.user_id);
  next();
}

// ── Auth Routes ───────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Valid 10-digit number required' });
  const code = generateOTP();
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('INSERT OR REPLACE INTO otps (phone, code, expires) VALUES (?, ?, ?)').run(phone, code, expires);
  await sms.send(phone, `Your SwapConnect OTP is: ${code}. Valid for 5 minutes.`);
  res.json({ success: true, provider: SMS_PROVIDER });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { phone, code, name } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and OTP required' });
  const otp = db.prepare('SELECT * FROM otps WHERE phone = ?').get(phone);
  if (!otp) return res.status(401).json({ error: 'No OTP requested' });
  if (new Date() > new Date(otp.expires)) return res.status(401).json({ error: 'OTP expired' });
  if (otp.code !== code) return res.status(401).json({ error: 'Wrong OTP' });
  db.prepare('DELETE FROM otps WHERE phone = ?').run(phone);
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user) {
    db.prepare('INSERT INTO users (phone, name) VALUES (?, ?)').run(phone, name || '');
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  } else if (name) {
    db.prepare('UPDATE users SET name = ?, updated_at = datetime(?) WHERE id = ?').run(name, new Date().toISOString(), user.id);
    user.name = name;
  }
  const token = createSession(user.id);
  res.json({ success: true, token, user: { id: user.id, phone: user.phone, name: user.name, district: user.district, taluk: user.taluk } });
});

// ── Profile ───────────────────────────────────────────
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.patch('/api/me', auth, (req, res) => {
  const { name, city, district, taluk, designation, workplace } = req.body;
  const updates = [], values = [];
  if (name) { updates.push('name = ?'); values.push(name); }
  if (city) { updates.push('city = ?'); values.push(city); }
  if (district) { updates.push('district = ?'); values.push(district); }
  if (taluk) { updates.push('taluk = ?'); values.push(taluk); }
  if (designation) { updates.push('designation = ?'); values.push(designation); }
  if (workplace) { updates.push('workplace = ?'); values.push(workplace); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  updates.push("updated_at = datetime('now')");
  values.push(req.userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const user = db.prepare('SELECT id, phone, name, city, district, taluk, designation, workplace FROM users WHERE id = ?').get(req.userId);
  res.json({ success: true, user });
});

// ── Swap Routes ───────────────────────────────────────
app.post('/api/swaps', auth, (req, res) => {
  const { district, taluk, designation, workplace } = req.body;
  if (!district || !taluk) return res.status(400).json({ error: 'District and taluk required' });
  if (district.toLowerCase() === taluk.toLowerCase()) return res.status(400).json({ error: 'District and taluk must differ' });

  // Deactivate existing
  db.prepare('UPDATE swaps SET active = 0 WHERE user_id = ?').run(req.userId);
  const result = db.prepare('INSERT INTO swaps (user_id, district, taluk, designation, workplace) VALUES (?, ?, ?, ?, ?)').run(req.userId, district, taluk, designation || '', workplace || '');
  const swap = db.prepare('SELECT * FROM swaps WHERE id = ?').get(result.lastInsertRowid);
  checkMatch(swap);
  res.json({ success: true, swap });
});

app.get('/api/swaps/mine', auth, (req, res) => {
  const swaps = db.prepare('SELECT * FROM swaps WHERE user_id = ? AND active = 1 ORDER BY created_at DESC').all(req.userId);
  const allMatches = [];
  for (const swap of swaps) {
    const matches = db.prepare(`
      SELECT m.id, m.revealed_a, m.revealed_b, m.created_at,
        s1.user_id as uid_a, s2.user_id as uid_b,
        s1.district as a_district, s1.taluk as a_taluk,
        s2.district as b_district, s2.taluk as b_taluk,
        u1.phone as phone_a, u1.name as name_a, u1.designation as desig_a,
        u2.phone as phone_b, u2.name as name_b, u2.designation as desig_b
      FROM matches m
      JOIN swaps s1 ON m.swap_a_id = s1.id
      JOIN swaps s2 ON m.swap_b_id = s2.id
      JOIN users u1 ON s1.user_id = u1.id
      JOIN users u2 ON s2.user_id = u2.id
      WHERE (m.swap_a_id = ? OR m.swap_b_id = ?)
    `).all(swap.id, swap.id);
    for (const m of matches) {
      const isA = m.uid_a === req.userId;
      const theirSwapId = isA ? m.swap_b_id : m.swap_a_id;
      allMatches.push({
        id: m.id,
        mySwapId: swap.id,
        theirSwapId,
        myDistrict: isA ? m.a_district : m.b_district,
        myTaluk: isA ? m.a_taluk : m.b_taluk,
        theirDistrict: isA ? m.b_district : m.a_district,
        theirTaluk: isA ? m.b_taluk : m.a_taluk,
        theirPhone: isA ? m.phone_b : m.phone_a,
        theirName: isA ? m.name_b : m.name_a,
        theirDesignation: isA ? m.desig_b : m.desig_a,
        revealed: isA ? m.revealed_a : m.revealed_b,
        createdAt: m.created_at
      });
    }
  }
  res.json({ swaps, matches: allMatches });
});

app.delete('/api/swaps/:id', auth, (req, res) => {
  const swap = db.prepare('SELECT * FROM swaps WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!swap) return res.status(404).json({ error: 'Swap not found' });
  db.prepare('UPDATE swaps SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/matches/:id/reveal', auth, (req, res) => {
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  const swap = db.prepare('SELECT * FROM swaps WHERE id = ? AND user_id = ?').get(match.swap_a_id, req.userId);
  const isA = !!swap;
  if (!isA && !db.prepare('SELECT * FROM swaps WHERE id = ? AND user_id = ?').get(match.swap_b_id, req.userId)) {
    return res.status(403).json({ error: 'Not your match' });
  }
  const col = isA ? 'revealed_a' : 'revealed_b';
  db.prepare(`UPDATE matches SET ${col} = 1 WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
});

// ── Utility ───────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const swaps = db.prepare('SELECT COUNT(*) as count FROM swaps WHERE active = 1').get().count;
  const matches = db.prepare('SELECT COUNT(*) as count FROM matches').get().count;
  res.json({ users, swaps, matches });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', provider: SMS_PROVIDER }));

// ── Matching Engine ───────────────────────────────────
function checkMatch(swap) {
  const reverse = db.prepare(`
    SELECT * FROM swaps WHERE user_id != ? AND active = 1
      AND LOWER(district) = LOWER(?) AND LOWER(taluk) = LOWER(?)
  `).all(swap.user_id, swap.taluk, swap.district);
  for (const r of reverse) {
    const existing = db.prepare(`
      SELECT * FROM matches WHERE (swap_a_id = ? AND swap_b_id = ?) OR (swap_a_id = ? AND swap_b_id = ?)
    `).get(swap.id, r.id, r.id, swap.id);
    if (!existing) {
      db.prepare('INSERT INTO matches (swap_a_id, swap_b_id) VALUES (?, ?)').run(swap.id, r.id);
      const userA = db.prepare('SELECT phone FROM users WHERE id = ?').get(swap.user_id);
      const userB = db.prepare('SELECT phone FROM users WHERE id = ?').get(r.user_id);
      console.log(`🎯 MATCH: ${userA.phone} ↔ ${userB.phone} (${swap.district}/${swap.taluk} ↔ ${r.district}/${r.taluk})`);
    }
  }
}

app.listen(PORT, () => console.log(`SwapConnect API → http://localhost:${PORT} [SMS: ${SMS_PROVIDER}]`));