# گزارش آزمون واقعی مرورگر — «دانش‌آموز من» نسخه 9.6.0

- **محیط آزمون:** Chromium (Headless) + Chromedriver
- **نمای دسکتاپ:** `1280×800`
- **نمای موبایل اندروید:** `390×844`
- **یکپارچگی نسخه:** `9.6.0` در `index.html`، `sw.js` و `manifest.webmanifest`

| شناسه آزمون | دسکتاپ (1280×800) | موبایل (390×844) | جزئیات اندازه‌گیری‌شده |
|---|---|---|---|
| `12_persistent_login` | ✅ PASS | ✅ PASS | دسکتاپ: overlay_hidden=True, persist+logout_ready=True / موبایل: overlay_hidden=True, persist+logout_ready=True |
| `8_default_animations` | ✅ PASS | ✅ PASS | دسکتاپ: no-animations=False, fx-hud=True, topVersion=نسخه ۹.۶.۰ / موبایل: no-animations=False, fx-hud=True, topVersion=نسخه ۹.۶.۰ |
| `9_no_home_monitor_card` | ✅ PASS | ✅ PASS | دسکتاپ: hubExists=False, hubVisible=False / موبایل: hubExists=False, hubVisible=False |
| `10_max_3_birthdays` | ✅ PASS | ✅ PASS | دسکتاپ: rendered=3/5, hasAllLink=True / موبایل: rendered=3/5, hasAllLink=True |
| `11_jarvis_pill_center` | ✅ PASS | ✅ PASS | دسکتاپ: pills=6, active=avg / موبایل: pills=6, active=avg |
| `13_default_cap_20` | ✅ PASS | ✅ PASS | دسکتاپ: cap=20, 8/10_scaled=16 / موبایل: cap=20, 8/10_scaled=16 |
| `14_fix_top_today_statuses_20` | ✅ PASS | ✅ PASS | دسکتاپ: hasMisleading5=False, topHas20=True / موبایل: hasMisleading5=False, topHas20=True |
| `15_fast_search_bars` | ✅ PASS | ✅ PASS | دسکتاپ: class=1, today=1, matrix=1 / موبایل: class=1, today=1, matrix=1 |
| `16_true_fullscreen_matrix` | ✅ PASS | ✅ PASS | دسکتاپ: isFs=True, isFit=True, rect=1280x657, barH=42px / موبایل: isFs=True, isFit=True, rect=390x701, barH=42px |
| `17_centralized_terms` | ✅ PASS | ✅ PASS | دسکتاپ: options=2, grades: 2->0->2 / موبایل: options=2, grades: 2->0->2 |
| `18_no_dup_apikey_statuses` | ✅ PASS | ✅ PASS | دسکتاپ: hasDupBar=False, goodCount=۳, attnCount=۲ / موبایل: hasDupBar=False, goodCount=۳, attnCount=۲ |
| `19_realtime_counseling_sync` | ✅ PASS | ✅ PASS | دسکتاپ: live_updated=True, len=318->317 / موبایل: live_updated=True, len=318->317 |
| `20_danesh_smart_engine` | ✅ PASS | ✅ PASS | دسکتاپ: trend=نزولی, absLink=True, qa=0.7ms, buddies=3, exam=8q/0.6ms / موبایل: trend=نزولی, absLink=True, qa=0.4ms, buddies=3, exam=8q/0.5ms |
| `1_pdf_only_report_studio` | ✅ PASS | ✅ PASS | دسکتاپ: wordExcelBtns=0, hasPdfBtn=True / موبایل: wordExcelBtns=0, hasPdfBtn=True |
| `2_unified_stylish_pdf` | ✅ PASS | ✅ PASS | دسکتاپ: pdfMagic=True, size=368703B / موبایل: pdfMagic=True, size=368703B |
| `3_symmetric_12col_table` | ✅ PASS | ✅ PASS | دسکتاپ: colgroup_cols=12 / موبایل: colgroup_cols=12 |
| `4_top_weights_legend` | ✅ PASS | ✅ PASS | دسکتاپ: legend=True, printGuide=True / موبایل: legend=True, printGuide=True |
| `5_diagonal_watermark` | ✅ PASS | ✅ PASS | دسکتاپ: watermark_layer=True / موبایل: watermark_layer=True |
| `6_clean_cols_subrows` | ✅ PASS | ✅ PASS | دسکتاپ: hasDupCols=False, hasSubrows=True / موبایل: hasDupCols=False, hasSubrows=True |
| `7_pdf_footer_960` | ✅ PASS | ✅ PASS | دسکتاپ: footer960=True, oldVer=False / موبایل: footer960=True, oldVer=False |
| `console_zero_runtime_errors` | ✅ PASS | ✅ PASS | دسکتاپ: runtime_errors=0 / موبایل: runtime_errors=0 |
