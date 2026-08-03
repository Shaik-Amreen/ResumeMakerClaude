import Job from '../models/Job';

export function normalizeJobUrl(url: string): string {
  return url.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizedJobUrlPattern(url: string): RegExp {
  const cleanUrl = normalizeJobUrl(url);
  return new RegExp(`^${escapeRegex(cleanUrl)}/?(?:[?#].*)?$`, 'i');
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function findDuplicateJob(url: string, title: string, company: string) {
  const byNormalizedUrl = await Job.findOne({ url: normalizedJobUrlPattern(url) });
  if (byNormalizedUrl) return byNormalizedUrl;

  const normTitle = normalizeText(title);
  const normCompany = normalizeText(company);

  const candidates = await Job.find({
    company: { $regex: new RegExp(`^${normCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  });

  return (
    candidates.find(
      (job) => normalizeText(job.title) === normTitle && normalizeText(job.company) === normCompany
    ) || null
  );
}

export async function isDuplicateJob(url: string, title: string, company: string): Promise<boolean> {
  return Boolean(await findDuplicateJob(url, title, company));
}
