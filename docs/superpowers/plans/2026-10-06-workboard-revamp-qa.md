# Workboard revamp QA (Task 36, break-ui)

Harness: `/workboard/stress?case=empty|one|many|long` (dev only, 404 in production). Source: `src/app/workboard/stress/page.tsx` + `fixtures.ts`. Delete that folder once this sheet is signed off.

**Do not run mutate actions on the stress page except where a row below says so.** Fixture ids are >= 900000, so edit/stage/delete PATCH/DELETE calls 404 (useful for the failed-PATCH row). Create actions (Focus quick add, New item, new project/organization, links, subtasks) hit the real API and WOULD write real rows. Any successful mutation refreshes from `/api/workboard/work` and replaces the fixture with real data; reload the page to get the fixture back. Timeline week navigation also loads the REAL week.

Result column: PASS, or `FAIL: <what broke>` plus the fix applied (file:line).

## 1. Views x cases x widths

| # | Case | Width | View | Look for | Result |
|---|---|---|---|---|---|
| 1 | empty | 320 | Focus | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 2 | empty | 320 | Table | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 3 | empty | 320 | Board | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 4 | empty | 320 | Timeline | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 5 | empty | 390 | Focus | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 6 | empty | 390 | Table | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 7 | empty | 390 | Board | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 8 | empty | 390 | Timeline | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 9 | empty | 820 | Focus | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 10 | empty | 820 | Table | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 11 | empty | 820 | Board | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 12 | empty | 820 | Timeline | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 13 | empty | 1024 | Focus | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 14 | empty | 1024 | Table | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 15 | empty | 1024 | Board | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 16 | empty | 1024 | Timeline | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 17 | empty | 1440 | Focus | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 18 | empty | 1440 | Table | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 19 | empty | 1440 | Board | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 20 | empty | 1440 | Timeline | Empty states render with copy and a create action; no NaN/undefined in KPIs; no "0 item" grammar slips |  |
| 21 | one | 320 | Focus | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 22 | one | 320 | Table | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 23 | one | 320 | Board | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 24 | one | 320 | Timeline | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 25 | one | 390 | Focus | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 26 | one | 390 | Table | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 27 | one | 390 | Board | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 28 | one | 390 | Timeline | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 29 | one | 820 | Focus | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 30 | one | 820 | Table | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 31 | one | 820 | Board | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 32 | one | 820 | Timeline | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 33 | one | 1024 | Focus | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 34 | one | 1024 | Table | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 35 | one | 1024 | Board | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 36 | one | 1024 | Timeline | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 37 | one | 1440 | Focus | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 38 | one | 1440 | Table | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 39 | one | 1440 | Board | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 40 | one | 1440 | Timeline | Singular grammar (1 item / 1 link / 1 subtask / 1 class); no layout that assumes a list |  |
| 41 | many | 320 | Focus | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 42 | many | 320 | Table | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 43 | many | 320 | Board | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 44 | many | 320 | Timeline | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 45 | many | 390 | Focus | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 46 | many | 390 | Table | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 47 | many | 390 | Board | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 48 | many | 390 | Timeline | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 49 | many | 820 | Focus | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 50 | many | 820 | Table | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 51 | many | 820 | Board | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 52 | many | 820 | Timeline | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 53 | many | 1024 | Focus | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 54 | many | 1024 | Table | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 55 | many | 1024 | Board | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 56 | many | 1024 | Timeline | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 57 | many | 1440 | Focus | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 58 | many | 1440 | Table | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 59 | many | 1440 | Board | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 60 | many | 1440 | Timeline | No horizontal page scroll; scroll stays smooth with 200 rows; Waiting/revision badges; 10-link counts; group headings and counts correct |  |
| 61 | long | 320 | Focus | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 62 | long | 320 | Table | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 63 | long | 320 | Board | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 64 | long | 320 | Timeline | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 65 | long | 390 | Focus | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 66 | long | 390 | Table | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 67 | long | 390 | Board | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 68 | long | 390 | Timeline | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 69 | long | 820 | Focus | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 70 | long | 820 | Table | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 71 | long | 820 | Board | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 72 | long | 820 | Timeline | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 73 | long | 1024 | Focus | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 74 | long | 1024 | Table | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 75 | long | 1024 | Board | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 76 | long | 1024 | Timeline | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 77 | long | 1440 | Focus | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 78 | long | 1440 | Table | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 79 | long | 1440 | Board | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |
| 80 | long | 1440 | Timeline | 200-char title wraps/clamps without pushing trailing actions off; 60-char no-space title breaks (overflow-wrap); 40/100-char course code does not wrap badge or overlap; long project/org chip truncates with title tooltip; long blocked_reason badge truncates; 8 classes + 5 events on one day stack in Timeline without clipping; long venue/instructor |  |

