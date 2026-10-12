# SignalLab — Quotex-উদ্দেশ্যযুক্ত Technical Signal Generator Starter

এটি একটি **starter project**, কোনো নিশ্চিত লাভের সফটওয়্যার নয়। এতে HTML/CSS/JavaScript frontend, Node.js/Express backend, SQLite database, login/register, session authentication, admin user management, audit log, signal history এবং technical-analysis rules আছে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা

- এই প্রজেক্ট Quotex-এর সঙ্গে সংযুক্ত নয় এবং কোনো ট্রেড execute করে না।
- Live Market-এর জন্য Twelve Data API ব্যবহার করার উদাহরণ আছে। Twelve Data-এর forex quote/candles Quotex-এর exact quote বা payout feed—এমন নিশ্চয়তা নেই। নিজের ব্যবহার/redistribution-এর জন্য provider-এর plan ও license যাচাই করুন।
- **OTC মোড ইচ্ছাকৃতভাবে disabled**। Quotex-এর নির্দিষ্ট OTC instrument-এর সঙ্গে মিলে এমন বৈধ ও যাচাইকৃত data source না পাওয়া পর্যন্ত অ্যাপ কোনো OTC signal তৈরি করবে না। Live forex feed-কে OTC বলে চালানো যাবে না।
- CALL/PUT/WAIT হলো সরল, উদাহরণস্বরূপ technical rules; এটি backtested বা profitable strategy নয়। Confidence field প্রকৃত probability নয়—শুধু rule score।
- Quotex-এর terms, স্থানীয় আইন এবং data-provider license যাচাই করুন। Password/API key কারও সঙ্গে শেয়ার করবেন না।

## ১) যা লাগবে

- Node.js 20 বা নতুন সংস্করণ
- npm
- Twelve Data account/API key (Live Market candle data-র জন্য; provider-এর access/plan অনুযায়ী availability বদলাতে পারে)

## ২) চালু করুন

টার্মিনাল/Command Prompt-এ project folder-এ যান:

```bash
npm install
```

`.env.example` ফাইলটি কপি করে `.env` বানান। তারপর অন্তত এগুলো পরিবর্তন করুন:

```env
SESSION_SECRET=একটি-দীর্ঘ-এলোমেলো-secret-এখানে
ADMIN_EMAIL=আপনার-নিজস্ব-admin-email
ADMIN_PASSWORD=একটি-শক্তিশালী-দীর্ঘ-password
TWELVE_DATA_API_KEY=আপনার-provider-api-key
```

Windows PowerShell-এ:

```powershell
Copy-Item .env.example .env
npm install
npm start
```

macOS/Linux-এ:

```bash
cp .env.example .env
npm install
npm start
```

তারপর browser-এ খুলুন: `http://localhost:3000`

প্রথমবার server চালু হলে `.env`-এ দেওয়া admin email/password দিয়ে admin account তৈরি হবে (যদি একই email আগে থেকে না থাকে)। প্রথম লগইনের পর admin password বদলানোর জন্য এই starter-এ password-change UI নেই; production ব্যবহারের আগে password reset/change flow যোগ করুন, অথবা শক্তিশালী initial password ব্যবহার করে credentials নিরাপদে রাখুন।

## ৩) ব্যবহার

1. Register করে user account তৈরি করুন অথবা admin হিসেবে লগইন করুন।
2. Dashboard-এ Live Market, pair এবং timeframe বেছে `Generate signal` চাপুন।
3. API key না থাকলে, provider error দিলে, পর্যাপ্ত candle না এলে বা data stale হলে সিগন্যাল তৈরি হবে না।
4. OTC নির্বাচন করলে পরিষ্কার `unavailable` বার্তা আসবে; এটি প্রত্যাশিত আচরণ।
5. Admin Panel-এ user enable/disable, role change, summary ও audit log দেখুন।

## ৪) Data source কীভাবে কাজ করে

Backend server-side-এ Twelve Data-এর `/time_series` endpoint-এ request পাঠায়। API key browser JavaScript-এ নেই। বর্তমান implementation 80টি candle আনে, candle timestamp যাচাই করে এবং সর্বশেষ candle 10 মিনিটের বেশি পুরোনো হলে signal প্রত্যাখ্যান করে। provider plan/market hours অনুযায়ী এই freshness threshold আরও কড়া করা লাগতে পারে।

প্রাসঙ্গিক ডকুমেন্টেশন:
- https://twelvedata.com/docs/markets/market-state
- https://support.twelvedata.com/en/articles/5620516-how-to-stream-the-data

## ৫) Production-এ দেওয়ার আগে অবশ্যই করুন

- HTTPS/TLS ও secure cookie নিশ্চিত করুন (`NODE_ENV=production` সেট করুন; reverse proxy-এর ক্ষেত্রে trust proxy সঠিকভাবে configure করুন)।
- Development-এর default `SESSION_SECRET` ব্যবহার করবেন না।
- Express MemoryStore production-এর জন্য উপযুক্ত নয়। Redis/SQLite-compatible persistent session store যোগ করুন।
- Admin password change/reset, email verification, CSRF protection, stronger rate limiting, account deletion/data retention এবং backup/restore যোগ করুন।
- `helmet`-এর Content Security Policy বর্তমানে সহজে চালানোর সুবিধার জন্য বন্ধ; production-এ নির্দিষ্ট CSP যোগ করুন।
- SQLite single-instance starter-এর জন্য; বহু server/উচ্চ traffic-এ managed PostgreSQL ব্যবহার করুন।
- API error/timeout/rate-limit পর্যবেক্ষণ, server logs, monitoring এবং database backups রাখুন।
- User input, admin actions, permissions ও provider response-এ security test চালান।
- Signal rules-কে historical data-তে backtest করুন; spread, latency, expiry timing, payout, losing streak এবং out-of-sample performance অন্তর্ভুক্ত করুন।
- Provider-এর redistribution rights/terms ও Quotex-এর নিজস্ব terms যাচাই করুন।

## ৬) কৌশল (শিক্ষামূলক উদাহরণ)

- Trend: 9-candle SMA বনাম 21-candle SMA।
- Support/resistance: সাম্প্রতিক 29টি candle-এর সর্বনিম্ন low ও সর্বোচ্চ high।
- Candlestick: bullish/bearish engulfing এবং pin bar।
- CALL/PUT কেবল trend ও অন্য অন্তত একটি factor একই দিকে থাকলে; নইলে WAIT।
- এটি শুধু starter rule-set। এটি financial advice নয় এবং নির্দিষ্ট trade-এ লাভের সম্ভাবনা নির্দেশ করে না।

## ফোল্ডার কাঠামো

```text
quotex_signal_generator/
  server.js
  package.json
  .env.example
  README-BN.md
  public/
    index.html
    style.css
    app.js
```

Database প্রথমবার চালু হলে `data.sqlite` ফাইল তৈরি হবে। `.env` ও `data.sqlite` public repository-তে commit করবেন না।
