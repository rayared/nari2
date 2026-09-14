# استودیوی ضبط و تدوین زندهٔ نریشن — MVP

پیاده‌سازی کامل مگاپرامت (فازهای ۰ تا ۴). این README وضعیت واقعی هر بخش را
شفاف مستند می‌کند — چه چیزی build شده و type-check تمیز دارد، و چه چیزی به
زیرساخت واقعی (Postgres/S3) نیاز دارد که در محیط توسعهٔ من در دسترس نبود.

## وضعیت واقعی (صادقانه)

✅ **کامپایل شده و تأیید شده:**
- `npm install` بدون خطا
- `npx tsc --noEmit` — صفر خطا (strict mode, `noUncheckedIndexedAccess`)
- `npm run build` — کامپایل کامل Next.js، همهٔ صفحات و API routeها، خروجی در
  `.next/`
- `npx drizzle-kit generate` — تولید موفق SQL migration از schema (در
  `drizzle/0000_*.sql`)

⚠️ **کدنویسی‌شده و منطقاً درست، اما در این محیط قابل اجرای end-to-end نبود:**
- من به یک Docker registry در sandbox توسعه دسترسی نداشتم، پس نتوانستم
  `docker compose up` را واقعاً اجرا کنم و مسیرهای وابسته به دیتابیس/S3 را
  با یک سرور واقعی تست کنم. منطق کوئری‌ها و presigned URLها بازبینی و
  type-check شده، اما تست live نشده‌اند.
- ضبط صدای واقعی در مرورگر (AudioWorklet، MediaRecorder، IndexedDB) نیاز به
  یک تب مرورگر واقعی با میکروفن دارد — چیزی که در یک محیط headless قابل
  اجرا نیست. کد بر اساس مستندات Web Audio API نوشته شده اما توصیه می‌کنم
  اولین تست دستی را با یک ضبط کوتاه انجام دهید.

## اجرا

```bash
cp .env.example .env
# مقادیر AUTH_SECRET, EMAIL_* را پر کنید (برای Magic Link به یک SMTP نیاز دارید)

docker compose up -d          # Postgres 17 + MinIO
npm install
npm run db:push               # اعمال schema روی دیتابیس

# ساخت باکت MinIO (یک‌بار، از طریق کنسول http://localhost:9001 یا mc):
#   mc alias set local http://localhost:9000 studio studio123
#   mc mb local/narration-studio

npm run dev                   # یا: npm run build && npm start
```

## نقشهٔ فازها → فایل‌ها

| فاز | چی | کجا |
|---|---|---|
| ۰ | Schema (۵ جدول)، Auth.js Magic Link، Docker Compose | `src/server/db/schema.ts`, `src/server/auth.ts`, `docker-compose.yml` |
| ۱ | CRUD پروژه/اپیزود، کتابخانهٔ صدا (۱۰ اسلات) | `src/server/hono/routes/{projects,episodes,sounds}.ts`, `src/app/library` |
| ۲ | ضبط دومسیره، WAV Worker، IndexedDB، آپلود مقاوم، Recovery | `src/lib/audio/{engine,wav-encoder.worker,wav-header}.ts`, `src/lib/storage/{idb,upload-queue}.ts`, `public/workers/*.js` |
| ۳ | کنسول زنده: موسیقی/افکت/اکو/داکینگ | `src/lib/audio/engine.ts` (بخش‌های Music/SFX/Echo)، `src/components/recording-console/*` |
| ۴ | UX شست‌محور، صفحهٔ اپیزود، تست‌های پذیرش | `src/app/projects/.../record/page.tsx`, `.../[episodeId]/page.tsx` |

## تصمیم‌های مهندسی که باید بدانید

### هدر WAV در فایل Raw (نکتهٔ مهم)

WAV نیاز به یک هدر ۴۴بایتی در ابتدای فایل دارد که شامل اندازهٔ نهایی دیتاست
— اما اندازهٔ نهایی تا پایان ضبط مشخص نیست. از طرفی، قانون S3 Multipart
Upload می‌گوید هر Part (به‌جز آخرین Part) باید حداقل ۵ مگابایت باشد؛ هدر
۴۴بایتی این شرط را نقض می‌کند اگر آن را به‌عنوان Part جدا آپلود کنیم.

**راه‌حل پیاده‌سازی‌شده:** هدر به ابتدای *اولین* Part انباشته‌شده (که حداقل
۵MB دیتای PCM دارد) اضافه می‌شود، با اندازهٔ‌های RIFF/data برابر
`0xFFFFFFFF` (قرارداد "streaming WAV"). ffmpeg، Audacity، VLC و اکثر DAWها
این قرارداد را با محاسبهٔ طول واقعی فایل به‌درستی می‌خوانند. جزئیات در
`src/lib/audio/wav-header.ts` مستند شده. **محدودیت شناخته‌شده:** پارسرهای
سخت‌گیر ممکن است این هدر را نپذیرند؛ اصلاح کامل آن (patch هدر بعد از اتمام
با اندازهٔ دقیق) نیازمند رندر سروری است که طبق بخش ۱۴ مگاپرامت عمداً از
MVP خارج شده.

### تشخیص هدفون

مرورگرها API قابل‌اعتمادی برای تشخیص «هدفون وصل است» ندارند. پیاده‌سازی
فعلی تلاش می‌کند از روی label دستگاه‌های audiooutput حدس بزند و در غیر این
صورت یک تأییدیهٔ دستی از کاربر می‌گیرد (`prep/page.tsx`).

### همزمانی آپلود

حداکثر ۲ آپلود موازی (Semaphore مشترک بین مسیر raw و mixed)، backoff نمایی
بی‌نهایت هنگام قطع اتصال (هرگز تسلیم نمی‌شود وسط یک سشن)، و بازیابی خودکار
از IndexedDB در بارگذاری بعدی صفحه — در `src/lib/storage/upload-queue.ts`.

## آنچه صریحاً پیاده‌سازی نشده (طبق بخش ۱۴ مگاپرامت)

FLAC، WebCodecs، RNNoise، De-esser/EQ، رندر سروری از EDL، نرمال‌سازی LUFS،
تولید موج، پریست‌های صوتی، تله‌پرامپتر خودکار، Passkey، RLS، BullMQ، PWA
offline shell، چند تیک هم‌زمان در یک اپیزود، Convolver/IR.

## قبل از استفادهٔ واقعی

- یک ضبط کوتاه (۲-۳ دقیقه) بگیرید و raw.wav را در Audacity/ffmpeg باز کنید
  تا قرارداد streaming-header را تأیید کنید.
- تست هواپیما-مود (بخش ۱۰، معیار ۴) و بستن ناگهانی تب (معیار ۵) را دستی
  انجام دهید — این‌ها اتفاقاً همان چیزهایی هستند که بدون مرورگر واقعی و
  دیتابیس/S3 زنده قابل تأیید خودکار نبودند.
- `AUTH_SECRET` را با `openssl rand -base64 32` بسازید.