## 2. Overlays x cases x widths

| # | Case | Width | Surface | How to open | Look for | Result |
|---|---|---|---|---|---|---|
| 1 | many | 320 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 2 | many | 320 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 3 | many | 320 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 4 | many | 320 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 5 | many | 320 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 6 | many | 320 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 7 | many | 320 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 8 | many | 320 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |
| 9 | many | 390 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 10 | many | 390 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 11 | many | 390 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 12 | many | 390 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 13 | many | 390 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 14 | many | 390 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 15 | many | 390 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 16 | many | 390 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |
| 17 | many | 1440 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 18 | many | 1440 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 19 | many | 1440 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 20 | many | 1440 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 21 | many | 1440 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 22 | many | 1440 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 23 | many | 1440 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 24 | many | 1440 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |
| 25 | long | 320 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 26 | long | 320 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 27 | long | 320 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 28 | long | 320 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 29 | long | 320 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 30 | long | 320 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 31 | long | 320 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 32 | long | 320 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |
| 33 | long | 390 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 34 | long | 390 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 35 | long | 390 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 36 | long | 390 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 37 | long | 390 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 38 | long | 390 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 39 | long | 390 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 40 | long | 390 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |
| 41 | long | 1440 | Detail drawer | Click a row title (long: the 200-char item and the 100-char course item) | Title wraps fully; course/project/org/waiting reason readable; close button reachable; drawer fits viewport (sheet on phones) |  |
| 42 | long | 1440 | Command palette | Ctrl+K, type "lab" | Long titles truncate per row with full value reachable; no overflow; Recent list |  |
| 43 | long | 1440 | Edit dialog | Row menu > Edit | Long values fit fields; footer buttons reachable; scrolls inside at 320 / 200% zoom. Cancel, do not Save |  |
| 44 | long | 1440 | New item type chooser + create dialog | New item button | Fits at 320; Cancel, do not Save |  |
| 45 | long | 1440 | Event dialog | Timeline > click a long event | Long title/location fit; Cancel |  |
| 46 | long | 1440 | Class override popover | Timeline > click a class (long case, 100-char code) | Long code/instructor/venue wrap; popover stays in viewport. Do not save |  |
| 47 | long | 1440 | Filters (sheet on phones) | Filters button | Long project/org names in options truncate, not overflow |  |
| 48 | long | 1440 | Links popover | Table > Links cell on a link_count 10 item | Count renders; popover positioned at its cell. The list fetch is a read and returns empty for fixture ids; do not add a link |  |

## 3. Environment

| # | Case | Condition | Steps | Look for | Result |
|---|---|---|---|---|---|
| 1 | long | Browser zoom 200% at 1440 (effective 720) | Visit every view, open drawer and palette | No clipped text, no horizontal page scroll, trailing actions reachable |  |
| 2 | many | Browser zoom 200% at 1024 | Visit every view | Same as above; Table scrolls inside its own container only |  |
| 3 | long | Dark mode (if supported) | Toggle OS scheme | Badges and chips stay legible |  |
| 4 | many | Slow network (Playwright CDP Network.emulateNetworkConditions, ~3G) | Open drawer (subtasks/links fetch), switch Timeline week | Loading states show; no layout jump; week nav disabled while loading |  |
| 5 | many | Offline | Go offline, change a stage on any row | Error toast with Retry; row reverts; no unhandled rejection in console |  |
| 6 | many | Failed PATCH (online) | Change any fixture row status/stage (id >= 900000, so 404) | Error toast offers Retry; optimistic change rolls back; Retry fails again cleanly |  |
| 7 | many | Quick-add Retry (offline ONLY) | Go offline FIRST, then Focus quick add "stress test" + Enter | Error toast with Retry; input text kept. Stay offline and dismiss; never Retry online (would write a real row) |  |
| 8 | one | Week nav | Timeline > next week | Loads REAL week data (expected); reload the page to restore the fixture |  |

