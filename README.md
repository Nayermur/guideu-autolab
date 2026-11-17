# AutoLab

একটা ফ্রি, multi-agent AI নিউজ টিম। বিষয়: **খবর ও তথ্যভিত্তিক আপডেট** (বাংলাদেশ ও বিশ্ব)। ৫ জন AI এজেন্ট মিলে খবর খোঁজে, তথ্য যাচাই করে, Instagram পোস্ট লেখে, ডিজাইন করে আর রিভিউ করে। আপনি Approve না করলে কিছুই পাবলিশ হয় না।

## টিম "Pulse"

| এজেন্ট | কাজ |
|---|---|
| **Rafi** (Scout) | RSS ফিড পড়ে আজকের সবচেয়ে ভালো গল্প বাছাই করে। বিজ্ঞাপন, গুজব আর পুরনো টপিক বাদ দেয়। |
| **Nila** (Verifier) | মূল আর্টিকেল পড়ে শুধু সেখানে লেখা তথ্যগুলো বের করে। সোর্স দুর্বল হলে গল্প বাতিল করে। |
| **Sabbir** (Writer) | শুধু যাচাই করা তথ্য দিয়ে হেডলাইন, ক্যাপশন আর হ্যাশট্যাগ লেখে। |
| **Arif** (Critic) | ১ থেকে ১০ স্কোর দেয়। স্কোর কম হলে ফিডব্যাকসহ Writer-এর কাছে ফেরত পাঠায় (সর্বোচ্চ ২ বার)। |
| **Mitu** (Designer) | লেআউট, লেবেল আর ইমোজি ঠিক করে, তারপর 1080×1350 PNG বানায়। |

```
RSS ফিড → Rafi → Nila → Sabbir ⇄ Arif → Mitu → 📱 আপনার Telegram → ✅ Approve
```

## খরচ: $০

- **AI:** Google Gemini free tier। একটা মডেল ব্যস্ত থাকলে স্বয়ংক্রিয়ভাবে পরের মডেল চেষ্টা করে।
- **24/7 চালানো:** GitHub Actions, দিনে ৩ শিফট (সকাল ৯টা, দুপুর ২টা, রাত ৮টা, বাংলাদেশ সময়)। public রিপোতে Actions-এর মিনিট সীমাহীন ফ্রি।
- **মেমোরি:** ড্রাফট, লগ আর পোস্টের ছবি থাকে আলাদা একটা **private** রিপোতে, তাই কোড public হলেও ডেটা গোপন থাকে
- **Approval:** Telegram bot

## সেটআপ (একবারই করতে হবে)

1. **ডেটার জন্য একটা private রিপো বানান** (যেমন `autolab-data`), একদম খালি অবস্থায়। ড্রাফট, লগ, ছবি আর ড্যাশবোর্ড সাইট এখানে থাকবে।
2. **ওই রিপোতে লেখার অনুমতির জন্য একটা token বানান:** GitHub → নিজের ছবি → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   - Repository access: **Only select repositories** → শুধু ডেটা রিপো
   - Permissions → Repository permissions → **Contents: Read and write**
3. **এই (কোডের) রিপোতে Variables যোগ করুন:** Settings → Secrets and variables → Actions → **Variables** ট্যাব
   - `DATA_REPO`: ডেটা রিপোর নাম, যেমন `your-name/autolab-data`
4. **Secrets যোগ করুন:** একই জায়গায় **Secrets** ট্যাব → New repository secret
   - `DATA_REPO_TOKEN`: ধাপ ২-এর token
   - `GEMINI_API_KEY`: aistudio.google.com/apikey থেকে নেওয়া key
   - `TELEGRAM_BOT_TOKEN`: Telegram-এ @BotFather-কে `/newbot` পাঠালে পাবেন
   - `TELEGRAM_CHAT_ID`: @userinfobot-কে মেসেজ করলে আপনার id দেখাবে। তারপর নিজের বানানো বটকে একবার `/start` পাঠান।
