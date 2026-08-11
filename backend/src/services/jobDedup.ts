import Job from '../models/Job';

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop tracking / pagination noise so the same posting isn't saved twice
    for (const key of [...u.searchParams.keys()]) {
      if (
        /^(utm_|gh_|ref|source|medium|campaign|start$|page$)/i.test(key) ||
        /utm_/i.test(key)
      ) {
        u.searchParams.delete(key);
      }
    }
    u.hash = '';
    let path = u.pathname.replace(/\/$/, '').toLowerCase();
    const qs = u.searchParams.toString();
    return `${u.hostname.toLowerCase()}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return url.split('?')[0].replace(/\/$/, '').toLowerCase();
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function findDuplicateJob(url: string, title: string, company: string) {
  const cleanUrl = normalizeUrl(url);
  const pathOnly = cleanUrl.split('?')[0];

  // Match stored URLs that share the same host+path (ignore tracking query params)
  const escaped = pathOnly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const allWithUrl = await Job.find({
    url: { $regex: escaped, $options: 'i' },
  }).limit(20);
  if (allWithUrl.length) {
    const exactNorm = allWithUrl.find((j) => normalizeUrl(j.url) === cleanUrl);
    if (exactNorm) return exactNorm;
    // Same path (job detail) with different junk query → treat as duplicate
    const samePath = allWithUrl.find((j) => normalizeUrl(j.url).split('?')[0] === pathOnly);
    if (samePath) return samePath;
  }

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
