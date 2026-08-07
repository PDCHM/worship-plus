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
