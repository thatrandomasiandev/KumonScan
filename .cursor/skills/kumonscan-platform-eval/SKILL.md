---
name: kumonscan-platform-eval
description: >-
  Tests, simulates, and evaluates KumonScan for functional bugs and requirement
  gaps. Writes docs/agent-workflows/latest-eval.md. Use when the user asks to
  evaluate, audit, simulate, or run the platform-eval agentic workflow.
---

# KumonScan — Platform Eval

## Goal

Exercise the platform (API + critical UI flows where possible), find defects and requirement gaps, and write a single markdown report the fix workflow can consume.

## Output (required)

Write or overwrite:

`docs/agent-workflows/latest-eval.md`

Use this exact structure:

```markdown
# KumonScan platform eval

- **Date:** ISO date
- **Environment:** local | staging | unknown
- **Overall:** PASS | PASS_WITH_ISSUES | FAIL

## Summary
1–3 sentences.

## Findings

### F-001 — short title
- **Severity:** P0 | P1 | P2 | P3
- **Area:** api | desk | admin | scan | dashboard | roster | auth | reports | other
- **Status:** open
- **Evidence:** what you ran / saw
- **Expected:** ...
- **Actual:** ...
- **Fix hint:** concrete file or behavior to change

(repeat F-002…)

## Simulations run
- Bullet list of scenarios executed

## Not tested
- Gaps (no browser, no admin password, etc.)
```

If there are zero defects, still write the file with `Overall: PASS` and an empty Findings section containing only:

`No open findings.`

## Procedure

1. Prefer live checks: start or reuse server on `PORT` from `server/.env`, hit `/api/time`, auth, students, present, check-in/out (on a disposable test student if safe), absent, reports `format=csv` and `format=pdf`.
2. Read code for logic bugs even when the server is down; mark those as findings with evidence = code path.
3. Simulate overtime math (30/60), dedup window (3s), inactive students blocked from scan.
4. Do **not** fix issues in this workflow — only report.
5. Severity guide: P0 blocks check-in/out or data loss; P1 major desk flow broken; P2 wrong UX/report; P3 polish/docs.

## Done when

`docs/agent-workflows/latest-eval.md` exists and lists every issue found with Fix hints.
