# Fabrication policy (Karthik resume)

Update this file when the rules change. Pipeline + prompts must match.

## NEVER fabricate (locked truth)

| Field | Locked value |
|---|---|
| Name / contact / links | Karthik Kovi + template header |
| Employers (order) | Amazon → Associated Students, Inc. (ASI) - CSULB → Infobell IT Solutions Pvt Ltd |
| Titles | Software Engineer Intern / Software Engineer / Software Engineer |
| Locations | Bellevue, WA / CSULB / (Infobell as template) |
| Employment dates | `05/2026 - 08/2026` · `02/2025 - Present` · `01/2023 - 01/2025` |
| Education | CSULB MS + JNTU B.Tech (GPA, locations, dates) |
| Live project URLs | NativeNest, Arikya, Job Tracker store URLs — never invent/change |
| Fake employers | Never invent (e.g. “Advanced Systems Inc”, Redbee) |

Mechanical guards: `forceCanonicalEducation`, `forceCanonicalExperienceHeaders`.

## MAY adapt (not invent employers)

- **Experience bullet wording** — emphasize real work for JD fit; Amazon = LinkedIn-public only. Do **not** change titles/dates/companies/locations.
- Do **not** invent a 4th employer or replace ASI/Infobell with a JD company name.

## OPEN to fabricate / tailor

1. **Skills** — reorder and add **allowed** JD technologies on Skills lines. Do-not-fabricate items: Skills only if already supported by real experience/template — never invent project/experience bullets for them.
2. **Certifications** — keep template certs; may add/adjust `Name - Year` lines for JD fit (template style).
3. **At most 2 projects** — prefer **CloudSync** and **RenderSync** for fabricated features/metrics/systems (OS / architecture / networking) using **allowed** stacks only.

## Do NOT fabricate (even in the 2 open projects)

Never invent production experience with:

Kubernetes / production Kubernetes · Kafka / production Kafka · Terraform · **Go/Golang (ban entirely)** · Rust · C++ · .NET · Azure · GCP · Spark · Hadoop · Scala · TensorFlow · PyTorch · LLM training · **production ML model training** · MLOps · Blockchain/Web3 · Salesforce · SAP · Ruby on Rails · native Swift (iOS) · native Kotlin (Android) · **security clearance** · **Docker** · **microservices** · **GraphQL**

(Docker / microservices / GraphQL: use only if already supported by real experience or template — no new fabricated project claims.)

## Prefer evidencing (priority order)

Java → AWS → Python → React → Node.js → Spring Boot → REST APIs → TypeScript/JavaScript → CI/CD → PostgreSQL/MySQL/MongoDB/Redis

Also OK when true: React Native, Express, AWS Lambda/DynamoDB/SQS/CDK/CloudWatch, GitHub Actions, HTML/CSS/Tailwind, unit/integration testing, API design, full-stack / backend / distributed / cloud-native systems.

## Not open

- Inventing new employers, schools, degrees, GPAs, employment dates, or contact info.
- Fabricating features across all 5 projects (cap = 2).
- Putting resume PDF content into cover letter under a false identity (separate extension concern).
