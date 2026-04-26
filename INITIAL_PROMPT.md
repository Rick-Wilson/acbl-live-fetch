# Initial Prompt for Claude Code

Copy and paste this into Claude Code as your first message after `cd`'ing into the new repo.

---

I'm starting a new browser extension project to gather bridge game data from supported sites and hand it to my analyzer at bridge-classroom.com.

The repo has been scaffolded with documentation but no code yet. Please:

1. Read `CLAUDE.md` for project context and conventions
2. Read all files in `docs/` — `architecture.md`, `acbl-live-format.md`, and `normalized-schema.md`
3. Read `START_HERE.md` for your specific first task

Then check whether `fixtures/acbl-live/` contains the HTML fixtures mentioned in `START_HERE.md`. If those fixtures exist, proceed with the first task — set up the project skeleton (npm init, vitest, prettier), write `parseBoardDetail()` against the real fixture, and write tests that prove it works.

If the fixtures aren't there yet, stop and let me know — I'll capture them and let you know when they're ready.

Please ask before making architecture decisions that aren't already covered in the docs. Keep commits small and focused. Don't run ahead to the manifest, service worker, or UI yet — get the parser working with tests first.
