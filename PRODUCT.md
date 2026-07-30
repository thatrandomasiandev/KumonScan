# Product

## Register

product

## Users

Center staff run the front desk, admin panel, and dashboard on a tablet or laptop at the front desk. They need name-based check-in with subject selection, a live on-floor list with overtime flags, student registration, and session history without walking the floor.

Students and parents use the scan kiosk and registration flow on phones or shared tablets. Many users are elementary-school age: large type, short copy, 44px minimum touch targets on student-facing controls.

## Product Purpose

KumonScan replaces paper sign-in sheets. Staff check students in from the Desk roster (search by name, pick Math / Reading / Both). QR kiosk scans still toggle check-in and check-out for students who bring their code. Each session is stamped from timeapi.io; if timeapi.io is unreachable, check-in and check-out are rejected. Client clocks are never authoritative for session records.

Session allowance is 30 minutes for one subject and 60 minutes for both. Open sessions on Desk and Admin show elapsed time; when elapsed exceeds the allowance, the student row turns red and shows overage minutes (for example +8 min). Checked-out students move to Completed today with total visit minutes.

Staff set each student's enrolled subjects and scheduled weekdays in Admin. Desk can generate an absence list for students expected that weekday who never checked in. Dashboard exports monthly or rolling 12-month attendance as CSV or PDF (visits, total minutes, overtime count).

Admin accepts CRM roster upload (TSV/CSV) as the roster sync path: after Personal Orientation enrollments, staff export from the Kumon CRM and upload in Admin (name match updates; new names are created). The standard CRM export has no schedule-day column; Admin bulk schedule apply sets weekdays (MWF / TTh / Mon–Fri or custom) so Desk absences work. Staff can still edit subjects and days per student. Parent phone is optional contact for instructors; the app does not send automated SMS.

## Brand Personality

Clear, calm, official: a center front-desk tool, not a startup landing page. Warm enough for kids; restrained enough for instructors.

## Anti-references

- Generic SaaS dashboard templates (hero metrics, purple gradients, identical stat cards)
- AI landing-page clichés (glass cards, gradient text, decorative blur)
- Emoji navigation or playful toy-like UI on staff tools
- Dense admin tables with no hierarchy
- Dark-mode-by-default observability aesthetics

## Design Principles

1. **Task first:** one obvious primary action per screen (check in, scan, see who is here).
2. **Earned familiarity:** top nav, cards, and tables staff already recognize; no novel affordances on the critical path.
3. **Kid-readable:** large type, plain language, generous touch targets on kiosk and registration flows.
4. **Official trust:** Kumon blue and red on actions and accents only; neutrals carry surfaces.
5. **Honest feedback:** check-in, check-out, and overtime states use color and label together, never icon alone.

## Accessibility & Inclusion

- WCAG 2.1 AA contrast on text and controls
- 44px minimum touch targets on student-facing flows
- Respect `prefers-reduced-motion` for transitions
- Visible keyboard focus on all interactive elements
