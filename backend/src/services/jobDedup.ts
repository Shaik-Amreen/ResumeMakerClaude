import Job from '../models/Job';

function normalizeUrl(url: string): string {
  return url.split('?')[0].replace(/\/$/, '').toLowerCase();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function findDuplicateJob(url: string, title: string, company: string) {
  const cleanUrl = normalizeUrl(url);
  const allWithUrl = await Job.find({ url: { $regex: cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
  if (allWithUrl.length) return allWithUrl[0];

  const byExactUrl = await Job.findOne({ url });
  if (byExactUrl) return byExactUrl;

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
