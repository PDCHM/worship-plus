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

**Status: PENDING live query.** A read-only query (`db-policies.sql`) was generated and copied to the clipboard; it returns each public table's `relrowsecurity` status and every policy's `cmd/roles/USING/WITH CHECK`. This section will be finalized once the live result is pasted back. Below is what is already known from the earlier drift audit (`docs/db-drift-report.md`) and what each item will confirm.

### B1. `profiles_public_read` — 🔴 RISK (confirm exact role + predicate)
A live-only SELECT policy on `profiles` (not in `schema.sql`, which intends **self-read only** via `profiles_self_read`). `profiles` holds `email`, `full_name`, `avatar_url`, **`stripe_customer_id`**, `plan`, `plan_expires_at`, `trial_ends_at`. If its `USING` is broad (e.g. `true`) and it is granted to `anon` and/or `authenticated`, it exposes **other users' email and Stripe customer id** to anyone signed in (or worse, anonymously).
*Confirm via `db-policies.sql`:* exact `roles` (anon vs authenticated) and `qual`. *Suggested fix:* drop it, or scope it to the minimum columns/rows actually needed (note: column-level scoping requires a view/`GRANT`, not RLS — RLS is row-level).

### B2. `groups_authenticated_read` — 🟡 REVIEW→likely 🔴 RISK
A live-only SELECT policy on `groups` (schema.sql intends member-only read via `groups_member_read`). `groups` holds **`invite_token`** (the secret slug behind `/join/[token]`) plus the legacy `join_code`. If this policy is `using (true)` to `authenticated`, **any signed-in user can read every group's `invite_token`/`join_code`** and self-join arbitrary teams — defeating the invite model.
*Confirm via `db-policies.sql`:* `roles` + `qual`; specifically whether it exposes `invite_token`. *Suggested fix:* drop it; rely on `groups_member_read` + the `lookup_invite`/`accept_invite` SECURITY DEFINER RPCs which gate on the token.

### B3. Overlapping/duplicate policy sets (songs, chords, lines, sections, group_members) — 🟡 REVIEW
The drift audit found legacy permissive policies coexisting with the named ones (`songs."Users can …"` ×4, `sections/lines/chords."Users can manage …"`, `group_members.gm_*` ×4). **RLS policies are OR-combined**, so the *effective* access is the union. These legacy ones are owner-scoped (`user_id = auth.uid()`)-style, so they should not widen access beyond the named owner policies — **but** this must be verified against the live `USING`/`WITH CHECK`: any one of them with a `true` or broader predicate would silently widen access for that command.
*Confirm via `db-policies.sql`:* that every overlapping policy's predicate is owner/membership-scoped, none is `true`. *Suggested fix:* after confirming redundancy, drop the legacy duplicates in the cleanup phase (keep the named `*_owner_all` / `*_via_*` set).

### B4. Tables with RLS disabled — 🟡 REVIEW (pending)
The query reports `relrowsecurity` per table. Expected: all 13 public tables ENABLED (schema.sql enables RLS on each). Any `DISABLED` row = RISK (table fully readable/writable through the anon/authenticated PostgREST API). To be confirmed from the result.

---

## Verify-in-dashboard items (not readable from the repo)

- 🟡 **Supabase Auth redirect-URL allowlist** — confirm only your real origins (prod domain + localhost) are allowed, so magic-link/OAuth callbacks can't be redirected to an attacker origin.
- 🟡 **Supabase Auth email/OTP rate limits** — confirm sane caps so the magic-link sender can't be abused for spam/cost.
- 🟡 **Anthropic / Stripe key scoping & spend caps** — confirm Anthropic usage limits (mitigates A4) and that Stripe keys are restricted where possible.

---

## Prioritized fix order (suggested — nothing applied)

1. **🔴 B1 `profiles_public_read`** — stop exposing email/`stripe_customer_id`. Highest privacy impact. *(Pending exact role/qual.)*
2. **🔴 B2 `groups_authenticated_read`** — stop exposing `invite_token`; protects the team-invite model. *(Pending exact role/qual.)*
3. **🔴 A4 AI routes** — add server-side auth + plan enforcement + rate limit + input cap. Direct cost/paywall-bypass exposure.
4. **🟡 A6 Security headers** — add `headers()` (frame-ancestors, nosniff, HSTS, CSP report-only).
5. **🟡 B3 legacy duplicate policies** — confirm none widen access, then remove in cleanup.
6. **🟡 Dashboard items** — verify redirect allowlist, auth rate limits, AI spend caps.

> Items A1, A2, A3, A5 are ✅ OK — no action.