## 4. Defects found and fixes

| # | Severity (Broken/Ugly/Fragile) | Case / width / view | Value | What happens | Fix (file:line) | Status |
|---|---|---|---|---|---|---|
| D1 | Broken | Focus, long title / long waiting reason, 1440 + 320 (qa-1440-focus.png) | 200+ char title; long `blocked_reason` | Row grows to ~1,000px (1,350px at 320), runs under the rail; title ellipsis never engages | Fixed by giving `.wb-collapse` `grid-template-columns: minmax(0, 1fr)` and `.wb-collapse > * { min-width: 0 }` (src/app/workboard/workboard.css:198-203); waiting meta now `.wb-frow__wait` (min-width 0, ellipsis, max-width 40%, 100%-50px on phones, full text in `title`) and the title button carries `title` (src/components/workboard/views/FocusRow.tsx:36-56, 103, 112) | Fixed (browser check left to controller) |
| D2 | Broken | Board, unbreakable title, 320 (qa-320-board.png) | `Lab_Report_Final_v12_REVISED_after_feedback_from_panel.docx` | Title runs past the card edge under the menu | Fixed by `overflow-wrap: anywhere` + `min-width: 0` on the title text span and a 3-line `-webkit-line-clamp`; full title stays in the wrapper's `title` (src/components/workboard/views/WorkBoardView.tsx:194-216) | Fixed (browser check left to controller) |
| D3 | Ugly | Timeline, many conflicts, 1440 + 320 (qa-1440-timeline.png, qa-320-timeline.png) | 11 conflicts | Banner stack fills a screen; each wraps 6+ lines at 320 | Fixed by new `ConflictSummary`: one `role="status"` line "N schedule conflicts this week" + Show/Hide button (`aria-expanded`, `aria-controls`); expanded list is one ellipsised line per conflict with `title`, max-height 180px and internal scroll; a single conflict shows inline clamped to 2 lines; no animation; resets per week (src/components/workboard/views/WorkTimelineView.tsx:375, 672-735) | Fixed (browser check left to controller) |
| D4 | Ugly | Timeline day cards, long titles, 1440 (qa-1440-timeline.png) | 200+ char titles | Day-column cards grow without bound | Fixed by `CARD_TITLE_CLAMP` (3-line clamp) on WorkCard and EventCard titles; EventCard gains `title`; day panel untouched and unclamped (src/components/workboard/views/WorkTimelineView.tsx:640-645, 810, 838-848) | Fixed (browser check left to controller) |
| D5 | Broken | Table, failed status change (fixture 404) | "Not found" | Native `alert()` dialog | Fixed by `reportTableCellError(message, retry?)` now calling `toastError` (src/components/workboard/table/tableCellError.ts); retry threaded to each caller's own save: StatusCell/PriorityCell `handleChange(next)`, DeadlineCell `save(item, next)`, LinksPopover `load(true)` / `submitAdd` / `removeLink(link)`, WorkItemDetail `commitStage` / `afterSubtaskWrite` / `addSubtask` / `toggleSubtask` / `removeSubtask`. Optimistic reverts still run before the report. No other `alert(` / `confirm(` / `prompt(` calls exist in src/components/workboard (WaitingPopover's `confirm()` is a local function) | Fixed (browser check left to controller) |

## Task 37: Emil review and impeccable audit

