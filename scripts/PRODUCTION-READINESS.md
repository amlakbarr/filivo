# Callcenter AI — Final QA / Production Readiness

این چک‌لیست آخرین Gate برای V1 است. هدف این است که «Build سبز» را با «آماده Production بودن» اشتباه نگیریم.

## 1. Static Preflight

از Root پروژه:

```bash
node scripts/production-readiness.mjs
```

برای سخت‌گیری بیشتر:

```bash
node scripts/production-readiness.mjs --strict
```

برای اجرای Lint و Build داخل همان Preflight:

```bash
node scripts/production-readiness.mjs --strict --lint --build
```

نتیجه قابل قبول برای Go-Live:

```text
FAIL=0
```

در `--strict` همچنین باید:

```text
WARN=0
```

باشد.

## 2. Build / Lint

حتماً جداگانه نیز اجرا شود:

```bash
npm run lint
npm run build
```

هیچ TypeScript error، route conflict یا build warning حیاتی نباید باقی بماند.

## 3. Environment / Secrets

در Environment واقعی Hosting بررسی شود:

- Secretها با `NEXT_PUBLIC_` شروع نشده باشند.
- `.env.local` و فایل‌های Production secret داخل Git نباشند.
- `AUTH_RATE_LIMIT_PEPPER` در Production مقدار قوی و تصادفی داشته باشد.
- PocketBase service credentials فقط Server-side باشند.
- OpenAI API Key فقط Server-side باشد.
- Vector Store ID به Environment درست Production اشاره کند.
- `APP_TIMEZONE` روی timezone موردنظر Production تنظیم باشد.
- `AI_AUTO_EVAL_ENABLED=true`
- `AI_MANUAL_EVAL_ENABLED=true`
- `AI_EVAL_COVERAGE_GATE_MODE=strict` برای Go-Live نهایی توصیه می‌شود.

## 4. Authentication / Authorization

### Employee

- Login موفق.
- Login اشتباه Rate Limit می‌شود.
- Employee نمی‌تواند `/admin` را باز کند.
- Employee نمی‌تواند Admin APIها را مستقیم فراخوانی کند.
- Logout Session را خاتمه می‌دهد.
- Account غیرفعال‌شده دیگر Request معتبر انجام نمی‌دهد.

### Admin

- Login موفق.
- تمام صفحات Admin باز می‌شوند.
- عملیات حساس در Audit ثبت می‌شوند.
- تغییر Role/Status حساب کاربری Guardهای فعلی را رعایت می‌کند.

## 5. Chat End-to-End

یک Conversation جدید بساز:

1. سؤال دارای پاسخ در Knowledge بپرس.
2. پاسخ باید Grounded باشد.
3. Source صحیح نمایش داده شود.
4. Link داخل پاسخ قابل کلیک باشد و در Tab جدید باز شود.
5. Topic classification ذخیره شود.
6. `response_time_ms` و OpenAI response metadata ثبت شود.
7. Usage / Budget accounting ثبت شود.
8. Refresh صفحه Conversation را خراب نکند.
9. Retry یک Client Message نباید دو Assistant Message بسازد.

سپس سؤال بدون پاسخ بپرس:

1. پاسخ hallucinate نکند.
2. Knowledge Gap ایجاد/تقویت شود.
3. Gap duplicate غیرضروری ساخته نشود.

## 6. Feedback End-to-End

روی Assistant Message:

- Feedback مثبت ثبت کن.
- Feedback منفی ثبت کن.
- Notification موفقیت/خطا در UI دیده شود.
- Badge نشان دهد برای Chat قبلاً Feedback ثبت شده است.
- Admin Feedback Analytics رکورد را نشان دهد.
- Review status از new به in_progress و resolved قابل تغییر باشد.
- Resolve به Knowledge در صورت استفاده، لینک صحیح داشته باشد.

## 7. Knowledge End-to-End

### Create

یک Knowledge جدید Published بساز:

- Rich Text: bold
- Link
- Paragraph/List
- Topic
- Department در صورت نیاز

بعد از Save:

- به لیست Knowledge برگردد.
- Topic در List نمایش داده شود.
- `sync_status=synced` شود.
- فایل OpenAI / Vector Store ایجاد شود.
- Auto Golden Test پس از Sync اجرا شود.

### Edit

Knowledge را تغییر بده:

- Version افزایش یابد.
- Sync دوباره اجرا شود.
- فایل قبلی retire/cleanup شود.
- Auto Eval برای Revision جدید اجرا شود.
- Badge تست AI وضعیت جدید را نشان دهد.

### Draft / Archive / Delete

- Draft نباید به‌عنوان Knowledge فعال Retrieval استفاده شود.
- Archive از Retrieval خارج شود.
- Permanent Delete فقط طبق Guardهای پروژه انجام شود.
- OpenAI file cleanup بررسی شود.

## 8. Topic / Guidance End-to-End

یک Topic آزمایشی انتخاب کن:

