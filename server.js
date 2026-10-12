require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const dbFile = process.env.DATABASE_FILE || "./data.sqlite";
const dbPath = path.resolve(dbFile);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS signal_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 symbol TEXT NOT NULL,
 market_mode TEXT NOT NULL,
 interval TEXT NOT NULL,
 signal TEXT NOT NULL,
 confidence INTEGER NOT NULL,
 reason_json TEXT NOT NULL,
 data_time TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER,
 action TEXT NOT NULL,
 detail TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const audit = db.prepare("INSERT INTO audit_log(actor_id, action, detail) VALUES (?, ?, ?)");
const getUser = db.prepare("SELECT id,email,role,active,created_at FROM users WHERE id=?");
const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
if (adminEmail && adminPassword && !db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?,'admin')").run(adminEmail, hash);
  console.log(`Bootstrapped admin account: ${adminEmail} (change the password after first login)`);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "signal.sid",
  secret: process.env.SESSION_SECRET || "DEV-ONLY-change-this-secret-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please log in." });
  const user = db.prepare("SELECT id,email,role,active FROM users WHERE id=?").get(req.session.userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Account unavailable. Please contact the administrator." });
  }
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required." });
  next();
}
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, message: { error: "Too many attempts. Try again later." } });

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 12 || password.length > 128)
    return res.status(400).json({ error: "Password must be 12–128 characters." });
  if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
    return res.status(409).json({ error: "An account with this email already exists." });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users(email,password_hash,role) VALUES(?,?,'user')").run(email, hash);
  audit.run(result.lastInsertRowid, "register", email);
  req.session.userId = result.lastInsertRowid;
  res.json({ user: getUser.get(result.lastInsertRowid) });
});
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const row = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!row || !row.active || !(await bcrypt.compare(password, row.password_hash))) {
    audit.run(null, "login_failed", email.slice(0, 254));
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: "Could not start session." });
    req.session.userId = row.id;
    audit.run(row.id, "login", email);
    res.json({ user: getUser.get(row.id) });
  });
});
app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: getUser.get(req.user.id) }));

function parseCandles(json) {
  if (!json || !Array.isArray(json.values)) throw new Error(json?.message || "Provider did not return candle data.");
  const candles = json.values.map(v => ({
    datetime: v.datetime,
    open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close)
  })).filter(c => c.datetime && [c.open,c.high,c.low,c.close].every(Number.isFinite))
    .sort((a,b) => new Date(a.datetime) - new Date(b.datetime));
  if (candles.length < 30) throw new Error("Not enough valid candles for analysis.");
  return candles;
}
function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function analyze(candles) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const closes = candles.map(c => c.close);
  const fast = sma(closes, 9), slow = sma(closes, 21);
  const trend = fast > slow ? "UP" : fast < slow ? "DOWN" : "SIDEWAYS";

  // Pivot levels from recent completed candles; avoid presenting them as exact guarantees.
  const sample = candles.slice(-30, -1);
  const support = Math.min(...sample.map(c=>c.low));
  const resistance = Math.max(...sample.map(c=>c.high));
  const range = Math.max(last.high-last.low, Math.abs(last.close-last.open), Number.EPSILON);
  const body = Math.abs(last.close-last.open);
  const lowerWick = Math.min(last.open,last.close)-last.low;
  const upperWick = last.high-Math.max(last.open,last.close);
  const bullishEngulf = prev.close < prev.open && last.close > last.open &&
    last.open <= prev.close && last.close >= prev.open;
  const bearishEngulf = prev.close > prev.open && last.close < last.open &&
    last.open >= prev.close && last.close <= prev.open;
  const bullishPin = lowerWick >= body*2 && upperWick <= range*0.25 && last.close > last.open;
  const bearishPin = upperWick >= body*2 && lowerWick <= range*0.25 && last.close < last.open;
  const patterns = [];
  if (bullishEngulf) patterns.push("Bullish engulfing");
  if (bearishEngulf) patterns.push("Bearish engulfing");
  if (bullishPin) patterns.push("Bullish pin bar");
  if (bearishPin) patterns.push("Bearish pin bar");

  const nearSupport = (last.close - support) / Math.max(last.close, 1e-9) < 0.0015;
  const nearResistance = (resistance - last.close) / Math.max(last.close, 1e-9) < 0.0015;
  let score = 0;
  if (trend === "UP") score += 1;
  if (trend === "DOWN") score -= 1;
  if (bullishEngulf || bullishPin) score += 1;
  if (bearishEngulf || bearishPin) score -= 1;
  if (nearSupport) score += 1;
  if (nearResistance) score -= 1;

  // Conservative rule: no directional output unless multiple factors agree.
  let signal = "WAIT";
  if (score >= 2 && trend === "UP" && (bullishEngulf || bullishPin || nearSupport)) signal = "CALL";
  if (score <= -2 && trend === "DOWN" && (bearishEngulf || bearishPin || nearResistance)) signal = "PUT";
  const confidence = signal === "WAIT" ? 0 : Math.min(85, 55 + Math.abs(score)*8);
  return {
    signal, confidence, trend, price: last.close, candleTime: last.datetime,
    support, resistance, patterns, nearSupport, nearResistance,
    reasons: [
      `9-candle SMA vs 21-candle SMA: ${trend}`,
      patterns.length ? `Pattern: ${patterns.join(", ")}` : "No selected reversal pattern confirmed",
      `Recent range support: ${support}`,
      `Recent range resistance: ${resistance}`,
      signal === "WAIT" ? "Conditions do not meet the conservative signal rule" : "Multiple technical conditions align; not a guarantee"
    ]
  };
}

