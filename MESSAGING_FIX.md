# Messaging Fix — agent-messaging-fix branch

## What was fixed
1. **MessagesPanel.jsx** (commit 9495214): Was hardcoding `/api` instead of using `apiBase()`. Fixed to use tenant-aware path.
2. **gateway-app SmsReceiver.kt** (commit 5ced1da): Root cause of broken messaging. Android app had no RECEIVE_SMS permission and no BroadcastReceiver — parent replies were never received. Added SmsReceiver.kt to handle inbound SMS and forward to POST /api/gateway/inbound.

## Before merging
- Test staff → parent send (confirm SMS arrives)
- Test parent reply → confirm it shows in MessagesPanel
- Run messaging.test.js and gateway.test.js

## Also flagged
agent-integration ledger is 44+ hours stale — 10 feature branches still not merged to main.
