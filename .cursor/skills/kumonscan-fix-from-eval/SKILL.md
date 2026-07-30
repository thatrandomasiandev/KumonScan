---
name: kumonscan-fix-from-eval
description: >-
  Reads docs/agent-workflows/latest-eval.md and fixes open findings. Use when
  the user asks to remediate eval results or run the fix-from-eval agentic
  workflow after platform-eval.
---

# KumonScan — Fix From Eval

## Goal

Consume the latest platform eval markdown and fix every open finding that is actionable in this repo.

## Input (required)

Read:

`docs/agent-workflows/latest-eval.md`

If the file is missing, stop and tell the user to run the **platform-eval** skill first.

## Procedure

1. Parse each `### F-NNN` finding with `Status: open`.
2. Fix in severity order: P0 → P1 → P2 → P3.
3. Skip findings that require external credentials (CRM API keys, SMS carriers) — mark them `blocked` in an updated eval section or note in the summary.
4. After fixes, re-check the specific evidence path (API call, unit of logic, or UI).
5. Update `docs/agent-workflows/latest-eval.md`:
   - Set each fixed finding `Status: fixed` and add `- **Resolution:** …`
   - Refresh **Overall** to `PASS` or `PASS_WITH_ISSUES` if only blocked items remain.
6. Do not expand scope into new features unless required to close a finding.

## Done when

All actionable open findings are fixed or explicitly blocked with reason; eval markdown reflects that.
