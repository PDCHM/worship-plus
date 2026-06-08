# Pre-launch Security Audit — Worship+

**Date:** 2026-06-09
**Scope:** Read-only review. No code or DB changes were made. Findings only; fixes are suggested, not applied.
**Legend:** ✅ OK · 🟡 REVIEW · 🔴 RISK

---

## Part A — Code review

### A1. Stripe webhook signature verification — ✅ OK
`app/api/stripe/webhook/route.ts` verifies the signature with
`stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` (line 57) against the **raw** body (`request.text()`, line 54), and **rejects** on failure with `400` (lines 58–63). It also returns `503` if `STRIPE_WEBHOOK_SECRET`/Stripe is unconfigured (47–48) and `400` if the `stripe-signature` header is absent (52). `runtime = "nodejs"` + `dynamic = "force-dynamic"` preserve the raw body. Forged "subscription active" events are rejected.
*Suggested:* none. (Optional hardening: idempotency on `event.id`, but not security-critical.)

### A2. Service-role key exposure — ✅ OK
`SUPABASE_SERVICE_ROLE_KEY` is read only in `lib/supabase/admin.ts` (`process.env.SUPABASE_SERVICE_ROLE_KEY` — not `NEXT_PUBLIC_`). `getAdminClient()` is imported by exactly four files, **all server-side route handlers**: `app/api/stripe/webhook`, `app/api/account/delete`, `app/api/account/export`, `app/api/support`. None is a `"use client"` component. No `NEXT_PUBLIC_*SERVICE_ROLE*` exists. The only other Supabase clients (`lib/supabase/server.ts`, `lib/supabase/client.ts`) use the anon key. The service-role key cannot reach the browser bundle.
*Suggested:* none.

### A3. `dangerouslySetInnerHTML` — ✅ OK
One occurrence: `app/layout.tsx:52`, rendering `themeScript` — a **static, hard-coded** string (the dark-mode bootstrap reading `localStorage`), defined at `layout.tsx:39` with no interpolation. No user-supplied content (no song titles/lyrics/notes/profile fields) is rendered via `dangerouslySetInnerHTML` anywhere. React's default escaping handles all user data elsewhere.
*Suggested:* none. (If a CSP is added — see A6 — this inline `<script>` will need a nonce or hash.)

### A4. AI routes — auth, plan check, rate limiting — 🔴 RISK
`app/api/generate-chords/route.ts` and `app/api/search-song/route.ts`:
- **No server-side auth check** — neither calls `supabase.auth.getUser()` / creates a server client. Any unauthenticated caller can POST.
- **No server-side plan check** — the paid-feature gate is **client-side only** (`SongEditor` `canUseAiChords={gate.canUse("ai_chords")}`); the route does not enforce it, so a direct API call bypasses the paywall.
- **No rate limiting** — neither route throttles per-user/IP.
- `generate-chords` has **no input-length cap** on `lyrics` (only `max_tokens: 16000` on output); `search-song` caps `query` at 400 chars.

**Why it matters:** both routes call the Anthropic API on every request. Anonymous, unmetered, unthrottled access = direct cost/abuse exposure (a script can burn your Anthropic spend and bypass the paywall).
*Suggested (do not apply now):* require an authenticated session in the route; enforce the plan/entitlement server-side (mirror `gate.canUse("ai_chords")`); add per-user/IP rate limiting (e.g. Upstash Ratelimit or Vercel BotID/Firewall); cap `lyrics` length.