1. Classification Guidance را تغییر بده.
2. Validation قبل از Save اجرا شود.
3. Regression Draft اگر وجود دارد Save را طبق Gate فعلی Block کند.
4. Save موفق Audit شود.
5. Auto Topic Golden Test اجرا شود.
6. نتیجه در Alert Center دیده شود.
7. صفحه Topic Regression جزئیات PASS→FAIL را نشان دهد.

Guidance History:

- Restore یک Version قدیمی.
- Audit `topic.guidance_restore` ثبت شود.
- Auto Eval بعد از Restore اجرا شود.

## 9. Golden Test / Release Gate

### Golden Cases

- حداقل یک Case PASS
- حداقل یک Case دارای Expected Topic
- حداقل یک Case دارای Expected Knowledge Source
- Case inactive در Run All اجرا نشود.

### Batch

- Run Single کار کند.
- Run All کار کند.
- دو Run All همزمان: دومی باید با Conflict/Busy رد شود.
- Auto Eval duplicate برای یک Revision ایجاد نشود.

### Baseline / Candidate

- فقط `run_mode=all` بتواند Baseline شود.
- Auto/Single Batch Baseline نشود.
- Candidate فقط Full Suite باشد.

### Release Gate

قبل از Go-Live باید بررسی شود:

```text
Regression = 0
ERROR = 0
Coverage Blocking Issues = 0
```

و وضعیت:

```text
READY FOR RELEASE
```

باشد.

## 10. Coverage

صفحه:

```text
/admin/evals/coverage
```

بررسی شود:

- Topic Coverage
- Knowledge Coverage
- Direct Source Coverage

برای Production نهایی پیشنهاد:

```text
Topic Coverage = 100%
Knowledge Coverage >= 80%
Direct Source Coverage >= 50%
```

Threshold واقعی همان Environment Production است.

## 11. AI Health Dashboard

صفحه `/admin` باید بدون Error باز شود و حداقل این موارد را نشان دهد:

- Release Gate
- Regression فعال
- Golden Coverage
- Grounding
- Knowledge Gap
- Feedback منفی
- Knowledge Sync

اگر یکی از subsystemها موقتاً unavailable باشد، کل Dashboard نباید Crash کند.

## 12. Failure Injection

حداقل یک بار در محیط Staging:

### OpenAI Failure

موقتاً Auto Eval را خاموش یا credential آزمایشی نامعتبر استفاده کن.

انتظار:

- Secret در Response لو نرود.
- UI Error قابل فهم دهد.
- Request ID وجود داشته باشد.
- System state corrupt نشود.

### PocketBase Failure

در Staging اتصال PocketBase را موقتاً قطع کن.

انتظار:

- Admin mutationهای fail-closed خطای 503 دهند.
- Raw credential یا stack trace به Client برنگردد.

### Concurrent Eval

دو Run All را تقریباً همزمان بزن.

انتظار:

- فقط یکی اجرا شود.
- دیگری `AI_EVAL_ALREADY_RUNNING` یا Conflict معادل بگیرد.

## 13. Production Smoke After Deploy

بعد از Deploy:

PowerShell:

```powershell
$env:BASE_URL="https://YOUR-DOMAIN"
node scripts/production-smoke.mjs
```

Git Bash:

```bash
BASE_URL="https://YOUR-DOMAIN" node scripts/production-smoke.mjs
```

Smoke باید Login page و محافظت Admin APIها را بررسی و `GO` چاپ کند.

## 14. Go / No-Go

### GO

فقط وقتی:

- `npm run lint` سبز
- `npm run build` سبز
- Static readiness: FAIL=0
- Production smoke: GO
- Release Gate: READY
- Regression: 0
- Eval ERROR: 0
- Coverage Blocking: 0
- Knowledge Sync error حیاتی: 0
- Login / Chat / Feedback / Knowledge / Topic مسیر اصلی تست شده

### NO-GO

در هرکدام از این موارد:

- Release Gate BLOCKED
- Regression جدید
- Eval ERROR حل‌نشده
- Topic/Knowledge Coverage زیر Gate در strict mode
- Knowledge Sync error فعال
- Admin API بدون Auth قابل دسترسی
- Secret داخل Client/`NEXT_PUBLIC_*`
- Build یا Type Check ناموفق

## 15. Rollback Plan

قبل از Go-Live مشخص باشد:

- آخرین Git commit/tag سالم چیست.
- Environment قبلی چگونه Restore می‌شود.
- PocketBase Backup کجاست.
- تغییر Schema چه Rollbackی دارد.
- اگر AI مشکل داشت، `AI_AUTO_EVAL_ENABLED=false` فقط Auto Eval را خاموش می‌کند؛ مشکل اصلی Chat را حل نمی‌کند.
- برای Incident در Chat باید نسخه قبلی Deploy یا OpenAI/PocketBase configuration اصلاح شود.

پیشنهاد Tag:

```bash
git tag -a v1.0.0 -m "Callcenter AI V1 production"
git push origin v1.0.0
```

Tag فقط بعد از Go نهایی زده شود.