Date: 2026-10-08. Lenses: `emil-design-eng` (Step 1, interactions) and `impeccable` audit mode (Step 2: spacing, alignment, contrast against the `#eae8f4` glass proxy, touch targets). Both are review lenses only. Anything that conflicts with COMMON.md was rejected. The Task 35 motion-audit rejections were not reopened. Browser checks are left to the controller.

Contrast against `#eae8f4` before the fix: `--wb-text` 9.90, `--wb-text-muted` **4.48**, `--wb-text-subtle` **2.53**, `--wb-text-faint` **2.08**, `--wb-pink` **2.43**, `--wb-blue-strong` **3.69**, `--wb-blue-ink` 4.60. Danger, warn, success and the context text colours were all 5.3 or higher.

### Step 1: emil-design-eng

| # | Before | After | Why | Outcome |
|---|---|---|---|---|
| E1 | Completion checkbox has no press state | `.wb-check:active:not(:disabled) .wb-check__box { transform: scale(0.9) }`, 120ms `--wb-ease`, removed under reduced motion (workboard.css:228-233, 246-249) | This is the most-pressed control on the page, and every press should get feedback. The scale is applied to the 16px box, not the 40px hit area, so 0.9 reads the way 0.97 does on a full button | Applied |
| E2 | Bulk bar buttons and the toast Undo/Retry action have no press feedback | Added `wb-pressable` (WbBulkBar.tsx:103, 115, 117; WbToaster.tsx:21). Busy (`aria-disabled`) buttons do not scale: the guard is in the shared `.wb-pressable` rule (workboard.css:93, fix round 1), and the type chooser's press-lift rule was raised to (0,5,0) to keep winning | Brings them in line with every other Workboard button. The reduced-motion path comes from `.wb-pressable` | Applied |
| E3 | Bulk bar unmounts with no exit | — | The spec defines only the entrance, and the Task 35 audit already ruled on bulk bar entrance motion. An exit would need presence plumbing in WbBulkBar, which is beyond a polish pass | Rejected (scope) |
| E4 | Timeline week slide uses keyframes, which restart from zero when you click rapidly | — | The 160ms slide is a sanctioned exception. Week navigation is disabled while loading, so it cannot be retriggered mid-flight in practice | Rejected |
| E5 | Desktop day panel has no exit | — | This is a deferred minor (Task 25-27), already noted in the motion audit | Not reopened |
| E6 | Popovers scale from centre | — | Already origin-aware: `WbPopover` sets `transformOrigin` from its placement (WbPopover.tsx:160) | No issue |
| E7 | Palette and keyboard-opened overlays animate | — | Already instant from the keyboard (`instant` / `keyboardIntent`). Palette rows have no hover transition | No issue |
| E8 | Board drag: lift `scale(1.02)`, shift with `--wb-ease-in-out`, settle keyframe | — | This is the right curve for on-screen movement, the lift is subtle, and reduced motion is handled | No issue |
| E9 | Suggested: spring physics for drag and bulk bar | — | That would need a new dependency, and only `sonner` is allowed | Rejected (COMMON.md) |

### Step 2: impeccable audit

Score: A11y 3, Performance 4, Responsive 3, Theming 3, Integrity 3 = **16/20 (Good)**. The detector found 6 "side-tab accent border" warnings (3px left borders in TimelineDayPanel.tsx:228, WorkBoardView.tsx:192, WorkTableView.tsx:1053 and WorkTimelineView.tsx:767/817/853). These are false positives for this product. The coloured left edge is the spec's per-context/course hue encoding (from `color.ts`), not decoration, and removing it would be a redesign.

