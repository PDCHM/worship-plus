<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Known Limitations

- **Read-only songs**: musicians opening songs shared via `group_songs` or setlists can read fine but save attempts are silently rejected by RLS. Fix eventually with a read-only badge or disabled save button on songs where `userId !== currentUser.id`.

## Development Protocol

### Before touching any code
1. Read all files relevant to the task first
2. Grep for every symbol/column/function the UI references — confirm it exists in the schema and vice versa
3. Surface ALL mismatches before writing a single line
4. Never assume a column exists because the UI uses it

### Architecture rules
- Join flows and any operation that uses URL parameters must use SECURITY DEFINER RPCs — never direct client SELECT/UPDATE through RLS
- Schema is the source of truth — if UI and schema disagree, flag it and get confirmation before proceeding
- All data loaders must select every column the UI mapper uses — no hardcoded nulls

### Commander/Executor split
- This repo is executed by Claude Code but commanded via a separate Claude chat session
- Claude Code's job: read files, flag mismatches, execute instructions, surface side-effects before they happen
- When given a direct unambiguous command (fix, commit, push, edit X to Y), execute immediately — do not ask for confirmation or present options
- Only ask when there is genuine ambiguity about *what* to build or a decision that affects architecture or data (schema changes, RLS shifts, destructive migrations, choosing between materially different approaches)
- Commit message selection is never a reason to pause — always pick the most descriptive message that matches the actual diff and proceed

### Debugging
- Before adding any policy or workaround, verify the root cause is understood
- If the same fix has been tried 3+ times without success, stop and re-examine assumptions
- RLS failures are often schema mismatches in disguise — check columns first
