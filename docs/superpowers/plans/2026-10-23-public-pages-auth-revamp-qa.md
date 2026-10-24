# Public pages and auth revamp: QA record (Task 13)

Date: 2026-10-24. Dev server on :3000, Playwright (Chromium). Lenses, in order: `mobile-native`, `ui-ux-pro-max`, `break-ui`, `review-animations` (see §5), `impeccable` (audit mode). Plus the controller's extra fix list (ruling R28, 13 items).

Severity: **P0** blocking, **P1** major / WCAG AA failure, **P2** minor (recorded, not fixed unless trivial), **P3** polish.

## 1. Screenshot matrix

Saved in `.playwright-mcp/auth-revamp/qa/` as `<page>-<width>.png`, at 390×844, 768×1024 and 1440×900, full page, after the fixes:

| Page | Files |
|---|---|
| `/` | `landing-{390,768,1440}` |
| `/login?daypart=morning\|afternoon\|evening\|night` | `login-{morning,afternoon,evening,night}-{w}` |
| `/signup`, `/signup?daypart=night` | `signup-{w}`, `signup-night-{w}` |
| `/signup/finish` (sealed test ticket, "Ana Reyes") | `finish-{w}` |
| `/forgot-password`, form and sent states | `forgot-{w}`, `forgot-sent-{w}` |
| `/reset-password?token=bad` | `reset-bad-{w}` |
| `/verify-email?token=bad` | `verify-bad-{w}` |
| `/privacy` | `privacy-{w}` |

The mockups are rendered alongside for comparison as `mockup-{landing-f1-v6,auth-login-v4,auth-signup-reset-v5}-1440.png`. The other evidence lives in `.playwright-mcp/auth-revamp/`:
- `qa-break-finish-320-before.png` / `-after.png`: the worst-case finish card.
- `qa-break-signup-320.png`
- `qa-kbd-reset-invalid.png`
- `qa-xchips-{390,1440}.png`
- `qa-reduced-{landing-1440,login-night-1440}.png`: reduced motion.

### Differences from the mockups

