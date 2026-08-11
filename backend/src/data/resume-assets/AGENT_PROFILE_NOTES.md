# Agent profile conflict notes (Karthik)

Source files in `resume-assets/`:
- `Karthik_COMPLETE_CAREER_KNOWLEDGE_BASE.md` (primary)
- `Karthik_Master_Career_Profile.md`
- Standard template: `amazonResumeTemplate.tex`

## User overrides (take precedence over older KB text)

1. **Future sponsorship = Yes (H-1B)**; **ambiguous / now-or-future = Yes**; **now = No** (OPT). Skip JDs with no sponsorship / auth without sponsorship. (2026-08-10 follow-up superseded older “future No” and “ambiguous No”.)
2. **Desired salary = $120,000–$170,000** (forms use range; fallback Negotiable/N/A if required and range cannot be entered). No salary-floor skip.
3. **Amazon dates = May 26, 2026 - Aug 14, 2026** (user + LinkedIn). Offer doc had Jun 15 - on/before Sep 4.
4. **Amazon bullets** = LinkedIn-public highlights only (Lambda/DynamoDB/SQS, CDK/CI/CD/CloudWatch, AI assistant skill). Do not invent confidential internal details.
5. **GitHub** = `https://github.com/kovikarthik` from standard resume template (KB had UNKNOWN).
6. **Willing to relocate = Yes**; start date text = January 2027; notice = 0 after graduation. Street/ZIP Long Beach = UNKNOWN.
7. **Resume employers** = Amazon → ASI → Infobell only. **Redbee removed** from template.
8. **Bullets** = one **complete** printed line each (target 80 - 95 plain chars, max 95); ends with period; never mid-phrase cut. Pipeline humanizes AI buzzwords and finishes truncated tails.
9. **Design lock** = user Overleaf LaTeX (`amazonResumeTemplate.tex`): letterpaper 11pt Times, section titlerules, `\vspace{2pt}`, `\uline{\textbf{company}}`, Skills categories, Key Projects `\textbar`, exact itemize gaps.
10. **Header title** = EXACTLY 3 lines (Name / Title+Contact / Links); prune low-priority details (Relocate, Location, Portfolio) on overflow.
11. **Bold map** = titles/companies/dates/tech+metrics/skill labels/project names; stacks after `\textbar` and header role stay unbolded.
12. **Content vs look** = tailor bullets/skills/projects per JD; never change margins, itemsep, or bold scheme.
13. **Length** = EXACTLY **1 page** (never 2). Pipeline auto-trims / rejects multi-page PDFs.
14. **Voice** = human template style (built/wrote/shipped/used…). No AI traces (expanded ban list).
15. **Adaptable coverage** = put ALL JD skills in Skills/tech lines even if not yet used; do NOT invent past-tense Experience for genuinely different unused skills — **except** the systems coursework override below.
16. **Same-concept substitution** = allowed (Postgres↔MySQL, Express↔Fastify, …); keep real metrics; different concepts stay Skills-only.
17. **B.Tech systems coursework (user 2026-08-07)** = Operating Systems, Computer Architecture, and Networking were taken in bachelor's with solid working knowledge. **Fabricate** concrete evidence into Key Projects (prefer CloudSync, RenderSync, MirrorMate) and/or Infobell bullets when a JD requires them. Listing under Skills alone does **not** count for keyword match.
18. **Portal accounts (user 2026-08-07)** = For ATS/career sign-up & login walls (AppOne, Workday, etc.), use `APPLY_PORTAL_EMAIL` / `APPLY_PORTAL_PASSWORD` / `APPLY_PORTAL_USERNAME=karthikkovi01` from `.env` (same credentials for every posting). Fetch email security codes from Gmail in orange Chrome when asked. Never invent a different email per job.
19. **Apply path (user 2026-08-07)** = Career apply uses **orange Chrome + applicationProfile only**. Do **not** open Claude/green Chrome mid-apply to tailor answers — resume tailoring already happened. `APPLY_USE_AI` defaults to false.
20. **Apply AI Manager (user 2026-08-07)** = When heuristics stall mid-apply, an **API-only** manager (`APPLY_MANAGER`, OpenRouter then Ollama) returns one JSON action (`click` / `login` / `fill` / `upload_resume` / `next` / `await_submit` / `hold`). Orange Chrome executes it. Passwords never go to the LLM — `login` uses portal env creds. Human **Approve Submit** stays mandatory. Never open claude.ai for apply steps.
21. **Orange Chrome profile (user 2026-08-07)** = Always **karthik** / `karthikkovik@gmail.com` = `ORANGE_PROFILE_DIR=Profile 1` under `.orange_chrome_automation`. Cookie source = daily Chrome `ORANGE_SOURCE_PROFILE_DIR=Profile 7` (Apply Jobs). Never Default / Profile 26 / Your Chrome.
22. **Resume Attach extension (user 2026-08-10)** = Preferred apply companion: Chrome MV3 in `extension/` attaches the **tracker-tailored PDF** (+ optional cover letter text/PDF) after Simplify fills the form; **you** click Submit. Never auto-submit. Selenium career apply remains available via tracker for optional automation.
23. **Education lock (user 2026-08-10)** = MS @ California State University, Long Beach + B.Tech @ JNTU Anantapur - MITS only. Pipeline `forceCanonicalEducation` rewrites invented schools (e.g. San Jose State).
24. **Fabrication policy (user 2026-08-10 + follow-up)** = See `FABRICATION_POLICY.md`. NEVER invent employers/titles/dates/schools/contact/URLs. Ban Go entirely. Do not fabricate Docker/microservices/GraphQL/K8s/Kafka/etc. OPEN: allowed Skills, Certs, ≤2 projects (CloudSync + RenderSync). Pipeline locks experience headers.
25. ~~Apply Assist Phases 2–7~~ = **Superseded** by Resume Attach (note 22). Fill adapters / side-panel tabs / `/api/extension/answers*` / `/jobs/recent` removed from the attach-only companion. Answer bank lives at `/api/answers` for the tracker UI.

## Targeting

- See `TARGETING_BRIEF.md` + `candidateTargeting.ts` (2026-08-10 + follow-up).
- Prioritize full-time New Grad 2027 SWE; backend/full-stack/cloud/distributed/platform/APIs/AWS/Java/Python/React/Node/Spring.
- Keep frontend-only, RN, Data Engineer; ML/Solutions only if software/coding-heavy.
- Skip internships, C2H, part-time/seasonal, crypto-only, senior (even with New Grad), 5+ YoE; keep 0–5 and 3–5 ranges.
- FAANG/MANGO (incl. Coinbase/Shopify/TikTok/Roblox): alert only — never auto-apply without review.
- Dedup: same company + similar title; official > LinkedIn > ATS > boards.
