import { Agent, fetch as undiciFetch } from 'undici';
import Job from '../models/Job';
import type { ContactSuggestion } from '../models/Job';
import { config } from '../config';
import { cleanJobDescriptionForResume } from './cleanJobDescription';
import { buildOllamaChatRequest, readOllamaChatContent } from './ollamaService';
import { openRouterChatCompletion } from './resumeAgent/openRouterProvider';

const CANDIDATE = {
  name: 'Karthik Kovi',
  school: 'California State University, Long Beach',
  degree: 'MS Computer Science (graduating January 2027)',
  focus: 'full-time software engineering roles',
};

function fallbackRecruiterMessage(title: string, company: string, recruiterName?: string): string {
  const greeting = recruiterName ? `Hi ${recruiterName.split(' ')[0]}` : 'Hi';
  return `${greeting} — I am currently pursuing my M.S. in Computer Science at California State University, Long Beach and have 3+ years of professional full-stack software engineering experience. I am actively looking for full-time Software Engineer opportunities beginning around my graduation in January 2027. I would love to connect and learn more about the ${title} role at ${company}. Thank you!`;
}

function fallbackCoverLetter(title: string, company: string): string {
  return `Dear Hiring Team,

I am applying for the ${title} role at ${company}. I am an M.S. Computer Science student at California State University, Long Beach (CSULB), graduating in January 2027, and I am seeking a full-time Software Engineer position where I can contribute strong full-stack and systems skills on production software.

As a Software Engineer Intern at Amazon, I built batch data remediation on AWS Lambda, DynamoDB, and SQS, automated infrastructure with AWS CDK and CI/CD, and shipped an AI assistant skill for operational workflows. At Associated Students, Inc. at CSULB and Infobell IT Solutions, I delivered accessible web and mobile products used by thousands of users while improving performance and deployment reliability.

I am excited about ${company}'s work and would welcome the chance to discuss how I can contribute. Thank you for your time and consideration.

Sincerely,
Karthik Kovi`;
}

function fallbackContacts(company: string, title: string): ContactSuggestion[] {
  return [
    {
      title: 'Technical Recruiter',
      linkedinSearchQuery: `${company} technical recruiter software engineer`,
      notes: 'Search on LinkedIn and connect with a short note after applying.',
    },
    {
      title: 'University Recruiting / Early Career',
      linkedinSearchQuery: `${company} university recruiting new grad software engineering`,
      notes: 'Early-career recruiters often prioritize new-grad / university hire pipelines.',
    },
    {
      title: 'Hiring Manager (Engineering)',
      linkedinSearchQuery: `${company} engineering manager ${title.split(' ').slice(0, 3).join(' ')}`,
      notes: 'Optional — only message if you have a strong mutual connection or referral.',
    },
  ];
}

async function callOllamaForText(system: string, user: string): Promise<string> {
  if (config.resumeAgent.provider === 'openrouter') {
    try {
      return await openRouterChatCompletion([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], { work: 'Outreach' });
    } catch {
      /* fallback to local Ollama if OpenRouter fails */
    }
  }

  const waitMs = 15_000; // 15-second timeout max for outreach artifacts
  const agent = new Agent({
    headersTimeout: waitMs,
    bodyTimeout: waitMs,
    connectTimeout: 5_000,
  });

  const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      buildOllamaChatRequest(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { numPredict: 1024, temperature: 0.3 }
      )
    ),
    dispatcher: agent,
  })) as Response;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama outreach error: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string; thinking?: string };
    done_reason?: string;
  };
  return readOllamaChatContent(data);
}