app.get("/api/status", (req,res) => {
  res.json({
    app: "ok",
    liveProviderConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    otcAvailable: false,
    note: "OTC is disabled: no verified Quotex-matching OTC feed is configured."
  });
});

app.post("/api/signals/generate", requireAuth, async (req, res) => {
  const symbol = String(req.body.symbol || "EUR/USD").trim().toUpperCase();
  const interval = String(req.body.interval || "1min");
  const marketMode = String(req.body.marketMode || "LIVE").toUpperCase();
  const allowedSymbols = new Set(["EUR/USD","GBP/USD","USD/JPY","AUD/USD","USD/CHF","EUR/GBP","NZD/USD","USD/CAD"]);
  const allowedIntervals = new Set(["1min","5min","15min","30min","1h"]);
  if (!allowedSymbols.has(symbol)) return res.status(400).json({ error: "Unsupported symbol in this starter. Choose a listed pair." });
  if (!allowedIntervals.has(interval)) return res.status(400).json({ error: "Unsupported timeframe." });
  if (marketMode === "OTC") return res.status(503).json({
    error: "OTC signals are unavailable. No verified data feed matching the selected Quotex OTC instrument is configured.",
    dataStatus: "UNAVAILABLE"
  });
  if (marketMode !== "LIVE") return res.status(400).json({ error: "Invalid market mode." });
  if (!process.env.TWELVE_DATA_API_KEY) return res.status(503).json({
    error: "No live data source configured. Add TWELVE_DATA_API_KEY to the server .env file.",
    dataStatus: "UNAVAILABLE"
  });
  try {
    const base = (process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com").replace(/\/+$/,"");
    const url = new URL(base + "/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", "80");
    url.searchParams.set("apikey", process.env.TWELVE_DATA_API_KEY);
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Market data provider HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status === "error" || payload.code || payload.message && !payload.values)
      throw new Error(payload.message || "Market data provider returned an error.");
    const candles = parseCandles(payload);
    const dataTime = candles[candles.length-1].datetime;
    const ageMs = Date.now() - new Date(dataTime).getTime();
    if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > 10 * 60_000) {
      return res.status(503).json({ error: "Market data is stale or timestamp is invalid. No signal generated.", dataStatus: "STALE", lastCandle: dataTime });
    }
    const result = analyze(candles);
    const history = db.prepare(`INSERT INTO signal_history
      (user_id,symbol,market_mode,interval,signal,confidence,reason_json,data_time)
      VALUES(?,?,?,?,?,?,?,?)`);
    history.run(req.user.id, symbol, marketMode, interval, result.signal, result.confidence, JSON.stringify(result.reasons), dataTime);
    res.json({
      ...result, symbol, interval, marketMode, dataStatus: "LIVE_PROVIDER_DATA",
      provider: "Twelve Data", dataTime, generatedAt: new Date().toISOString(),
      disclaimer: "Technical analysis only; not a guarantee or financial advice. This feed may differ from Quotex pricing."
    });
  } catch (err) {
    res.status(503).json({
      error: `Signal unavailable: ${String(err.message || "data source error").slice(0,220)}`,
      dataStatus: "UNAVAILABLE"
    });
  }
});
app.get("/api/signals/history", requireAuth, (req,res) => {
  const rows = db.prepare(`SELECT id,symbol,market_mode,interval,signal,confidence,data_time,created_at
    FROM signal_history WHERE user_id=? ORDER BY id DESC LIMIT 100`).all(req.user.id);
  res.json({ history: rows });
});

app.get("/api/admin/summary", requireAuth, requireAdmin, (req,res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) n FROM users").get().n,
    activeUsers: db.prepare("SELECT COUNT(*) n FROM users WHERE active=1").get().n,
    signals: db.prepare("SELECT COUNT(*) n FROM signal_history").get().n,
    liveProviderConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    otcAvailable: false
  });
});
app.get("/api/admin/users", requireAuth, requireAdmin, (req,res) => {
  res.json({ users: db.prepare("SELECT id,email,role,active,created_at FROM users ORDER BY id DESC LIMIT 500").all() });
});
app.patch("/api/admin/users/:id", requireAuth, requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({error:"Invalid user id."});
  const target = db.prepare("SELECT id,role FROM users WHERE id=?").get(id);
  if (!target) return res.status(404).json({error:"User not found."});
  if (id === req.user.id && req.body.active === false) return res.status(400).json({error:"You cannot disable your own account."});
  if (req.body.active !== undefined) db.prepare("UPDATE users SET active=? WHERE id=?").run(req.body.active ? 1 : 0,id);
  if (req.body.role !== undefined) {
    if (!["user","admin"].includes(req.body.role)) return res.status(400).json({error:"Invalid role."});
    db.prepare("UPDATE users SET role=? WHERE id=?").run(req.body.role,id);
  }
  audit.run(req.user.id,"user_updated",JSON.stringify({target:id,changes:req.body}));
  res.json({user:getUser.get(id)});
});
app.get("/api/admin/audit", requireAuth, requireAdmin, (req,res) => {
  res.json({ logs: db.prepare("SELECT id,actor_id,action,detail,created_at FROM audit_log ORDER BY id DESC LIMIT 100").all() });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`Signal dashboard running at http://localhost:${PORT}`));