5. **Actions চালু করুন:** Actions ট্যাব → "AutoLab team" → **Run workflow**। প্রথমে mode `check-feeds` দিয়ে চালিয়ে দেখুন সব নিউজ সোর্স কাজ করছে কিনা, তারপর `shift` দিয়ে প্রথম শিফট চালান।
6. এরপর থেকে নতুন ড্রাফট Telegram-এ ছবিসহ আসবে। ✅ বা ❌ চাপলেই হবে।
7. Instagram secrets যোগ করলে Approve করা পোস্ট নিজে থেকেই Instagram-এ যাবে (নিচে "Instagram অটো-পাবলিশ" দেখুন)। না করলে ছবি ডেটা রিপোর `output/` ফোল্ডারে আর ক্যাপশন ড্যাশবোর্ডে থাকবে, নিজে আপলোড করবেন।

## ভার্চুয়াল অফিস ড্যাশবোর্ড

`dashboard/` ফোল্ডারে একটা পিক্সেল-আর্ট isometric অফিস আছে। সেখানে ৫ এজেন্টকে লাইভ দেখা যায়:
- **কাজ করলে** এজেন্ট নিজের ডেস্কে বসে টাইপ করে, মনিটর জ্বলে থাকে
- **বিশ্রামে থাকলে** অফিসে ঘুরে বেড়ায়: পানির কুলার, কফি মেশিন, সোফা
- **সমস্যা হলে** নামের পাশে লাল চিহ্ন আর ত্রুটির বার্তা দেখায়
- জানালার আকাশ বাংলাদেশ সময় অনুযায়ী দিন বা রাত দেখায়
- প্যানেলে আছে **মিশন** (অপেক্ষমাণ ড্রাফট, ক্যাপশন কপি করার বোতামসহ), **টিম**, **লগবুক** আর **আর্কাইভ**
- প্রতি ১ মিনিটে নিজে থেকেই রিফ্রেশ হয়

নিজের কম্পিউটারে দেখতে: `npm run dashboard`, তারপর http://localhost:4173

**অনলাইনে ফ্রি (Vercel):** প্রতিটা রানের পর workflow ড্যাশবোর্ডের ফাইলগুলো ডেটা রিপোতে কপি করে দেয়। vercel.com → Add New Project → **ডেটা রিপো** Import করুন → Deploy (`vercel.json`-এ সব সেটিং দেওয়া আছে)। এরপর প্রতিটা শিফটের পর ড্যাশবোর্ড নিজে থেকেই আপডেট হবে।

**Login:** Vercel প্রজেক্টের Settings → Environment Variables-এ `AUTH_EMAIL`, `AUTH_PASSWORD` আর `AUTH_SECRET` (৩২+ অক্ষরের random লেখা) দিন। পোস্টের ছবি ছাড়া ড্যাশবোর্ডের সবকিছু login দিয়ে লক থাকে। ছবিগুলো খোলা রাখতে হয়, কারণ Instagram ওগুলো ডাউনলোড করে।

## Instagram অটো-পাবলিশ (Phase 3)

Telegram-এ ✅ Approve চাপলে ৩০ মিনিটের মধ্যে পোস্টটা নিজে থেকেই Instagram-এ চলে যায়। তারপর Telegram-এ পোস্টের লিংক আসে, আর ড্যাশবোর্ডে "published" দেখায়।

### একবারের সেটআপ
1. **Instagram অ্যাকাউন্টটা Professional করুন:** Instagram অ্যাপ → Settings → Account type → **Business** বা **Creator**।
2. **Meta Developer App বানান:** developers.facebook.com → My Apps → **Create App** → use case হিসেবে Instagram API বেছে নিন।
3. **Access token নিন:** দুটো পথের যেকোনো একটা।
   - **সহজ পথ (Instagram Login, Facebook Page লাগে না):** App → Instagram → *API setup with Instagram login* → নিজের অ্যাকাউন্ট যোগ করুন → **Generate token**। এখানে token আর Instagram user ID দুটোই পাবেন। GitHub-এ variable `IG_GRAPH_HOST` = `graph.instagram.com` সেট করুন।
   - **Facebook Login পথ:** Instagram অ্যাকাউন্ট একটা Facebook Page-এর সাথে যুক্ত থাকতে হয়। Graph API Explorer থেকে `instagram_basic` আর `instagram_content_publish` permission দিয়ে token নিন। এই পথে `IG_GRAPH_HOST` সেট করার দরকার নেই।
