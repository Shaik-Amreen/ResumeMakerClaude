import Job from '../models/Job';
import { isNonSoftwareRole, isSoftwareRole } from './eligibility';

const SOFTWARE_TITLE =
  /\b(software|developer|swe|full[\s-]?stack|frontend|front[\s-]?end|backend|web|programming|computer\s+science)\b/i;

const NON_SWE_INTERN_TITLE = [
  /\bdata\s+scientist\b/i,
  /\bit\s+(support|specialist|analyst|intern)\b/i,
  /\bqa\s+(engineer|analyst|intern)\b/i,
  /\bproduct\s+(manager|owner|analyst)\b/i,
  /\bux\s+(designer|researcher|intern)\b/i,
  /\bnetwork\s+(admin|engineer)\b/i,
  /\bcyber\s+security\s+analyst\b/i,
  /\bmechanical\b/i,
  /\belectrical\b/i,
  /\bcivil\b/i,
];

/** Summer 2027 software-only SWE internship — MS grad Jan 2028. */
export function isSummer2027InternTarget(title: string, description: string): boolean {
  const text = `${title}\n${description}`;

  if (!isSoftwareRole(title, description) || isNonSoftwareRole(title, description)) return false;

  if (!SOFTWARE_TITLE.test(title)) return false;

  if (NON_SWE_INTERN_TITLE.some((p) => p.test(title))) return false;

  if (
    /\bsummer\s*2026\b|\bfall\s*2026\b|\bspring\s*2026\b|2026\s+start|\bintern.*\b2026\b|\b2026\b.*\bintern/i.test(
      text
    )
  ) {
    return false;
  }

  if (/\bfall\s*2027\b/i.test(text) && !/\bsummer\s*2027\b/i.test(text)) return false;

  if (/\bspring\s*2027\b/i.test(text) && /\bco-?op\b/i.test(title)) return false;

  if (/\bbci\b|brain[\s-]?computer|neuroscience engineer/i.test(text)) return false;

  if (/\bdrexel\s+university\s+co-?op/i.test(title)) return false;

  if (/intern\s*-\s*r&d/i.test(title) && !/\bweb\b|full[\s-]?stack|frontend|react|node/i.test(text)) {
    return false;
  }

  if (/work\s*study|tutor/i.test(title)) return false;

  const isIntern =
    /\bintern(ship)?\b/i.test(title) || /\bco-?op\b/i.test(title) || /\bintern(ship)?\b/i.test(text);
  if (!isIntern) return false;

  return true;
}

export async function pruneNonSummer2027Jobs(): Promise<{ removed: number; kept: number }> {
  const all = await Job.find();
  let removed = 0;
  let kept = 0;

  for (const job of all) {
    if (isSummer2027InternTarget(job.title, job.jobDescription)) {
      job.status = 'scraped';
      job.pendingAction = null;
      job.errorMessage = undefined;
      job.approvalNote = 'Summer 2027 software intern — tailor resume & upload PDF.';
      await job.save();
      kept += 1;
      console.log(`Kept: ${job.title} @ ${job.company}`);
      continue;
    }

    await job.deleteOne();
    removed += 1;
    console.log(`Removed: ${job.title} @ ${job.company}`);
  }

  return { removed, kept };
}

export async function pruneNonSoftwareJobs(): Promise<number> {
  const all = await Job.find();
  let removed = 0;

  for (const job of all) {
    if (!isSoftwareRole(job.title, job.jobDescription)) {
      await job.deleteOne();
      removed += 1;
      console.log(`Removed non-software job: ${job.title} @ ${job.company}`);
    }
  }

  return removed;
}

export async function resetAllJobsToScraped(): Promise<number> {
  const result = await Job.updateMany(
    {},
    {
      $set: {
        status: 'scraped',
        pendingAction: null,
        approvalNote: 'Scraped — generate resume manually, then upload PDF.',
      },
      $unset: {
        latexResume: 1,
        pdfPath: 1,
        matchScore: 1,
        errorMessage: 1,
        recruiterMessageDraft: 1,
      },
    }
  );

  return result.modifiedCount;
}
