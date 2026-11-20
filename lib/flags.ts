// ── Feature flags ───────────────────────────────────────────────────────────
// Build-time switches for features that are BUILT but not shipped. Nothing is
// deleted when a flag goes false: the component, handlers and API routes stay
// wired, so reviving a feature is a one-line change back to true — no
// archaeology through git history.

// Online chord search ("Search Online" in the add-song sheet). Hidden for the
// V1 launch: the underlying web sources are inconsistent enough that results
// were unreliable, and an import path that usually disappoints is worse than
// one that isn't offered. The sheet (SongSearchSheet), its handler
// (gatedSearchOnline) and the search API all remain in place; only the entry
// point is hidden. Flip to true once a dependable source is in hand.
export const FEATURE_ONLINE_SEARCH = false;

// AI chord generation (lyrics → chords via /api/generate-chords). Hidden for
// V1: results weren't reliable enough to ship. Every entry point is gated on
// this flag — the "AI Chords" add-song option, the editor's "Generate Chords"
// button, the per-section regenerate button, the auto-open after an AI paste,
// "Create with AI Chords" on search results, and the landing/pricing copy.
// The Generate Chords sheet, its handlers and the API route all stay in place.
// NOT affected: photo/screenshot import (/api/import-photo), which is a
// separate route and handler and stays fully on. Flip to true to revive.
export const FEATURE_AI_CHORDS = false;

// Free model: Worship+ is free for every worship team. Hides ALL paid-tier UI
// — the landing pricing table (replaced by a "free for every team" message),
// "subscribe"/"See plans" copy, the Settings Subscription panel, the account
// menu's plan badge, every Upgrade modal/CTA, and the post-login Stripe
// checkout resume. Also forces every plan gate open (canUse/teamMemberCap)
// independently of BETA_MODE. The tier definitions (lib/plans.ts), Stripe
// routes and UpgradeModal stay in the code; flip to false to bring paid
// plans back.
export const FREE_MODEL = true;

// Free beta: every user is treated as Church-tier for feature gating (AI chords,
// photo import, AI search, setlists, teams, calendar, unlimited team members).
// Read ONLY by canUse()/teamMemberCap() in lib/plans.ts, which both the client
// (usePlan) and the server AI gate (enforceAiAccess) go through — so this is
// the single switch. The plan/tier system and Stripe billing are untouched;
// flip to false at paid launch and normal paywalls resume.
export const BETA_MODE = true;