4. **GitHub Secrets যোগ করুন:** `IG_USER_ID` আর `IG_ACCESS_TOKEN`।
5. App-টা Development mode-এ থাকলেই চলবে। যে অ্যাকাউন্ট app-এ যুক্ত, শুধু তার জন্য App Review লাগে না।

### যা জানা দরকার
- **Token-এর মেয়াদ:** সাধারণ long-lived token ৬০ দিন চলে। মেয়াদ শেষ হলে Telegram-এ সতর্কবার্তা আসবে। তখন নতুন token বানিয়ে `IG_ACCESS_TOKEN` secret আপডেট করুন, তারপর `npm run retry -- <id>` চালান (বা ড্রাফটটা আবার Approve করুন)।
- **ছবির লিংক:** Instagram ছবিটা ড্যাশবোর্ড থেকে ডাউনলোড করে। ছবির ফাইলের নামে ২৪ অক্ষরের random টোকেন থাকে, তাই শুধু ছবিগুলোই login ছাড়া খোলে। ড্রাফট লিস্ট আর লগ login দিয়ে লক থাকে।
- **ব্যর্থ হলে:** ছবি তখনো deploy না হলে বা Instagram ব্যস্ত থাকলে পরের সিঙ্কে আবার চেষ্টা করে (সর্বোচ্চ ৩ বার)। এরপরও না হলে "failed" দেখায় আর Telegram-এ জানায়।
- **বন্ধ করতে:** `team.json`-এ `"autoPublish": false` দিন।
- ড্যাশবোর্ডের ঠিকানা `team.json`-এর `dashboardUrl`-এ থাকে।

## নিজের মতো সাজান: `team.json`

কোড না ছুঁয়েই বদলানো যায়:
- `niche`, `audience`, `voice`, `language`: কোন বিষয়ে, কাদের জন্য, কোন ভাষায় লিখবে
- `sources`: যেকোনো RSS ফিড। Google News-এ নিজের টপিকের জন্য `https://news.google.com/rss/search?q=<টপিক>+when:2d&hl=en-US&gl=US&ceid=US:en`
- `postsPerRun`, `minCriticScore`: প্রতি শিফটে কয়টা পোস্ট হবে, আর মান কতটা কড়া হবে
- `brand`: নাম, handle আর রং
- `agents`: এজেন্টদের নাম

ছবির ডিজাইন বদলাতে চাইলে: `src/render.ts`

## নিজের কম্পিউটারে চালানো

```bash
npm install
cp .env.example .env      # তারপর .env-এ GEMINI_API_KEY বসান
npm run test:llm          # key কাজ করছে কিনা দেখুন
npm run run               # এক শিফট চালান
npm run status            # কোন এজেন্ট কী করছে
npm run check-feeds       # সব নিউজ সোর্স কাজ করছে কিনা
npm run list              # অপেক্ষমাণ ড্রাফট
npm run approve -- <id>   # অথবা: npm run reject -- <id>
npm run sync              # Telegram সিঙ্ক + অনুমোদিত পোস্ট Instagram-এ
npm run retry -- <id>     # ব্যর্থ পোস্ট আবার চেষ্টা
```

## রোডম্যাপ

- [x] **Phase 1:** ৫ এজেন্টের পাইপলাইন, Critic loop, PNG ডিজাইন, Telegram approval, GitHub Actions
- [x] **Phase 2:** পিক্সেল-আর্ট ভার্চুয়াল অফিস ড্যাশবোর্ড (লাইভ এজেন্ট স্ট্যাটাস, মিশন, লগবুক, আর্কাইভ)
- [x] **Phase 3:** Approve করলেই Instagram-এ অটো-পাবলিশ (৩০ মিনিটের মধ্যে), retry আর Telegram নোটিফিকেশনসহ
- [ ] **Phase 4:** দ্বিতীয় টিম (নিউজরুম, ব্রেকিং নিউজ)