| # | Page | Difference | Verdict |
|---|---|---|---|
| M1 | all auth | "Forgot password?", the other pink links and the selected year use a darker pink (`--pub-pink-ink` #ab4069) than the mockup's #d9628c | Intended: an AA contrast fix (U2). The brand pink stays on headings, the focus ring and borders |
| M2 | all auth | The daypart chip text is a shade darker in every sky | Intended: an AA contrast fix (U1) |
| M3 | login | "Use another account" also shows under the plain "Continue with Google" fallback. The mockup only shows it with the personalized "Continue as …" card | P2. It still adds `prompt=select_account`, so it isn't dead, just redundant-looking |
| M4 | finish | The mockup has a "Cancel" link in the top bar. The shipped page has only "Not you?" in the identity card | P2. "Not you?" does the same thing (it clears the ticket and goes to /login) |
| M5 | signup | Mockup: the email typo hint is pink. Shipped: amber (`is-warn`) with a pink-ink button | P2. Amber matches the field's warn border |
| M6 | signup/reset | Mockup: the meter bars sit above the hint text. Shipped: the hint sits above the bars | P2 |
| M7 | landing 1440 | The H1 at the full `clamp` maximum (68px) wraps to "Ace the / semester." The mockup's narrower frame sets it on one line | P2. A scale effect, not a layout bug |
| M8 | landing | The mockup's CTA block has a dashed outline | Not a difference: it's the mockup's own annotation frame |
| M9 | landing, auth | The mockups have no Next dev-tools badge | Dev-only overlay; not in production |

Everything else (structure, copy, sky per daypart, the night dark card, field style, buttons, the arc layout at 1440 and the vertical list below 880px, Sample data tags) matches.

## 2. `mobile-native`

| # | Finding | Sev | Fix |
|---|---|---|---|
| N1 | `env(safe-area-inset-*)` on `.auth-shell` was always 0: the public routes had no `viewport-fit=cover` | P1 | `export const viewport` in `(public)/layout.tsx` (`viewportFit: 'cover'`). `.lp` (landing and legal) now pads left, right and bottom by the insets too. **Needs a real notched phone to confirm** |
| N2 | Hover rules were gated on `(hover: hover)` only | P2→fixed | Now `(hover: hover) and (pointer: fine)` |
| N3 | No `touch-action: manipulation` / `user-select: none` on controls | P2→fixed | `.pub-root :is(a, button)` gets manipulation; buttons, `.auth-btn` and `.lp-btn` get `user-select: none` |
| N4 | Tap targets under 44px: the logo (27px), the top-bar switch link (21px), the landing footer Privacy/Terms (17px) and the fine-print Terms/Privacy (16px) | P1 | A transparent `::before` hit area (`inset: -14px -4px`), same pattern as `.auth-link`. Re-measured: every link, button, input and radio on all public pages is ≥44px tall |
| ✓ | Inputs are 16px (no iOS zoom); shells use `100dvh`; tap highlight is transparent; Google button and fields are ≥44px; no horizontal scroll at 320px on any page | held | |

Things only real hardware confirms: N1 safe areas, sticky hover, tap delay and the keyboard. All were checked from code and in Chromium emulation only.

## 3. `ui-ux-pro-max` (form UX and accessibility)

Contrast was measured live: every visible text node against its real background (the card, or the sky gradient's stops), in all four dayparts plus the night card.

| # | Finding | Sev | Fix |
|---|---|---|---|
| U1 | Daypart chip text: afternoon `#3d8fbf` on `#dcf0fb` **3.04**, morning **4.03**, evening **4.47** (12px bold) | P1 | Afternoon #2d6f96 (4.68), morning #9a4a22 (5.36), evening #5f4d9e (5.68) |
| U2 | Pink link text on the white card: **3.46** ("Forgot password?", "use a different email", the typo-hint button). The selected year: pink on pink-soft **2.86** | P1 | New token `--pub-pink-ink: #ab4069` (5.72 on white, 4.74 on pink-soft). Night links stay #f2a7c0 (8.5) |
| U3 | "OR LOG IN WITH EMAIL" divider and the "Optional" label in `--pub-soft`: **3.43** | P1 | `--pub-mute` (5.65) |
| U4 | Error alert red on red-soft **4.16**; warn alert amber on amber-soft **4.19**; "✓ Verified by Google" green **3.54** | P1 | #ad3f50 (5.11), #875312 (5.83), #23784e (5.43) |
| U5 | Landing: "Track it." and the eyebrows ("A day with VibeBoard", "StudyPulse") pink **2.87**; Study tag **4.22**; Work tag **4.47** | P1 | Pink-ink for the text; lav tag #5f4d9e |
| U6 | Forgot and reset didn't move focus to the invalid field after a failed submit (login, signup and finish did) | P1 | Both focus the field (reset also focuses it after a server "weak" reply) |
| U7 | First field error might not be announced: the live region mounted together with its text | P1 | R28 #2: Field keeps both regions mounted |
| U8 | Placeholder text `--pub-soft` on the field background: 3.30 | P2 | Not fixed. Every field has a visible label, the placeholder is an example, and the mockups specify this tone |
| U10 | Landing hero: at the very centre of the decorative peach and pink glows, pink-ink and `--pub-mute` text compute to 4.1–4.4. On the page gradient itself they are ≥4.75 | P2 | Not fixed. A worst-case estimate from the glow's 0.55 core alpha; the triad/lede sit near, not at, the core. Fix by softening `.lp-glow--peach`/`--pink` alpha if a measured check confirms it |
| U9 | Logo "Vibe"/"Board": ~3.0 on the sky | — | Logotype; exempt under WCAG 1.4.3 |
| ✓ | Re-run after fixes: **zero** text nodes below AA on /login and /signup in all 4 dayparts. Landing and legal: the new inks were checked by calculation against every `.lp` gradient stop (≥4.75), except U10 | held | |
| ✓ | Keyboard-only: login → Tab order logo, Sign up, Google, Use another account, email, Forgot password?, password, Show, Log in. Every stop shows a ring. Enter on empty → focus email + "Enter your email." → "Forgot password?" via keyboard carries the email over → invalid email → focus stays on email → reset link → "short" + Enter → focus password + "Use at least 8 characters." → Show toggles → a valid password + Enter lands on /dashboard | held | |
| ✓ | Finish: empty last name + submit → focus last name; YearPicker arrows wrap, Home and End work, Space on the selected year clears it | held | |
| ✓ | Labels on every input, `aria-describedby` → error/hint ids, `role="alert"` form-level alerts, one h1 per page, header/main/footer landmarks on the landing | held | |

## 4. `break-ui` (worst-case data)

Data used: a 59-character name ("Maria Concepcion Alejandra Bartholomew-Fitzgerald dela Cruz"), `a.very.long.unbreakable.address.with.many.parts@subdomain.school.edu.ph`, "Wiśniewska-Kowalczyk", María, 李, Juan😀, a password over 72 bytes, an empty optional year, and a sealed Google ticket with **no family name**. Checked at 320, 390 and 1440.

| # | Sev | Field | What happened | Fix |
|---|---|---|---|---|
| B1 | **Broken (P1)** | finish card, 320px | The card grew to 400px (a grid item keeps `min-width: auto`). `.auth-shell { overflow: hidden }` hid the overflow, so the headline, the email, "Not you?", the fields and the 5th+ year were clipped off the right edge | `.auth-card { min-width: 0 }`, `.auth-h1 { overflow-wrap: break-word }` |
| B2 | Ugly (P1) | identity email | Truncated with an ellipsis, so the visitor couldn't read which account they were confirming; "Not you?" could be squeezed | Wrap, never truncate: `overflow-wrap: anywhere`, with a `<wbr>` after the "@" so typical emails break as "name@ / domain". "Not you?" is `flex: 0 0 auto; white-space: nowrap` |
| B3 | Fragile (P2→fixed) | password > 72 bytes | The meter said "Great password" while the server rejects it | R28 #1: "Too long · Use 72 bytes or fewer." with the warn border; blur shows the validate.ts error |
| ✓ | held | Juan😀 | Rejected: "First name can only use letters, spaces, apostrophes, periods and hyphens." María and 李 are accepted | |
| ✓ | held | empty optional year | Submits with `year: ''` | |
| ✓ | held | Google profile with no family name | The last-name field is empty; submit focuses it with "Enter your last name." | |
| ✓ | held | signup at 320px with every long value | No overflow; the 60-character name scrolls inside its input; the duplicate-email error wraps and focuses the email | |

## 5. Motion (§8): `review-animations` was unavailable

The `review-animations` skill is user-invoke-only (`disable-model-invocation`), so the agent couldn't load it. **Run `/review-animations` yourself** if you want that lens. What was done instead is the brief's own §8 conformance check:

| Motion | Spec | Shipped | Result |
|---|---|---|---|
| Hero entrance | fade-up, 60ms stagger; card scales from .98; count-up 700ms; bars stagger 40ms | as spec | ✓ |
| Hero chips | enter after the card, then ±4px drift over 6–8s with different phases | 560/640/720ms in; 7s/8s/6s drift via `translate` | ✓ |
| ✕ chips | slide 12px toward the centre, fade to 60%, 600ms, once | **Defect:** the pairs in each row slid *into each other* and overlapped by ~16px at 1440 (P1) | Fixed: chips wait 12px out (armed by JS, so no-JS shows them at rest) and slide *in* to their laid-out spot. Re-measured: no overlaps at 390 or 1440 |
| Day arc | sun on `offset-path`; moments light in order | a scroll-driven `--sun` with a JS fallback rather than `animation-timeline: view()` (earlier rulings R23/R25) | P2: the deviation was already accepted |
| Arc on load | — | **Defect (R28 #9):** future moments faded from lit to dim on first paint | Fixed: `is-arming` drops transitions for the first two frames. Measured: 0 CSS transitions at arming (scroll top and mid-page); scrolling still animates |
| Sky glows | 30s drift, paused when hidden | as spec | ✓ |
| Buttons | scale .97 over 120ms; hover only where hover exists | as spec (now also `pointer: fine`) | ✓ |
| Fields | 150ms border/ring; error slides in 4px | as spec; the slide now triggers on `:not(:empty)` because the region stays mounted | ✓ |
| Login success | check for 400ms, then push | as spec | ✓ |
| Reduced motion | everything off | measured: 0 running animations on `/` and `/login?daypart=night`; GWA shows 1.42 at once; no arc dimming | ✓ |

## 6. `impeccable` audit (/, /login, /signup)

The detector (`detect.mjs`) had one finding: gradient text at `public.css:205`. **False positive**: gradient text on the large emphasised words is in the approved mockups and spec §6.3 (≥24px bold only).

| Dimension | Score | Note |
|---|---|---|
| Accessibility | 3 → 4 | Contrast, targets and focus management are fixed (§3). Placeholder contrast (U8) is the remaining P2 |
| Performance | 3 | transform/opacity only; one rAF-throttled scroll handler; GIS is loaded `afterInteractive` with a fallback |
| Responsive | 2 → 4 | The 320px finish clipping (B1) is fixed; safe areas (N1) |
| Theming | 3 | `--pub-*` tokens; daypart overrides use some literal hexes (P2, as authored) |
| Implementation integrity | 4 | Product-specific; the honesty table holds (§7) |

P0: none. P1: all fixed (see the U*, N*, B* rows and the ✕ chips). P2 (recorded):
- M3–M7, U8, the theming literals.
- The dashboard banner's "Resend" button is pink #d9628c on white (3.46). It's dashboard inline style, outside the public-pages scope.
- The `.auth-hint` meter bars sit outside Field, with `marginTop: -8` (inline style).

## 7. Honesty re-check (spec §5.3) against the shipped landing

| Visual | Source verified | ✓ |
|---|---|---|
| "1.42 · Midterm GWA estimate" | `api/studypulse/stats/route.ts:378` `midtermGPA` | ✓ |
| Bars per subject | the subjects page's current grades (decorative, `aria-hidden`) | ✓ |
| "Calc 2 · need on what's left 78% · Achievable" | `src/lib/studypulse/projection.ts` | ✓ |
| "Quiz 4 · Fri" / "Already on your board" | `/api/canvas/*` sync + manual entries | ✓ |
| "₱420 safe to spend" | `api/finance/safe-to-spend/route.ts` | ✓ |
| "₱95 lunch logged in seconds" | `components/finance/log/LogComposer.tsx` | ✓ |
| "Org deck moved to Thursday" | `components/workboard/views/FocusWeekPicker.tsx` | ✓ |
| "Day 12 of your reading streak" | `components/habits/HabitsDashboard.tsx` streaks | ✓ |
| 1.0 / 4.0 scales | `src/lib/gradeScale.ts` | ✓ |
| GWA calculator reads a screenshot | `GwaCalculator.tsx` (tesseract) | ✓ |
| "Pulls deadlines from Canvas, if your school uses it" | `/api/canvas/*` | ✓ |
| Sample GWA 1.47 | (1.25·3 + 1.50·3 + 1.75·2) / 8 = 1.469 | ✓ |
| "Free for students" | no billing code (grep: no billing/stripe; "stripe" only appears as CSS class names) | ✓ |
| "Sign up in under a minute" | 4 fields, or Google plus 2 | ✓ |
| No ▲ / ↑, no "On track", no user counts, ratings or testimonials | DOM text scan: none | ✓ |
| "Sample data" tag on every product card | 2 cards, 2 visible tags | ✓ |

## 8. Extra fix list (controller ruling R28)

| # | Item | What changed | Verified |
|---|---|---|---|
| 1 | Meter vs bcrypt limit | `passwordStrength.ts`: over 72 UTF-8 bytes → `{ score: 1, label: 'Too long', hint: 'Use 72 bytes or fewer.' }`. PasswordField marks it `warn`. 3 new test cases (76 bytes; exactly 72 bytes is still Great; 37 × "ñ" = 74 bytes) | auth-test 23/23 |
| 2 | Field live region | `{id}-msg` (error, `aria-live="polite"`) and `{id}-hint` are always mounted, empty when unused (margin 0). The meter hint passes `hintLive={false}` → `aria-live="off"`. `aria-describedby` lists only the non-empty ones | live: regions present on load; password-hint `off` |
| 3 | GIS rendered nothing | After `renderButton`, if the host has no child after 1.5s → fall back to `GoogleButton`. The `cb.current` write moved into an effect | code + tsc (FedCM blocking can't be reproduced locally) |
| 4 | YearPicker | Home/End; `labelledBy` prop (default `year-label`) | live keyboard run |
| 5 | `.pub-sr` | + `margin:-1px; padding:0; border:0` | CSS |
| 6 | Google busy | LoginForm wraps the Google area in `.auth-google` with `aria-busy`/`aria-disabled`; CSS sets `pointer-events: none; opacity: .6`; "Use another account" is disabled too | live: computed `pointer-events: none` when busy |
| 7 | Night quiet links | `.auth-link--quiet` stays `--pub-mute` at night | live: rgb(180,172,203) at night |
| 8 | Stale verify link, verified user | `verify-email/page.tsx`: when the token fails, a signed-in user whose `email_verified_at` is set sees "Email confirmed." | live: verified user → "Email confirmed."; signed-out → "expired" |
| 9 | Moments settle on load | `is-arming` class for 2 frames with transitions off | live: 0 transitions at arming |
| 10 | VerifyEmailBanner | 200 → "Sent!"; 429 → cooldown; other status or a rejected fetch → "We couldn't send it just now. Please try again." with Resend still shown | live, with mocked 200/429/500/abort |
| 11 | Dashboard fails open | `findById(...).catch(() => null)` | tsc |
| 12 | Legal typography | `h2 { font-weight: 700 }`; h1 margin `8px 0 6px`; "Last updated" gets a 28px bottom margin | screenshot `privacy-*` |
| 13 | Privacy draft | Two new "What we store" lines: sign-in failure counts and account creation time "for security", and the older-account fields (date of birth, middle name, status, program; ask us to clear them). The DRAFT comment is kept. The columns were checked in `user_login` | screenshot |

## 9. Verification and cleanup

- `npx tsc --noEmit`: exit 0.
- `node scripts/auth-test.mjs`: 23 pass, 0 fail.
- `node scripts/sp-test.mjs`: 33 pass, 0 fail.
- Cleanup: `DELETE FROM user_login WHERE email LIKE 'qa+auth%@example.com' OR email='qa+google1@example.com'`. Orphan `auth_tokens`: 0. QA rows left: 0. (The test ticket identities were never created as users.)