| # | Sev | Finding | Fix | Outcome |
|---|---|---|---|---|
| I1 | P1 | `--wb-text-muted` (secondary body text everywhere) is 4.48:1 on glass, just under 4.5 | Token `#5c6b80` → `#5a697e` (4.62:1), which is visually indistinguishable (workboard.css:6) | Applied (deviates from the spec §4 hex; see the report) |
| I2 | P1 | `--wb-text-subtle` (2.53:1) used for body text: form field hints, KPI axis labels, "(optional)", Board/List empty-lane copy, section counts, Timeline weekday labels and card meta, Filters copy and date labels, quick-add hint, palette group headings, empty and footer text | Those text uses now use `--wb-text-muted` (dialogStyles.ts:10, KpiVisuals.tsx:37, WaitingPopover.tsx:36, WorkBoardView.tsx:758, WorkListView.tsx:296, 334, WorkTimelineView.tsx:461, 834, WorkboardFilters.tsx:535, 589, 605, workboard.css:311, 469, 482, 483). `--wb-text-subtle` stays for icons, select carets, the lane wash and the quick-add placeholder | Applied |
| I3 | P1 | `--wb-blue-strong` as text (3.69:1): "+ Add" / draft Retry buttons and the Table's empty "+ Link" | Switched to `--wb-blue-ink` (4.60:1) (workboard.css:320, LinksCell.tsx:200). `--wb-blue-strong` is unchanged for fills, rings and focus outlines (UI components need ≥3:1, and it passes) | Applied |
| I4 | P1 | Day-panel "now" label in `--wb-pink` (2.43:1) | New token `--wb-pink-ink: #b0396d` (4.75:1 on glass) for pink-as-text (workboard.css:12, 415). The marker line and dot keep `--wb-pink` | Applied |
| I5 | P1 | Palette rows are 36px on phones (spec ≥40) | 44px at ≤767px (workboard.css:497) | Applied |
| I6 | P2 | Palette scope chips are about 22px tall (below 24 on desktop, far below 40 on phones) | `min-height: 24px`, and 40px at ≤767px (workboard.css:463, 498) | Applied |
| I7 | P2 | "+ Add" / quick-add draft buttons are about 23px on desktop, and the quick-add select is about 22px | `min-height: 24px` (workboard.css:308, 319). On phones the draft Retry/Discard and the select join "+ Add" at 40px (workboard.css:327). Fix round 1: `.wb-qa-draft` changed from `height` to `min-height: 34px` so the row contains the 40px phone buttons | Applied |
| I8 | P2 | Toast Undo/Retry is 28px on phones, and it is the main recovery action after completing on a phone | `min-height: 40px` at ≤767px (workboard.css:294) | Applied |
| I9 | P3 | Palette kbd-hint button is 22px on desktop | `min-height: 24px` + `align-items: center` (workboard.css:487) | Applied |
| I10 | P3 | Copy: Table and Board empty states said "New Item" | "New item" (WorkBoardView.tsx:551, WorkTableView.tsx:657, 696, and the comment at 685) | Applied |
| I11 | P3 | Decorative empty-state icons in Table had no `aria-hidden` (lucide 0.468 does not add it) | Added (WorkTableView.tsx:649 in fix round 1, 670, 688) | Applied |
| I12 | P2 | Other phone controls stay at 26–32px: Links popover and Detail drawer buttons (30–32px), List section toggle (32px), Filters option rows (28px) and the conflict-bar toggle (28px) | — | Deferred. Spec §13 sets the 40px phone floor for checkboxes, + Add, bulk bar and palette rows, and those are met. Raising every secondary control would change the density of the drawer and popovers, so it is beyond a polish pass. Recommended as a follow-up |
| I13 | P2 | Completed titles and struck Timeline rows use `--wb-text-faint` (2.08:1) | — | Rejected. Low contrast is the intended "done/cancelled" signal alongside the strikethrough, and the full-contrast title is one click away in the drawer |
| I14 | P3 | Placeholders (`--wb-text-subtle` / `--wb-text-faint`) are below 4.5 | — | Rejected. They are hints, not labels. Every input has a visible or ARIA label, and darkening placeholders makes them read as entered values |
| I15 | P3 | Off-grid paddings (3/9, 6/14, 8/14) and the raw 15px palette input | — | Rejected. These are optical paddings for pill, bar and toast shapes and are consistent across components. 15px sits between the 14 and 16 steps on purpose (16 on phones for iOS zoom) |
| I16 | P3 | Detector: side-tab borders | — | False positive (see the score note above) |
