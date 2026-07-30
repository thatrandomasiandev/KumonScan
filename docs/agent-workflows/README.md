# KumonScan agentic workflows

Three project skills form a chain. Invoke them from chat by name, or ask the agent to “run the complete → eval → fix pipeline.”

| Order | Skill | Purpose | Artifact |
|------:|-------|---------|----------|
| 1 | `kumonscan-complete-remaining` | Finish implementable product gaps | Code + PRODUCT.md |
| 2 | `kumonscan-platform-eval` | Test, simulate, evaluate | [`latest-eval.md`](latest-eval.md) |
| 3 | `kumonscan-fix-from-eval` | Fix open findings from the eval file | Code + updated eval |

Skill files live under [`.cursor/skills/`](../.cursor/skills/).

## Pipeline (chat)

1. “Run kumonscan-complete-remaining”
2. “Run kumonscan-platform-eval”
3. “Run kumonscan-fix-from-eval”

Or: “Run the full KumonScan agentic pipeline.”

## Cursor Automations (optional)

Scheduled/cloud **Cursor Automations** need the Agents Window handoff (`open_automation`). This chat session cannot open that editor. To schedule eval nightly:

1. Open Cursor **Agents Window** → Automations
2. Create three automations with the skill prompts above (or `@` the skill folders)
3. Suggested triggers: Complete = manual/webhook; Eval = cron weekdays; Fix = webhook after eval or manual

## Explicitly out of scope

- Automated parent SMS
- Live Kumon CRM API sync without vendor API access (TSV upload remains the sync path)
