# PC Agent

A personal background agent for Windows. It keeps your long- and short-term goals and tasks, checks in on a schedule it chooses itself, and **proposes** changes. Nothing that changes state runs until you approve it.

## How it works

- **Tray app, starts at sign-in.** Closing the window hides it to the tray; the agent keeps running.
- **Check-ins.** A 30-second timer first does free work: due-task toasts, review reminders and the daily digest. When the planned wake time arrives it checks whether anything changed since the last AI call (task or goal edits, approvals or rejections, tasks becoming due). If nothing did, it skips the AI call entirely.
- **AI call.** It sends a fixed system prompt plus a compact state summary (titles only, capped lists, about 100–400 tokens) and gets back one JSON object: proposals, an optional short message, the next check-in time, and a note to itself.
- **AI-chosen schedule.** The model picks when to check back. Code clamps that to your shortest and longest gap and moves it out of quiet hours.
- **Review queue.** Proposals carry an urgency. Urgent ones toast every 15 minutes, high every hour, and normal ones go into the daily digest. You can approve or reject a single action, a selection, or a whole session, or edit an action's arguments first. Exact repeats of pending or recently rejected proposals are dropped automatically.
- **Cost control.** Each provider has its own key (encrypted with Windows DPAPI via Electron `safeStorage`). There are separate cheap *wake* and *chat* model slots, a hard per-reply output cap, and daily and monthly USD and daily token caps checked against a worst-case estimate before every call. Every call is logged with its tokens and cost.

## About me and projects

- **No personal data ships with the app.** First run shows a Welcome screen to write a profile or import an `about-me.json`. About me has Export / Import buttons; keep your export outside the repo (`about-me*.json` is git-ignored).
- **Profile** (About me): two or three lines sent with every call, inside the fixed system prompt.
- **Projects**: name plus notes. Goals and tasks can be linked to a project. Chat gets every active project's notes; check-ins get notes only for projects with tasks due within 24 hours, so routine check-ins stay small. Import merges by project name.

## Browser (phase 2)

- The agent has its **own** Chrome/Edge profile (`%APPDATA%\PC Agent\browser-profile`), separate from yours. Logins you make in its window stay there.
- **Reading** (no approval): the model can return `read: [urls]`. Pages are fetched headless and returned as compact text plus a list of visible controls, then the model replies again. Limits: pages per round, rounds per turn, characters per page. Check-ins can't read unless you enable it.
- **Acting** (approval required): `browser.do` runs click / fill / press / wait steps in a visible window, leaves the page open, and saves a screenshot linked from the review history. `browser.open` opens a URL in your normal browser.
- Page text is marked as untrusted and the model is told not to follow instructions in it; even if it did, it can only propose.

## PC access (phase 3)

All of these are proposals that run only after approval:

- `pc.run {cmd, cwd?}`: PowerShell, hidden, with a timeout (Settings). Output goes back to the model at the next turn. Commands matching risky patterns (delete, registry, shutdown, downloads...) are flagged with a warning in the review queue.
- `pc.open {target}`: open a file or folder with its default app, or start an app by name.
- `file.write` (create / overwrite / append), `file.mkdir`, `file.move`, `file.copy`, `file.trash`. There is no permanent delete: trash goes to the Recycle Bin, and move/copy refuse to overwrite.

Reading local files needs no approval but only works inside folders you add under Settings > PC access. Files that usually hold secrets (.env, keys, certificates) are never read. Every proposal has a Details toggle showing its exact arguments (command, file text) before you approve.

## Add-ons (phase 4)

Add-ons are built into the app (nothing is loaded from outside) and are switched on and configured on the Add-ons page. Secret fields are stored encrypted, separate from settings. An add-on (`src/main/addons/`) can provide:

- `fields`: its settings form;
- `actions`: proposal-only actions, hidden from the model while the add-on is off;
- `digest(mode)`: a few compact lines for the state summary;
- `hasNews()`: a cheap check so idle check-ins stay free;
- `reader`: items the model may read, e.g. `mail:m3`, which can refuse in check-ins;
- `test()`: the Test connection button.

Register a new add-on in the `ADDONS` list in `src/main/addons/index.ts`.

### Mail reader

Connects to your mail reader backend (API URL configurable, default `https://readapi.aihunar.com`) with its username and password.

- Check-ins see sender and subject of up to N "to react" emails as short refs (`m1`, `m2`, …, about 20 tokens each). A new email counts as news and wakes the agent; no new mail means no AI call.
- Full email text is readable only in chat (`mail:m3`) and is marked as untrusted.
- Proposals (approval required): `mail.handled` (local flag only, never touches the mailbox), `mail.task` (task linked to the email), `mail.open`, `mail.sync`. Each proposal stores the email's sender and subject, so it still reads correctly after the list changes.
- "Fetch new mail before each check-in" is off by default.

## Providers

Anthropic, OpenAI, Google Gemini, OpenRouter and Ollama (local, free). Claude prices are pre-filled; enter other models' prices in Settings so the dollar caps can protect them (the token cap always applies).

## Develop

```bash
npm install
npm run dev        # hot-reload dev app
npm run typecheck
npm run dist       # build release/PC Agent Setup <version>.exe
```

Data lives in `%APPDATA%\PC Agent\agent.db` (SQLite via Node's built-in `node:sqlite`, so there are no native modules).

## Extending (add-ons)

Actions live in `src/main/actions/`. Register one with `registerAction({ name, sig, schema, label, execute })`:

- `sig` is the one-line signature sent to the model. Keep it short; it is part of every call.
- `label` is the human-readable description shown in the review queue.
- `execute` runs **only** after the user approves.

## Layout

```
src/main/       agent loop, scheduler, reminders, providers, DB, IPC, tray
src/preload/    the typed bridge (window.agent)
src/renderer/   React UI: Home, Review, Chat, Goals & Tasks, Log, Settings
src/shared/     types shared by both sides
```
