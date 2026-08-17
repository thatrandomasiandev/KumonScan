# Product

## Register

product

## Users

Center staff run the front desk, admin panel, and dashboard on a tablet or laptop at the front desk. They need name-based check-in with subject selection, a live on-floor list with overtime flags, student registration, and session history without walking the floor.

Students and parents use the self-registration flow (name only, no code) on phones or shared tablets when joining the roster. Many users are elementary-school age: large type, short copy, 44px minimum touch targets on student-facing controls.

## Product Purpose

KumonScan replaces paper sign-in sheets. Check-in is staff-operated only, from the Desk roster (search by name, last name, or student number; pick Math / Reading / Both) — no kiosk, no student codes, no camera. Each session is stamped from timeapi.io; if timeapi.io is unreachable, check-in and check-out are rejected. Client clocks are never authoritative for session records.

Session allowance is 30 minutes for one subject and 60 minutes for both. Open sessions on Desk and Admin show elapsed time; when elapsed exceeds the allowance, the student row turns red and shows overage minutes (for example +8 min). Checked-out students move to Completed today with total visit minutes.

Staff set each student's enrolled subjects and scheduled weekdays in Admin. Desk can generate an absence list for students expected that weekday who never checked in. Dashboard exports monthly or rolling 12-month attendance as CSV or PDF (visits, total minutes, overtime count) and charts average check-ins per weekday over the past 28 days against scheduled students.

Admin accepts CRM roster upload (TSV/CSV) as the roster sync path: after Personal Orientation enrollments, staff export from the Kumon CRM and upload in Admin (name match updates; new names are created). The standard CRM export has no schedule-day column; Admin bulk schedule apply sets weekdays (MWF / TTh / Mon–Fri or custom) so Desk absences work. Staff can still edit subjects and days per student.

Check-in and check-out enqueue a parent SMS in a server-side `sms_queue` table when the student has a parent phone on file. A dedicated Android phone at the center runs the gateway app (`gateway-app/`), polls the queue every 15 seconds with a static `GATEWAY_API_KEY` bearer token, sends each message through the phone's own SMS plan, and acknowledges the result. Failed sends retry up to 3 attempts, then stay visible as failed. Queue inserts never block a scan; with no gateway configured, rows accumulate unsent and Admin's gateway status endpoint reports the backlog and the phone's last heartbeat. No third-party SMS API is involved.

Admin's Staff & center tab manages staff records (role, hourly rate) and a time clock: clock-in and clock-out are stamped from timeapi.io like student sessions, with one open shift per staff member enforced by a partial unique index. The payroll report totals completed shifts per staff member over a date range (default: current month) and computes gross pay from hourly rate, exported as CSV. Weekday capacity limits (seats per day) are set in the same tab; Desk shows expected students and capacity for today and flags over-capacity.

## Brand Personality

Clear, calm, official: a center front-desk tool, not a startup landing page. Warm enough for kids; restrained enough for instructors.

## Anti-references

- Generic SaaS dashboard templates (hero metrics, purple gradients, identical stat cards)
- AI landing-page clichés (glass cards, gradient text, decorative blur)
- Emoji navigation or playful toy-like UI on staff tools
- Dense admin tables with no hierarchy
- Dark-mode-by-default observability aesthetics

## Design Principles

1. **Task first:** one obvious primary action per screen (check in, see who is here).
2. **Earned familiarity:** top nav, cards, and tables staff already recognize; no novel affordances on the critical path.
3. **Kid-readable:** large type, plain language, generous touch targets on the registration flow.
4. **Official trust:** Kumon blue and red on actions and accents only; neutrals carry surfaces.
5. **Honest feedback:** check-in, check-out, and overtime states use color and label together, never icon alone.

## Accessibility & Inclusion

- WCAG 2.1 AA contrast on text and controls
- 44px minimum touch targets on student-facing flows
- Respect `prefers-reduced-motion` for transitions
- Visible keyboard focus on all interactive elements
