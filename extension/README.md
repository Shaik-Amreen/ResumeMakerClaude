# ResumeMaker Resume Attach (Chrome extension)

Local companion for ResumeMakerClaude.

**Role:** Simplify (or you) fills the application. This extension attaches the **tracker-tailored PDF**. You click Submit.

## Load

1. Backend on `http://127.0.0.1:5002`
2. `chrome://extensions` → Load unpacked → this folder
3. Reload after updates (current: **0.9.3** / attach engine v21)

## Workflow

1. Fill form with **Simplify**
2. Open this side panel (auto-refreshes when you change tabs)
3. **Application Q&A** — scan custom questions, generate AI answer, fill or copy
4. **Attach resume** (confirms if using a fallback PDF)
5. Verify filename on the page
6. **You** click Submit
7. **Attach + mark applied** (or Mark applied) to sync the tracker

## Application Q&A

For prompts Simplify cannot answer (e.g. *What makes you excited about Koah?*):

1. **Scan page** — finds custom textareas (skips name, visa, LinkedIn, etc.)
2. Pick a question or paste your own
3. **Generate answer** — uses matched job JD + your profile (same LLM as cover letters)
4. Edit the draft, then **Fill field** or **Copy**
5. **Save to bank** — reuse in tracker Answer bank on similar questions

## Buttons

| Button | Purpose |
|---|---|
| Refresh | Backend + job match + resume availability |
| Attach resume | Inject matched (or latest ready) tracker PDF |
| Attach + mark applied | Attach, then set tracker status to applied |
| Mark applied | Update tracker status only |
| Generate cover letter | AI tailored letter for matched tracker job |
| Download cover letter | Save cover PDF for Additional Attachments |
| Open in tracker | Open matched job in app |
| Save page to tracker | If URL not matched yet |

## Never auto-submits
