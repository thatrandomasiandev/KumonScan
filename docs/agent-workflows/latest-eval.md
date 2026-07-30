# KumonScan platform eval

- **Date:** 2026-07-30
- **Environment:** local
- **Overall:** PASS_WITH_ISSUES

## Summary

Complete-remaining found no missing implementable code. Live eval on :3001 passed auth, present (`clock_iso`), completed-today, absent, reports JSON/CSV/PDF, overnight orphan scan → checkout, fresh check-in elapsed `0` despite ~16 min host/timeapi skew, and clean checkout. No open code findings. Absences remain empty until schedule days are set on the roster (153 students unchecked).

## Findings

No open findings.

### F-DATA-001 — Roster schedule_days mostly unset
- **Severity:** P2
- **Area:** roster
- **Status:** blocked
- **Evidence:** `GET /api/absent` → `expected_count: 0`, `unchecked_schedule_count: 153`.
- **Expected:** Absence list for students scheduled today.
- **Actual:** API healthy; student schedules empty after CRM upload without a Days column.
- **Fix hint:** Set schedule chips in Admin, or re-upload CRM export with days mapped in `rosterImport.js`.
- **Resolution:** Blocked on center data / CRM export — not a code defect.

## Simulations run
- Complete-remaining skill audit (no code changes)
- `/health`, `/api/time`, admin login
- `/api/students`, `/present`, `/completed-today`, `/absent`
- `/api/reports/attendance` json/csv/pdf (`%PDF-`, ~8178 bytes)
- Overnight open session + `/api/scan` → `checked_out`, orphan closed
- Force check-in → present elapsed `0` → check-out `200`
- Host vs timeapi skew ~966441 ms observed without false overtime

## Not tested
- Browser camera kiosk
- Production HTTPS cookie behavior
