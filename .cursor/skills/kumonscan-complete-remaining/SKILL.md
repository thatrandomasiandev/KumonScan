---
name: kumonscan-complete-remaining
description: >-
  Completes remaining KumonScan product gaps against the front-desk requirements
  (roster, desk, timers, absences, reports). Use when the user asks to finish
  open requirements, close the build backlog, or run the complete-remaining
  agentic workflow. Skips CRM live API unless credentials/docs exist; skips SMS.
---

# KumonScan — Complete Remaining Work

## Goal

Close implementable gaps in KumonScan so the original 8-section front-desk spec is satisfied except explicitly deferred items (live CRM API without access; automated SMS).

## Non-goals

- Vonage / Verizon / any automated parent SMS
- Inventing a Kumon CRM API that does not exist
- Force-push, secrets in git, or destructive DB wipes

## Decision defaults (do not re-litigate)

- **Roster sync:** Admin TSV/CSV upload is the official sync path until a real CRM API is provided.
- **Reports:** CSV and PDF both required.
- **Overage:** show `+N min` on overtime rows.
- **Auth:** single admin password is enough unless the user asks for roles.

## Procedure

1. Read `PRODUCT.md` and skim Desk / Admin / Dashboard / Scan pages + `server/routes/api.js`.
2. Diff against requirements:
   - Roster subjects + schedule days
   - Desk autocomplete check-in, subjects, live clock, timeapi.io stamps
   - 30/60 allowance, elapsed, red overtime + overage
   - Check-out, completed today, absences
   - Monthly + annual reports (CSV + PDF)
3. Implement only missing pieces. Prefer extending existing modules over new frameworks.
4. Update `PRODUCT.md` / README when behavior changes.
5. Smoke-check critical API paths (auth, check-in/out, present, absent, reports csv+pdf) when the server can run.
6. Summarize what shipped vs what remains blocked (CRM API / SMS).

## Done when

Every implementable requirement is Done or documented Partial with a clear blocker. SMS remains Won't-do unless the user reopens it.