function parseContactJson(raw: string): ContactSuggestion[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as ContactSuggestion[];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** Generate cover letter, LinkedIn message draft, and contact suggestions for one job. */
export async function generateOutreachArtifacts(jobId: string): Promise<void> {
  const job = await Job.findById(jobId);
  if (!job) return;

  const jd = cleanJobDescriptionForResume(job.jobDescription);
  const system = `You help a job applicant write outreach. Candidate: ${CANDIDATE.name}, ${CANDIDATE.degree}, ${CANDIDATE.focus}. Be concise, professional, authentic. No fake employers or credentials.`;

  console.log(`\n✉️  Outreach artifacts: ${job.title} @ ${job.company}`);

  try {
    const coverLetter = await callOllamaForText(
      system,
      `Write a tailored cover letter using a popular ATS-friendly template (Harvard/Indeed style).

STRICT FORMAT — output ONLY this structure, nothing before the salutation:
Dear Hiring Team,

[Paragraph 1: state the exact role + company, who you are — M.S. CS at California State University, Long Beach (CSULB), graduating January 2027 — and why you are applying. 2–4 sentences.]

[Paragraph 2: 1–2 concrete accomplishments from Amazon internship, ASI at CSULB, and/or Infobell that match the JD. No fake employers or invented credentials. 3–5 sentences.]

[Paragraph 3: why this company/team + polite close asking to discuss. 2–3 sentences.]

Sincerely,
Karthik Kovi

Rules:
- Start with exactly "Dear Hiring Team," — never "Dear Hiring Manager", never a contact header, never a recipient address block, never the job title as a header line.
- Under 280 words. Plain text only. No markdown.
- Mention CSULB (or California State University, Long Beach) once.

Role: ${job.title}
Company: ${job.company}
Job description excerpt:
${jd.slice(0, 4000)}`
    );
    const { normalizeCoverLetterBody } = await import('./coverLetterPdf');
    job.coverLetterDraft = normalizeCoverLetterBody(
      coverLetter || fallbackCoverLetter(job.title, job.company),
      { title: job.title, company: job.company }
    );
  } catch (err) {
    console.warn('  Cover letter fallback:', err instanceof Error ? err.message : err);
    const { normalizeCoverLetterBody } = await import('./coverLetterPdf');
    job.coverLetterDraft = normalizeCoverLetterBody(fallbackCoverLetter(job.title, job.company), {
      title: job.title,
      company: job.company,
    });
  }

  try {
    const message = await callOllamaForText(
      system,
      `Write a short LinkedIn connection note (under 280 characters if possible, max 400) to a recruiter at ${job.company} about the ${job.title} role. Mention MS CS at CSULB, 3+ years full-stack experience, and full-time Software Engineer interest starting around January 2027 graduation. Output only the message text.`
    );
    job.recruiterMessageDraft =
      message || fallbackRecruiterMessage(job.title, job.company, job.recruiterName);
  } catch {
    job.recruiterMessageDraft = fallbackRecruiterMessage(
      job.title,
      job.company,
      job.recruiterName
    );
  }

  if (job.recruiterName) {
    const existing: ContactSuggestion[] = job.contactSuggestions?.length
      ? [...job.contactSuggestions]
      : [];
    const hasRecruiter = existing.some((c) => c.name === job.recruiterName);
    if (!hasRecruiter) {
      existing.unshift({
        name: job.recruiterName,
        title: 'Job poster / recruiter (from listing)',
        linkedinSearchQuery: job.recruiterProfileUrl || `${job.recruiterName} ${job.company}`,
        notes: job.recruiterProfileUrl
          ? 'Profile URL scraped from job listing — message after applying.'
          : 'Search this name on LinkedIn at the company.',
      });
      job.contactSuggestions = existing;
    }
  }

  if (!job.contactSuggestions?.length) {
    try {
      const contactsRaw = await callOllamaForText(
        system,
        `Suggest 3 people to contact at ${job.company} for the ${job.title} full-time software role (recruiter, university recruiting / early career, engineering manager). Return ONLY a JSON array like [{"title":"...","linkedinSearchQuery":"...","notes":"..."}] — no markdown.`
      );
      job.contactSuggestions = parseContactJson(contactsRaw);
    } catch {
      /* use fallback below */
    }
  }

  if (!job.contactSuggestions?.length) {
    job.contactSuggestions = fallbackContacts(job.company, job.title);
  }

  if (!job.approvalNote?.includes('Outreach')) {
    job.approvalNote = `${job.approvalNote || ''} Outreach ready — cover letter & LinkedIn message drafts saved.`.trim();
  }

  await job.save();
  console.log(`  ↳ Cover letter + message + ${job.contactSuggestions?.length || 0} contact(s) saved`);
}
