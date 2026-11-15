# Virtual Cinema — Design System

## Product direction

Virtual Cinema is a dark, cinematic watch-room app. The admin console follows the same
brand, but reads as a working control room rather than a second marketing site: dense,
quiet, and clear under pressure.

## Brand tokens

All tokens live in `client/src/styles.css` under `:root`. Do not introduce a parallel
palette.

- Ink / page: `--ink` (`#08070b`), raised panels: `#100c16`, `#16111f`
- Cream text: `--cream` (`#f4ece1`)
- Accent: `--amber` (`#f0b46a`); accent wash: `rgba(240, 180, 106, 0.12)`
- Secondary accent: `--screen` (`#8fc0ff`)
- Danger: `#ff8f8f`
- Display type: Playfair Display (`--font-display`)
- Body type: Inter (`--font-body`)
- Radii: 8–10px controls, 15px working panels, 999px status pills
- Admin scope variables are prefixed `--a-*` inside `.a-shell`

Dark mode is the product default and the only shipped theme. No light theme is implied.

## Admin shell

- 240px pinned sidebar, 64px topbar, fluid content with 24–28px padding.
- Navigation: Overview → Queue → Theatres → Users → Live → History. Queue is the default.
- Queue badge shows the number of actionable items; Overview keeps the compact KPI band
  and the “Cần xử lý” attention panel from the existing admin vocabulary.
- The topbar search is contextual per screen; on phones it collapses and navigation moves
  into the menu drawer.

## Queue (chosen wireframe B — inbox split)

- Desktop: 360px list + permanent detail. Tabs: All / Reports / Pending review.
- Oldest first. Each row shows type, status pill, target name, code, reason/owner, and age.
- Selecting a row never navigates away; the detail keeps title, metadata, evidence, reason,
  activity, and actions in one scan.
- Phones: one pane at a time. The list opens first; tapping a row reveals the detail with a
  Back control. The split uses `data-mobile-detail` rather than a separate route.
- Every report resolve/dismiss and every pending approval/rejection requires an explicit
  reason. Reasons are short, reusable strings; the chosen value is stored in the audit trail.
- Pending theatres are reviewed from the queue only. The Rạp table links into the queue
  (“Xem hàng đợi”) instead of offering a reasonless quick reject.
- After a successful action, refresh the overview and keep the operator in the queue.
- Auto-refresh is 20 seconds; the circular-arrow topbar action forces a refresh.

## Visual language

- The queue is a single bordered working surface; rows are separated by 1px `--a-border`
  lines, selected rows get a 2px amber edge and a faint amber wash.
- Status pills: new = blue wash; pending = amber wash. Do not use the accent for both
  “new” and “pending”.
- Evidence sits in a quiet inset block with a 2px amber left rule, not a card inside a card.
- Primary action = amber gradient with ink text; neutral = outline; destructive = quiet
  danger outline. Destructive actions always name the object (“Từ chối rạp”, “Xoá rạp”).
- Titles use Playfair; operational metadata and controls use Inter at 10–13px.
- Empty states explain what will appear and, where useful, what to do next.

## Data and wiring

- The screen uses real API data; there is no mock dataset in the build.
- Server now stores `report.resolutionReason` and the review `reason` in moderation/audit.
- Remaining backend gaps: severity, reporter aggregation/grouping, evidence snapshot,
  durable audit beyond the current 500 stored / 200 returned window, and a
  report-specific reason taxonomy.
- The queue currently renders one row per open report; multiple reports on the same theatre
  are not grouped yet.

## Accessibility and responsiveness

- Focus-visible rings follow the amber accent; controls keep 32–40px hit areas.
- Mobile drawer traps the page behind a scrim; Escape closes it, then the mobile detail.
- Tables scroll horizontally inside their panel on narrow screens.
- The admin is `noindex` at the server and never appears in the sitemap.
