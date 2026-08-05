# Agent profile conflict notes (Karthik)

Source files in `resume-assets/`:
- `Karthik_COMPLETE_CAREER_KNOWLEDGE_BASE.md` (primary)
- `Karthik_Master_Career_Profile.md`
- Standard template: `amazonResumeTemplate.tex`

## User overrides (take precedence over older KB text)

1. **Future sponsorship = No** (user 2026-08-03). KB said Yes/H-1B.
2. **Amazon dates = May 26, 2026 - Aug 14, 2026** (user + LinkedIn). Offer doc had Jun 15 - on/before Sep 4.
3. **Amazon bullets** = LinkedIn-public highlights only (Lambda/DynamoDB/SQS, CDK/CI/CD/CloudWatch, AI assistant skill). Do not invent confidential internal details.
4. **Desired salary = UNKNOWN** → form value `0` (do not invent $150k).
5. **GitHub** = `https://github.com/kovikarthik` from standard resume template (KB had UNKNOWN).
7. **Resume employers** = Amazon → ASI → Infobell only. **Redbee removed** from template.
8. **Bullets** = one **complete** printed line each (target 80 - 95 plain chars, max 95); ends with period; never mid-phrase cut. Pipeline humanizes AI buzzwords and finishes truncated tails.
9. **Design lock** = user Overleaf LaTeX (`amazonResumeTemplate.tex`): letterpaper 11pt Times, section titlerules, `\vspace{2pt}`, `\uline{\textbf{company}}`, Skills categories, Key Projects `\textbar`, exact itemize gaps.
10. **Header title** = short role only; **Open to Relocate** only if that line still fits.
11. **Bold map** = titles/companies/dates/tech+metrics/skill labels/project names; stacks after `\textbar` and header role stay unbolded.
12. **Content vs look** = tailor bullets/skills/projects per JD; never change margins, itemsep, or bold scheme.
13. **Length** = EXACTLY **1 page** (never 2). Pipeline auto-trims / rejects multi-page PDFs.
14. **Voice** = human template style (built/wrote/shipped/used…). No AI traces (expanded ban list).
15. **Adaptable coverage** = put ALL JD skills in Skills/tech lines even if not yet used; do NOT invent past-tense Experience for genuinely different unused skills.
16. **Same-concept substitution** = allowed (Postgres↔MySQL, Express↔Fastify, …); keep real metrics; different concepts stay Skills-only.

## Targeting

- Full-time SWE / new-grad / entry-level only
- MS CS @ CSULB, graduation January 2027
- F-1 → OPT; skip citizenship/clearance-only roles
