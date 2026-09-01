/**
 * Companion Chrome extension API — resolve job, stream resume PDF, mark applied.
 * Localhost-oriented; no LLM. Extension never auto-submits (attach-only).
 */
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import Job from '../models/Job';
import { applicationProfile, formatDesiredSalaryRange } from '../data/applicationProfile';
import { resumeProfile } from '../data/resumeProfile';
import { sanitizeStoredJobUrl } from '../services/jobrightApplyLink';
import { config } from '../config';

const router = Router();

const TRACKER_BASE =
  process.env.FRONTEND_URL?.replace(/\/$/, '') || 'http://127.0.0.1:5173';

function parseExperienceLine(line: string) {
  const raw = String(line || '').trim();
  const m = raw.match(/^(.+?)\s+-\s+(.+?)\s+\(([^)]+)\)(?::\s*(.*))?$/);
  if (!m) {
    return {
      title: raw.slice(0, 80),
      company: '',
      location: '',
      dates: '',
      startDate: '',
      endDate: '',
      currentlyWorkHere: false,
      description: raw,
    };
  }
  const title = m[1].trim();
  const companyLoc = m[2].trim();
  const dates = m[3].trim();
  const description = (m[4] || '').trim();
  const parts = companyLoc.split(',').map((p) => p.trim());
  const company = parts[0] || companyLoc;
  const location = parts.slice(1).join(', ');
  const [startDate, endDateRaw] = dates.split(/\s*-\s*/).map((p) => p.trim());
  const endDate = endDateRaw || '';
  const currentlyWorkHere = /present|current|now/i.test(endDate);
  return {
    title,
    company,
    location,
    dates,
    startDate: startDate || '',
    endDate: currentlyWorkHere ? '' : endDate,
    currentlyWorkHere,
    description,
  };
}

