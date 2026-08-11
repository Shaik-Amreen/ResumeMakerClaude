# ResumeMaker Resume Attach (Chrome extension)

Local companion for ResumeMakerClaude.

**Role:** Simplify (or you) fills the application. This extension attaches the **tracker-tailored PDF**. You click Submit.

## Load

1. Backend on `http://127.0.0.1:5002`
2. `chrome://extensions` → Load unpacked → this folder
3. Reload after updates (current: **0.8.8** / attach engine v18)

## Workflow

1. Fill form with **Simplify**
2. Open this side panel (auto-refreshes when you change tabs)
3. **Attach resume** (confirms if using a fallback PDF)
4. Verify filename on the page
5. **You** click Submit
6. **Attach + mark applied** (or Mark applied) to sync the tracker

## Buttons

| Button | Purpose |
|---|---|
| Refresh | Backend + job match + resume availability |
| Attach resume | Inject matched (or latest ready) tracker PDF |
| Attach + mark applied | Attach, then set tracker status to applied |
| Mark applied | Update tracker status only |
| Open in tracker | Open matched job in app |
| Save page to tracker | If URL not matched yet |

## Never auto-submits
