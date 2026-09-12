const express = require('express');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
// In production, set SESSION_SECRET as an environment variable in the hosting panel.
const SESSION_SECRET = process.env.SESSION_SECRET || 'richvisual-dev-secret-change-me';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// ---------- tiny JSON "database" ----------
function ensureUsersFile() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
}

function loadUsers() {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ---------- simple signed session token (no extra dependency needed) ----------
function sign(value) {
  const h = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}

function verify(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return null;
  const value = token.slice(0, idx);
  const h = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  if (h.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(expected))) {
    return null;
  }
  return value; // username
}

function requireUsername(req, res, next) {
  const username = verify(req.cookies.session);
  if (!username) return res.status(401).json({ error: 'Не авторизован' });
  req.username = username;
  next();
}

// ---------- validation ----------
function validCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return 'Заполните все поля';
  if (username.length < 3 || username.length > 20) return 'Ник должен быть от 3 до 20 символов';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Ник может содержать только буквы, цифры и подчёркивание';
  if (password.length < 6) return 'Пароль должен быть не короче 6 символов';
  return null;
}

// ---------- API ----------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  const error = validCredentials(username, password);
  if (error) return res.status(400).json({ error });

  const users = loadUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'Такой ник уже занят' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users.push({ username, passwordHash, createdAt: new Date().toISOString() });
  saveUsers(users);

  res.cookie('session', sign(username), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });

  const users = loadUsers();
  const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Неверный ник или пароль' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Неверный ник или пароль' });

  res.cookie('session', sign(user.username), { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ username: user.username });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', requireUsername, (req, res) => {
  res.json({ username: req.username });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`RichVisual site running on port ${PORT}`);
});
