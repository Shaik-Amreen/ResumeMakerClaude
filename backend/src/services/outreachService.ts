import { Agent, fetch as undiciFetch } from 'undici';
import Job from '../models/Job';
import type { ContactSuggestion } from '../models/Job';
import { config } from '../config';
import { cleanJobDescriptionForResume } from './cleanJobDescription';

const CANDIDATE = {
  name: 'Shaik Amreen Kousar',
  school: 'California State University, Long Beach',
  degree: 'MS Computer Science (graduating January 2028)',
  focus: 'Summer 2027 software engineering internships',
};

function fallbackRecruiterMessage(title: string, company: string, recruiterName?: string): string {
  const greeting = recruiterName ? `Hi ${recruiterName.split(' ')[0]}` : 'Hi';
  return `${greeting} — I am applying for the ${title} role at ${company}. I am an MS CS student at CSULB (grad Jan 2028) targeting Summer 2027 internships. I would love to connect and share why I am excited about the team.`;
}

function fallbackCoverLetter(title: string, company: string): string {
  return `Dear Hiring Team at ${company},

I am writing to express my interest in the ${title} position. I am pursuing an MS in Computer Science at California State University, Long Beach (graduating January 2028) and am seeking a Summer 2027 software engineering internship where I can contribute full-stack and backend skills while learning from strong engineering teams.

My experience includes web development at ASI at CSULB, software engineering at Origem India, and projects aligned with modern stacks (React, Node.js, Python, cloud). I am excited about ${company}'s work and would welcome the opportunity to discuss how I can add value to your team.

Thank you for your time and consideration.

Best regards,
${CANDIDATE.name}`;
}

function fallbackContacts(company: string, title: string): ContactSuggestion[] {
  return [
    {
      title: 'Technical Recruiter',
      linkedinSearchQuery: `${company} technical recruiter software intern`,
      notes: 'Search on LinkedIn and connect with a short note after applying.',
    },
    {
      title: 'University Recruiting / Early Career',
      linkedinSearchQuery: `${company} university recruiting software engineering`,
      notes: 'Early-career recruiters often prioritize intern pipelines.',
    },
    {
      title: 'Hiring Manager (Engineering)',
      linkedinSearchQuery: `${company} engineering manager ${title.split(' ').slice(0, 3).join(' ')}`,
      notes: 'Optional — only message if you have a strong mutual connection or referral.',
    },
  ];
}

async function callOllamaForText(system: string, user: string): Promise<string> {
  const waitMs = Math.min(config.ollama.responseWaitMs, 180_000);
  const agent = new Agent({
    headersTimeout: waitMs,
    bodyTimeout: waitMs,
    connectTimeout: 60_000,
  });

  const res = (await undiciFetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      keep_alive: config.ollama.keepAlive,
    }),
    dispatcher: agent,
  })) as Response;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama outreach error: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  return (data.message?.content || '').trim();
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
      `Write a tailored cover letter (3 short paragraphs, under 250 words) for:
Role: ${job.title}
Company: ${job.company}
Job description excerpt:
${jd.slice(0, 4000)}

Output only the cover letter text, no markdown fences.`
    );
    job.coverLetterDraft = coverLetter || fallbackCoverLetter(job.title, job.company);
  } catch (err) {
    console.warn('  Cover letter fallback:', err instanceof Error ? err.message : err);
    job.coverLetterDraft = fallbackCoverLetter(job.title, job.company);
  }

  try {
    const message = await callOllamaForText(
      system,
      `Write a short LinkedIn connection note (under 280 characters if possible, max 400) to a recruiter at ${job.company} about the ${job.title} role. Mention MS CS at CSULB and Summer 2027 internship interest. Output only the message text.`
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
        `Suggest 3 people to contact at ${job.company} for the ${job.title} internship (recruiter, university recruiting, engineering manager). Return ONLY a JSON array like [{"title":"...","linkedinSearchQuery":"...","notes":"..."}] — no markdown.`
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