### A5. Secrets hygiene — ✅ OK
`.env` and `.env.local` are git-ignored (`git check-ignore` confirms) and **no `.env*` file is tracked** (`git ls-files` shows none). A `git grep` of tracked files (excluding docs) for `sk_live_`/`sk_test_`/`whsec_`/`service_role`/hard-coded `ANTHROPIC_API_KEY=` etc. found **no hard-coded secret assignments** — all secret references are `process.env.*` or error strings. (Values were not printed.)
*Suggested:* none. (Routine: rotate any key ever pasted into chat/logs; the audit didn't surface any in-repo.)

### A6. Security headers — 🟡 REVIEW
`next.config.ts` defines **no `headers()`** and **no security headers**: no Content-Security-Policy, no `frame-ancestors`/`X-Frame-Options`, no `Strict-Transport-Security` (HSTS), no `X-Content-Type-Options`. There is also **no `middleware.ts`** adding headers. (Vercel terminates TLS and may add HSTS on custom domains, but nothing is enforced in-repo.)
**Why it matters:** without `X-Frame-Options`/`frame-ancestors`, the app can be framed (clickjacking); without `X-Content-Type-Options: nosniff` and a CSP, XSS blast radius is larger.
*Suggested (do not apply now):* add a `headers()` block in `next.config.ts` (or `vercel.ts`) with `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `Referrer-Policy: strict-origin-when-cross-origin`, and a CSP (start report-only; the inline theme script in A3 needs a nonce/hash).

---

## Part B — RLS policy review

**Status: COMPLETE** (analyzed from the live `pg_policies` / `relrowsecurity` dump). Headline: the `groups`/`profiles` read-wideners are confirmed, and the `group_members.gm_*` legacy policies are **far worse than "redundant"** — they have `USING (true)` predicates, giving any signed-in user full control of every team membership.

**Whole-table note:** every `true`-predicate exposure below is granted to the **`authenticated`** role (no `anon` SELECT exists anywhere — only `support_messages` allows an `anon` INSERT, by design). But since anyone can self-serve a free account (magic link / Google), "authenticated" ≈ "any attacker willing to sign up."

### B0. 🔴 CRITICAL — `group_members.gm_*` legacy policies are `USING (true)` (privilege escalation)
Four live-only policies on `group_members`, all role `authenticated`, **no scoping**:
| policy | cmd | USING | WITH CHECK |
|---|---|---|---|
| `gm_read`   | SELECT | `true` | — |
| `gm_insert` | INSERT | — | `true` |
| `gm_update` | UPDATE | `true` | `true` |
| `gm_delete` | DELETE | `true` | — |

Because policies are **OR-combined**, these completely override the intended `group_members_admin_*` / `_self_or_group_read` policies. Any authenticated user can:
- **read every membership row of every team** (all members' `email`, `display_name`, `instrument`, `user_id`);
- **insert themselves into any team as `owner`/`admin`** (`gm_insert` check `true`);
- **update any membership** — e.g. set their own `role = 'owner'` in someone else's team, or reassign `user_id` (`gm_update`);
- **delete any membership**, including kicking real owners (`gm_delete`).

This is full read/write takeover of the team system. **This is the top fix.**
*Suggested (do not apply):* drop `gm_read`, `gm_insert`, `gm_update`, `gm_delete`; keep `group_members_admin_*` and `group_members_self_or_group_read`. (Verify no live data was already tampered.)

### B1. `profiles_public_read` — 🔴 RISK (confirmed)
`profiles.profiles_public_read` = SELECT, role **`authenticated`**, `USING (true)`. Any signed-in user can read **all rows** of `profiles`, including every user's **`email`** and **`stripe_customer_id`** (plus `full_name`, `plan`). `schema.sql` intends self-read only (`profiles_self_read`); this policy nullifies that.
*Suggested:* drop `profiles_public_read` (keep `profiles_self_read`). If a public-facing subset is genuinely needed (e.g. display names for shared songs), expose it via a dedicated view/RPC selecting only non-sensitive columns — never table-wide RLS `true` (RLS can't restrict columns).

### B2. `groups_authenticated_read` — 🔴 RISK (confirmed)
`groups.groups_authenticated_read` = SELECT, role **`authenticated`**, `USING (true)`. Any signed-in user can read **every group row**, including **`invite_token`** (the secret `/join/[token]` slug) and the legacy `join_code`. Combined with `gm_insert`/`accept_invite`, an attacker can enumerate all teams and join any of them — the invite model provides no protection.
*Suggested:* drop `groups_authenticated_read` (keep `groups_member_read`); the `lookup_invite`/`accept_invite` SECURITY DEFINER RPCs already gate join-by-token safely.

### B3. Legacy `songs` / `sections` / `lines` / `chords` "Users can …" policies — 🟡 REVIEW (no widening)
These legacy policies use role `public` (all roles) **but are predicate-gated to the owner** (`auth.uid() = user_id`, or an EXISTS join to `songs.user_id = auth.uid()`). For `anon`, `auth.uid()` is null so they match nothing — **no real widening** beyond the named `*_owner_all` / `*_via_*` policies. They're redundant clutter, not a hole.
*Suggested:* drop in the cleanup phase (keep the named set). Low priority.

### B4. Tables with RLS disabled — ✅ OK
All 13 public tables report `relrowsecurity = ENABLED`. None disabled. (`force=off` on all is normal — it only means the table owner/service-role bypasses RLS, which is expected and not exposed to API roles.)

> Note: this supersedes the drift report's earlier characterization of `gm_*` as harmless "redundant duplicates" — the live `USING (true)` makes them a critical hole, not clutter.

---

## Verify-in-dashboard items (not readable from the repo)

- 🟡 **Supabase Auth redirect-URL allowlist** — confirm only your real origins (prod domain + localhost) are allowed, so magic-link/OAuth callbacks can't be redirected to an attacker origin.
- 🟡 **Supabase Auth email/OTP rate limits** — confirm sane caps so the magic-link sender can't be abused for spam/cost.
- 🟡 **Anthropic / Stripe key scoping & spend caps** — confirm Anthropic usage limits (mitigates A4) and that Stripe keys are restricted where possible.

---

## Prioritized fix order (suggested — nothing applied)

1. **🔴 B0 `group_members.gm_*` (`USING true`)** — full takeover of every team membership (read all PII; insert self as owner; update/delete any member). Drop the four `gm_*` policies. **Most severe; fix first.** Also check whether any membership data was already tampered.
2. **🔴 B1 `profiles_public_read`** — drop it; stops every signed-in user reading all users' `email` + `stripe_customer_id`.
3. **🔴 B2 `groups_authenticated_read`** — drop it; stops exposure of every group's `invite_token`/`join_code` (protects the invite model).
4. **🔴 A4 AI routes** — add server-side auth + plan enforcement + rate limit + input cap. Direct cost/paywall-bypass exposure.
5. **🟡 A6 Security headers** — add `headers()` (frame-ancestors, nosniff, HSTS, CSP report-only).
6. **🟡 B3 legacy `songs/sections/lines/chords` "Users can …" policies** — predicate-gated, no widening; remove in cleanup.
7. **🟡 Dashboard items** — verify redirect allowlist, auth email/OTP rate limits, AI spend caps.

> Items A1, A2, A3, A5, B4 are ✅ OK — no action.
>
> **The top 3 (B0/B1/B2) are RLS policy drops that can be applied together in one reviewed migration** — all are "drop the live-only over-permissive policy, keep the schema.sql-defined one." They overlap with the cleanup phase already noted in `docs/db-drift-report.md`, but B0 in particular should not wait for a general cleanup pass.