function profilePayload() {
  const p = applicationProfile;
  const education = (resumeProfile.education || []).map((e) => ({
    school: e.school,
    degree: e.degree,
    fieldOfStudy: 'Computer Science',
    dates: e.dates,
    graduation: e.graduation || '',
    gpa: e.gpa || '',
    startDate: String(e.dates || '').split(/\s*-\s*/)[0] || '',
    endDate: String(e.dates || '').split(/\s*-\s*/)[1] || e.graduation || '',
  }));
  const edu = education[0];
    const experience = (resumeProfile.experience || []).map(parseExperienceLine);
    const current = experience[0];
    const exp2 = experience[1];
    const exp3 = experience[2];
    const digits = String(p.phone || '').replace(/\D/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(-10);
    return {
      firstName: p.firstName,
      middleName: p.middleName,
      lastName: p.lastName,
      fullName: p.fullName,
      phone: p.phone,
      phoneDigits: ten.length === 10 ? ten : digits,
      phoneFormatted:
        ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : p.phone,
      email: p.email,
      currentCity: p.currentCity,
      street: p.street,
      state: p.state,
      zipcode: p.zipcode,
      country: p.country,
      linkedin: p.linkedin,
      website: p.website,
      github: resumeProfile.github || '',
      recentEmployer: p.recentEmployer,
      linkedinHeadline: p.linkedinHeadline,
      linkedinSummary: p.linkedinSummary,
      coverLetter: p.coverLetter,
      yearsOfExperience: p.yearsOfExperience,
      school: edu?.school || 'California State University, Long Beach',
      schoolShort: 'CSULB',
      schoolAliases: [
        'California State University, Long Beach',
        'California State University Long Beach',
        'CSU Long Beach',
        'CSULB',
        'Cal State Long Beach',
        'Cal State University Long Beach',
      ],
      degree: edu?.degree || 'M.S. in Computer Science',
      fieldOfStudy: 'Computer Science',
      graduation: edu?.graduation || 'January 2027',
      gpa: edu?.gpa || '',
      education,
      experience,
      jobTitle: current?.title || '',
      companyName: current?.company || p.recentEmployer,
      employer: current?.company || p.recentEmployer,
      workLocation: current?.location || p.currentCity,
      workStartDate: current?.startDate || '',
      workEndDate: current?.endDate || '',
      currentlyWorkHere: !!current?.currentlyWorkHere,
      workDescription: current?.description || '',
      jobTitle2: exp2?.title || '',
      companyName2: exp2?.company || '',
      workStartDate2: exp2?.startDate || '',
      workEndDate2: exp2?.endDate || '',
      currentlyWorkHere2: !!exp2?.currentlyWorkHere,
      workDescription2: exp2?.description || '',
      jobTitle3: exp3?.title || '',
      companyName3: exp3?.company || '',
      workStartDate3: exp3?.startDate || '',
      workEndDate3: exp3?.endDate || '',
      workDescription3: exp3?.description || '',
      requireVisa: p.requireVisa,
      legallyAuthorizedToWorkInUS: p.legallyAuthorizedToWorkInUS,
      nowRequireSponsorship: p.nowRequireSponsorship,
      futureRequireSponsorship: p.futureRequireSponsorship,
      usCitizenship: p.usCitizenship,
      willingToRelocate: p.willingToRelocate,
      desiredStartDate: p.desiredStartDate,
      gender: p.gender,
      ethnicity: p.ethnicity,
      disabilityStatus: p.disabilityStatus,
      veteranStatus: p.veteranStatus,
      desiredSalary: p.desiredSalary,
      desiredSalaryMin: p.desiredSalaryMin,
      desiredSalaryMax: p.desiredSalaryMax,
      desiredSalaryFormatted: formatDesiredSalaryRange(p),
      currentCtc: p.currentCtc,
      noticePeriodDays: p.noticePeriodDays,
      confidenceLevel: p.confidenceLevel,
      skills: resumeProfile.skills,
    };
  }

function normalizeForMatch(url: string): { raw: string; host: string; path: string; key: string } | null {
  const cleaned = sanitizeStoredJobUrl(url || '');
  if (!cleaned) return null;
  try {
    const u = new URL(cleaned);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = u.pathname.replace(/\/$/, '') || '/';
    return {
      raw: cleaned,
      host,
      path: pathname,
      key: `${host}${pathname}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function hostFamily(host: string): string {
  const h = host.toLowerCase();
  if (/bytedance|tiktok|lifeattiktok|joinbytedance/.test(h)) return 'bytedance';
  if (/myworkdayjobs|workday/.test(h)) return 'workday';
  if (/greenhouse/.test(h)) return 'greenhouse';
  if (/lever\.co/.test(h)) return 'lever';
  if (/ashbyhq/.test(h)) return 'ashby';
  return h;
}

/** boards.greenhouse.io and job-boards.greenhouse.io are the same ATS board. */
function atsHostsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  return hostFamily(a) === 'greenhouse' && hostFamily(b) === 'greenhouse';
}

/** Stable key for Greenhouse board URLs: `{companySlug}:{jobId}`. */
function greenhouseBoardKey(pathname: string, rawUrl?: string): string | null {
  const fromPath = pathname.match(/\/([^/]+)\/jobs\/(\d+)/i);
  if (fromPath) return `${fromPath[1].toLowerCase()}:${fromPath[2]}`;
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const ghJid = u.searchParams.get('gh_jid');
      const slug = pathname.match(/\/([^/]+)(?:\/|$)/)?.[1];
      if (ghJid && slug) return `${slug.toLowerCase()}:${ghJid}`;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function scoreJobAgainstUrl(
  jobUrl: string,
  target: NonNullable<ReturnType<typeof normalizeForMatch>>,
  company?: string
): number {
  const job = normalizeForMatch(jobUrl);
  if (!job) return 0;
  if (job.key === target.key) return 100;
  if (job.raw === target.raw) return 100;

  const ghJob = greenhouseBoardKey(job.path, job.raw);
  const ghTarget = greenhouseBoardKey(target.path, target.raw);
  if (ghJob && ghTarget && ghJob === ghTarget) return 100;

  const sameHost = job.host === target.host || atsHostsEquivalent(job.host, target.host);
  // Same host + path contained either way
  if (sameHost) {
    if (job.path === target.path) return 100;
    if (job.path.includes(target.path) || target.path.includes(job.path)) {
      if (job.path.length > 8 && target.path.length > 8) return 80;
    }
    const idA = job.path.match(/\/([a-f0-9]{16,}|[0-9]{5,})(?:\/|$)/i)?.[1];
    const idB = target.path.match(/\/([a-f0-9]{16,}|[0-9]{5,})(?:\/|$)/i)?.[1];
    if (idA && idB && idA === idB) return 95;
    return 25;
  }
  // Same employer family (TikTok careers ↔ ByteDance tracker URL)
  if (hostFamily(job.host) === hostFamily(target.host) && hostFamily(target.host) !== target.host) {
    const tokens = target.path.split('/').filter((t) => t.length >= 8);
    for (const t of tokens) {
      if (job.path.includes(t) || job.raw.includes(t)) return 85;
    }
    // Soft company match when on related careers domain
    const c = (company || '').toLowerCase();
    if (c && /byte|tiktok/.test(c) && hostFamily(target.host) === 'bytedance') return 72;
  }
  const tokens = target.path.split('/').filter((t) => t.length >= 8);
  for (const t of tokens) {
    if (job.path.includes(t) || job.raw.includes(t)) return 70;
  }
  return 0;
}

function jobResumePayload(
  job: {
    _id?: unknown;
    title?: string;
    company?: string;
    status?: string;
    url?: string;
    location?: string;
    pdfPath?: string;
    matchScore?: number;
    keywordMatchScore?: number;
    coverLetterDraft?: string;
    missingKeywords?: string[];
    matchedKeywords?: string[];
  },
  score?: number
) {
  const id = String(job._id);
  const resumeReady = !!(job.pdfPath && fs.existsSync(path.resolve(String(job.pdfPath))));
  return {
    matched: true,
    profileOnly: false,
    score: score ?? 100,
    jobId: id,
    title: job.title,
    company: job.company,
    location: job.location,
    status: job.status,
    jobUrl: job.url,
    resumeReady,
    pdfUrl: resumeReady ? `/api/extension/jobs/${id}/resume.pdf` : null,
    trackerUrl: `${TRACKER_BASE}/?job=${id}`,
    trackerBase: TRACKER_BASE,
    matchScore: job.matchScore ?? null,
    keywordMatchScore: job.keywordMatchScore ?? null,
    coverLetterDraft: job.coverLetterDraft || null,
    coverLetterPdfUrl: `/api/extension/jobs/${id}/cover-letter.pdf`,
    missingKeywords: job.missingKeywords || [],
    matchedKeywords: job.matchedKeywords || [],
    citizenshipOnlyWarning: false,
    sponsorshipConflict: false,
  };
}

router.get('/health', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'extension', version: 10, trackerBase: TRACKER_BASE });
});

router.get('/profile', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.json(profilePayload());
});

/** Prefer a ready/approved resume PDF (not a random applied leftover). */
router.get('/latest-resume', async (_req: Request, res: Response) => {
  try {
    const preferStatuses = [
      'pending_resume_approval',
      'pdf_uploaded',
      'resume_generated',
      'ready_to_apply',
      'applying',
    ];
    const jobs = await Job.find({ pdfPath: { $exists: true, $ne: '' } })
      .sort({ updatedAt: -1 })
      .limit(40)
      .select({ title: 1, company: 1, status: 1, url: 1, location: 1, pdfPath: 1, updatedAt: 1 })
      .lean()
      .exec();

    const withFile = jobs.filter(
      (job) => job.pdfPath && fs.existsSync(path.resolve(String(job.pdfPath)))
    );
    const preferred =
      withFile.find((j) => preferStatuses.includes(String(j.status || ''))) ||
      withFile.find((j) => String(j.status || '') !== 'applied') ||
      withFile[0];

    if (preferred) {
      return res.json({
        ...jobResumePayload(preferred),
        fallback: true,
        message: 'Latest ready resume from tracker (URL was not matched)',
      });
    }
    return res.json({ matched: false, resumeReady: false, message: 'No resume PDF found in tracker' });
  } catch (error) {
    console.error('extension latest-resume:', error);
    return res.status(500).json({ message: 'Failed to find latest resume', error: String(error) });
  }
});

const RESOLVE_PROJECTION = {
  title: 1,
  company: 1,
  status: 1,
  url: 1,
  pdfPath: 1,
  location: 1,
  matchScore: 1,
  keywordMatchScore: 1,
  coverLetterDraft: 1,
  missingKeywords: 1,
  matchedKeywords: 1,
} as const;

type ResolveJobRow = {
  _id: unknown;
  title?: string;
  company?: string;
  status?: string;
  url?: string;
  pdfPath?: string;
  location?: string;
  matchScore?: number;
  keywordMatchScore?: number;
  coverLetterDraft?: string;
  missingKeywords?: string[];
  matchedKeywords?: string[];
};

router.get('/resolve', async (req: Request, res: Response) => {
  try {
    const url = String(req.query.url || '');
    const target = normalizeForMatch(url);
    if (!target) {
      return res.json({
        matched: false,
        profileOnly: true,
        message: 'No URL to match — fill from profile only',
        trackerBase: TRACKER_BASE,
      });
    }

    const family = hostFamily(target.host);
    const familyHosts: Record<string, RegExp> = {
      bytedance: /^https?:\/\/([^/]*\.)?(bytedance|tiktok|lifeattiktok|joinbytedance)\./i,
      workday: /^https?:\/\/([^/]*\.)?(myworkdayjobs|workday)\./i,
      greenhouse: /^https?:\/\/([^/]*\.)?greenhouse\./i,
      lever: /^https?:\/\/([^/]*\.)?lever\.co(\/|$)/i,
      ashby: /^https?:\/\/([^/]*\.)?ashbyhq\./i,
    };

    // Fast path: exact / near-exact URL, then same-host candidates — never scan every JD.
    // Greenhouse uses both boards.* and job-boards.* — always score across the family.
    const escapedHost = target.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hostPrefix = new RegExp(`^https?://(www\\.)?${escapedHost}(/|$)`, 'i');
    let jobs: ResolveJobRow[] = [];

    if (family === 'greenhouse' && familyHosts.greenhouse) {
      jobs = await Job.find({ url: { $regex: familyHosts.greenhouse } }, RESOLVE_PROJECTION)
        .limit(120)
        .lean()
        .exec();
    } else {
      jobs = await Job.find(
        {
          $or: [{ url: target.raw }, { url: { $regex: hostPrefix } }],
        },
        RESOLVE_PROJECTION
      )
        .limit(80)
        .lean()
        .exec();

      // Soft fallback for remapped hosts (e.g. TikTok ↔ ByteDance) without full-table scan.
      if (!jobs.length) {
        const hostRe = familyHosts[family];
        if (hostRe) {
          jobs = await Job.find({ url: { $regex: hostRe } }, RESOLVE_PROJECTION).limit(80).lean().exec();
        }
      }
    }

    let best: (typeof jobs)[0] | null = null;
    let bestScore = 0;
    for (const job of jobs) {
      const s = scoreJobAgainstUrl(String(job.url || ''), target, String(job.company || ''));
      if (s > bestScore) {
        bestScore = s;
        best = job;
      }
    }

    if (!best || bestScore < 70) {
      return res.json({
        matched: false,
        profileOnly: true,
        pageUrl: target.raw,
        hostFamily: hostFamily(target.host),
        message: 'No matching tracker job — fill from profile only',
        trackerBase: TRACKER_BASE,
      });
    }

    const payload = {
      ...jobResumePayload(best, bestScore),
      pageUrl: target.raw,
    };

    const jdDoc = await Job.findById(best._id).select({ jobDescription: 1 }).lean().exec();
    const jd = String(jdDoc?.jobDescription || '');
    const citizenOnly =
      /u\.?s\.?\s*citizen|citizens?\s+only|must be.*(citizen|green card)|clearance required|no sponsorship|without sponsorship/i.test(
        jd
      );
    const needsSponsor =
      /^yes$/i.test(String(applicationProfile.requireVisa).trim()) ||
      /^yes$/i.test(String(applicationProfile.nowRequireSponsorship).trim()) ||
      /^yes$/i.test(String(applicationProfile.futureRequireSponsorship).trim());
    payload.citizenshipOnlyWarning = citizenOnly;
    payload.sponsorshipConflict = citizenOnly && needsSponsor;

    return res.json(payload);
  } catch (error) {
    console.error('extension resolve:', error);
    return res.status(500).json({ message: 'Failed to resolve job', error: String(error) });
  }
});

router.get('/jobs/:id/resume.pdf', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ message: 'Job not found' });
    const pdfPath = job.pdfPath ? path.resolve(String(job.pdfPath)) : '';
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: 'Resume PDF not found for this job' });
    }
    const uploadsRoot = path.resolve(config.uploadsDir);
    const underUploads =
      pdfPath.startsWith(uploadsRoot + path.sep) || pdfPath === uploadsRoot;
    const looksLikeUpload = pdfPath.includes(`${path.sep}uploads${path.sep}`);
    if (!underUploads && !looksLikeUpload) {
      console.warn('extension resume path outside uploads:', pdfPath);
      return res.status(403).json({ message: 'Resume path not allowed' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${path.basename(pdfPath).replace(/"/g, '')}"`
    );
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = fs.createReadStream(pdfPath);
    stream.on('error', (err) => {
      console.error('extension resume stream:', err);
      if (!res.headersSent) res.status(500).json({ message: 'Failed to read resume' });
      else res.end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('extension resume:', error);
    return res.status(500).json({ message: 'Failed to stream resume', error: String(error) });
  }
});

/** Cover letter PDF for Attach resume (Additional Attachments / dedicated cover fields). */
router.get('/jobs/:id/cover-letter.pdf', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ message: 'Job not found' });
    const text = String(job.coverLetterDraft || applicationProfile.coverLetter || '').trim();
    if (!text) {
      return res.status(404).json({ message: 'No cover letter text for this job' });
    }
    const { writeCoverLetterPdf } = await import('../services/coverLetterPdf');
    const { buffer, filename } = writeCoverLetterPdf({
      jobId: String(job._id),
      text,
      company: job.company,
      title: job.title,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(buffer);
  } catch (error) {
    console.error('extension cover-letter.pdf:', error);
    return res.status(500).json({ message: 'Failed to build cover letter PDF', error: String(error) });
  }
});

/** Generate tailored cover letter for matched tracker job (same LLM as tracker Workspace). */
router.post('/jobs/:id/generate-cover-letter', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const { generateOutreachArtifacts } = await import('../services/outreachService');
    await generateOutreachArtifacts(String(job._id));

    const refreshed = await Job.findById(job._id)
      .select({ title: 1, company: 1, coverLetterDraft: 1 })
      .lean()
      .exec();
    const draft = String(refreshed?.coverLetterDraft || '').trim();
    if (!draft) {
      return res.status(500).json({ message: 'Cover letter generation produced no text' });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      jobId: String(job._id),
      company: refreshed?.company,
      title: refreshed?.title,
      coverLetterDraft: draft,
      coverLetterPdfUrl: `/api/extension/jobs/${job._id}/cover-letter.pdf`,
      message: 'Cover letter ready',
    });
  } catch (error) {
    console.error('extension generate-cover-letter:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Cover letter generation failed',
      error: String(error),
    });
  }
});

router.post('/mark-applied', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.body?.jobId || '');
    const url = String(req.body?.url || '');
    let job = jobId ? await Job.findById(jobId) : null;
    if (!job && url) {
      const target = normalizeForMatch(url);
      if (target) {
        const jobs = await Job.find({}, { url: 1, company: 1 }).lean();
        let best: (typeof jobs)[0] | null = null;
        let bestScore = 0;
        for (const j of jobs) {
          const s = scoreJobAgainstUrl(String(j.url || ''), target, String(j.company || ''));
          if (s > bestScore) {
            bestScore = s;
            best = j;
          }
        }
        if (best && bestScore >= 70) job = await Job.findById(best._id);
      }
    }
    if (!job) return res.status(404).json({ message: 'No matching tracker job to mark applied' });
    job.status = 'applied';
    job.pendingAction = null;
    job.errorMessage = undefined;
    if (!job.appliedAt) job.appliedAt = new Date();
    if (!job.followUpAt) {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      job.followUpAt = d;
    }
    job.approvalNote = `Marked applied via Resume Attach · ${new Date().toLocaleString()}`;
    await job.save();
    res.json({ ok: true, jobId: String(job._id), status: job.status, title: job.title, company: job.company });
  } catch (error) {
    console.error('extension mark-applied:', error);
    res.status(500).json({ message: 'Failed to mark applied', error: String(error) });
  }
});

/** Save current page into tracker when it is not already there. */
router.post('/save-job', async (req: Request, res: Response) => {
  try {
    const url = sanitizeStoredJobUrl(String(req.body?.url || ''));
    if (!url) return res.status(400).json({ message: 'url required' });

    const exact = await Job.findOne({ url });
    if (exact) {
      return res.json({
        ok: true,
        created: false,
        jobId: String(exact._id),
        title: exact.title,
        company: exact.company,
        status: exact.status,
        trackerUrl: `${TRACKER_BASE}/?job=${exact._id}`,
      });
    }

    // Fuzzy match (same threshold as resolve / mark-applied) to avoid duplicates
    const target = normalizeForMatch(url);
    if (target) {
      const jobs = await Job.find({}, { url: 1, company: 1, title: 1, status: 1 }).lean();
      let best: (typeof jobs)[0] | null = null;
      let bestScore = 0;
      for (const j of jobs) {
        const s = scoreJobAgainstUrl(String(j.url || ''), target, String(j.company || ''));
        if (s > bestScore) {
          bestScore = s;
          best = j;
        }
      }
      if (best && bestScore >= 70) {
        return res.json({
          ok: true,
          created: false,
          jobId: String(best._id),
          title: best.title,
          company: best.company,
          status: best.status,
          score: bestScore,
          trackerUrl: `${TRACKER_BASE}/?job=${best._id}`,
        });
      }
    }

    const title = String(req.body?.title || 'Untitled role').slice(0, 200) || 'Untitled role';
    const company = String(req.body?.company || 'Unknown company').slice(0, 120) || 'Unknown company';
    const location = String(req.body?.location || '').slice(0, 120);
    const snippet = String(req.body?.description || '').slice(0, 8000) || `Saved from Resume Attach: ${url}`;

    const job = await Job.create({
      title,
      company,
      url,
      jobDescription: snippet,
      jobType: 'fulltime',
      location: location || undefined,
      source: 'company_portal',
      status: 'scraped',
      approvalNote: 'Saved from Resume Attach — generate/approve resume when ready.',
    });

    res.json({
      ok: true,
      created: true,
      jobId: String(job._id),
      title: job.title,
      company: job.company,
      status: job.status,
      trackerUrl: `${TRACKER_BASE}/?job=${job._id}`,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/duplicate|E11000/i.test(msg)) {
      const again = await Job.findOne({ url: sanitizeStoredJobUrl(String(req.body?.url || '')) });
      if (again) {
        return res.json({
          ok: true,
          created: false,
          jobId: String(again._id),
          title: again.title,
          company: again.company,
          status: again.status,
          trackerUrl: `${TRACKER_BASE}/?job=${again._id}`,
        });
      }
    }
    console.error('extension save-job:', error);
    res.status(500).json({ message: 'Failed to save job', error: msg });
  }
});

/** AI answer for a custom application question (extension sidepanel). */
router.post('/ask-application', async (req: Request, res: Response) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ message: 'question is required' });

    const jobId = String(req.body?.jobId || '').trim();
    const pageUrl = String(req.body?.url || '').trim();
    type QaJob = { _id?: unknown; title?: string; company?: string; jobDescription?: string };
    let job: QaJob | null = null;

    if (jobId) {
      job = await Job.findById(jobId).select({ title: 1, company: 1, jobDescription: 1 }).exec();
    } else if (pageUrl) {
      const target = normalizeForMatch(pageUrl);
      if (target) {
        const family = hostFamily(target.host);
        const familyHosts: Record<string, RegExp> = {
          greenhouse: /^https?:\/\/([^/]*\.)?greenhouse\./i,
          lever: /^https?:\/\/([^/]*\.)?lever\.co(\/|$)/i,
          ashby: /^https?:\/\/([^/]*\.)?ashbyhq\./i,
        };
        const hostRe = familyHosts[family];
        const query = hostRe
          ? { url: { $regex: hostRe } }
          : { url: { $regex: new RegExp(`^https?://(www\\.)?${target.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`, 'i') } };
        const jobs = await Job.find(query, { title: 1, company: 1, jobDescription: 1, url: 1 })
          .limit(80)
          .lean()
          .exec();
        let best: (typeof jobs)[0] | null = null;
        let bestScore = 0;
        for (const j of jobs) {
          const s = scoreJobAgainstUrl(String(j.url || ''), target, String(j.company || ''));
          if (s > bestScore) {
            bestScore = s;
            best = j;
          }
        }
        if (best && bestScore >= 70) job = best;
      }
    }

    const { generateApplicationAnswer } = await import('../services/applicationQaService');
    const result = await generateApplicationAnswer({
      question,
      job,
      wordLimit: Number(req.body?.wordLimit) || undefined,
      skipBank: req.body?.skipBank === true,
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('extension ask-application:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to generate answer',
      error: String(error),
    });
  }
});

/** Save a reviewed Q&A to the global answer bank (reuse across applications). */
router.post('/save-application-answer', async (req: Request, res: Response) => {
  try {
    const question = String(req.body?.question || '').trim();
    const answer = String(req.body?.answer || '').trim();
    if (!question || !answer) {
      return res.status(400).json({ message: 'question and answer required' });
    }
    const { saveApplicationAnswerToBank } = await import('../services/applicationQaService');
    const row = saveApplicationAnswerToBank(question, answer);
    return res.json({ ok: true, answer: row });
  } catch (error) {
    console.error('extension save-application-answer:', error);
    return res.status(500).json({ message: 'Failed to save answer', error: String(error) });
  }
});

export default router;
export { normalizeForMatch, hostFamily, greenhouseBoardKey, scoreJobAgainstUrl };
