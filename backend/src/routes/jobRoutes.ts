import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Job from '../models/Job';
import { config } from '../config';
import { resumeAgentLabel } from '../services/resumeAgent';
import { sanitizeResumeLatex } from '../services/resumeAgent/sanitizeLatex';
import { applyJdHeaderTagline } from '../services/resumeAgent/amazonLatexGuard';
import { cleanJobDescriptionForResume } from '../services/cleanJobDescription';
import {
  applyMatchFieldsToJob,
  scoreResumeAgainstJd,
} from '../services/resumeAgent/jdMatch';
import {
  runScrapeOnly,
  refreshExistingJobs,
  isScrapeRunning,
  isBulkTaskRunning,
  isPipelineRunning,
  runResumesForScrapedJobs,
  resumeQueueJobFilter,
  prepareAndGenerateResumes,
  enqueueSingleResume,
  rerunClaudeForJobsWithLatex,
  enqueueSingleClaude,
  enqueueSingleOllamaResume,
  runMasterPipeline,
  deleteAllJobs,
  runScrapeJobright,
  runScrapeLinkedIn,
  runScrapeIndeed,
  runScrapeCareerPortals,
  runScrapeAts,
  runScrapeFaangPortals,
  runScrapeGithubLists,
  runScrapeScoutify,
  forceStopCurrentTask,
  getTaskStatus,
  runCareerApplyQueue,
} from '../services/orchestratorService';
import {
  resetAllJobsToScraped,
  deleteJobById,
  markJobsWithInvalidJd,
  clearGeneratedResumes,
  normalizeJobSourceFilter,
  JOB_SOURCE_FILTERS,
} from '../services/jobMaintenance';
import { getSchedulerStatus } from '../services/schedulerService';
import { filterJobs, normalizeJob, sortJobs, type JobRecord } from '../utils/jobQuery';
import type { JobStatus } from '../models/Job';
import { autoApplyToJob, detectAts, prefersCareerApply } from '../services/jobApplier';
import { compileLatexToPdf } from '../services/latexCompileService';
import { removeJobResumeFiles } from '../services/resumeFiles';

const router = Router();

fs.mkdirSync(config.uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

router.get('/scheduler/status', (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
});

router.get('/task/status', (_req: Request, res: Response) => {
  res.json(getTaskStatus());
});

router.post('/task/stop', (_req: Request, res: Response) => {
  forceStopCurrentTask();
  res.json({ message: 'Stop requested: task will halt safely after its current step.' });
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const jobs = await Job.find().lean<JobRecord[]>();
    const filtered = filterJobs(jobs, {
      q: req.query.q as string,
      source: req.query.source as string,
      status: req.query.status as string,
      priority: req.query.priority as string,
      jobType: req.query.jobType as string,
      hasApplicants: req.query.hasApplicants as string,
      hasPosted: req.query.hasPosted as string,
      minRating: req.query.minRating as string,
    });
    const sorted = sortJobs(filtered, (req.query.sort as string) || 'priority');
    res.json(sorted.map((j) => normalizeJob(j)));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching jobs', error });
  }
});

router.post('/backfill-company-ratings', async (_req: Request, res: Response) => {
  try {
    const { resolveCompanyRating } = await import('../data/h1bCompanyRatings');
    const jobs = await Job.find({
      $or: [
        { companyRating: { $exists: false } },
        { companyRating: null },
        { companyRating: { $lt: 1 } },
        { companyRating: { $gt: 5 } },
      ],
    }).select({ company: 1, jobDescription: 1, companyRating: 1 });
    let updated = 0;
    for (const job of jobs) {
      const resolved = resolveCompanyRating(String(job.company || ''), String(job.jobDescription || ''));
      job.companyRating = resolved.rating;
      job.companyRatingReason = resolved.reason;
      await job.save();
      updated += 1;
    }
    res.json({ message: `Backfilled company ratings for ${updated} job(s)`, updated });
  } catch (error) {
    res.status(500).json({ message: 'Error backfilling company ratings', error: String(error) });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(normalizeJob(job));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching job', error });
  }
});

router.post('/delete-all', async (_req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline running: wait before deleting.' });
    }
    const result = await deleteAllJobs();
    res.json({
      message: `Deleted ${result.deleted} job(s) and ${result.pdfsRemoved} PDF file(s).`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting jobs', error });
  }
});

/** Flag jobs whose JD is a dead posting / "Job not found" ATS page. */
router.post('/mark-invalid-jds', async (_req: Request, res: Response) => {
  try {
    const marked = await markJobsWithInvalidJd();
    res.json({
      message: `Marked ${marked} job(s) as invalid_job (missing / dead JD).`,
      marked,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error marking invalid JDs', error });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await deleteJobById(req.params.id);
    if (!result.deleted) {
      return res.status(404).json({ message: 'Job not found' });
    }
    res.json({
      message: `Deleted job${result.pdfsRemoved ? ` and ${result.pdfsRemoved} file(s)` : ''}.`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting job', error });
  }
});

router.post('/run-pipeline', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Pipeline or scrape already running.' });
    }

    const deleteFirst = req.body?.deleteFirst === true;
    const perSourceCap = Number(req.body?.perSourceCap) || config.pipeline.perSourceCap;
    const jobType = 'fulltime' as const;

    runMasterPipeline({ deleteFirst, perSourceCap, jobType }).catch(console.error);

    res.json({
      message: deleteFirst
        ? `Pipeline started: wipe DB → scrape (max ${perSourceCap} total) → resumes. No Easy Apply.`
        : `Pipeline started: scrape (max ${perSourceCap} jobs total, keep existing) → resumes. No Easy Apply. Karthik Chrome must stay open.`,
      perSourceCap,
      jobType,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting pipeline', error });
  }
});

router.post('/prepare-and-generate-resumes', async (_req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Another task is already running.' });
    }
    prepareAndGenerateResumes().catch(console.error);
    res.json({
      message:
        'Removed non-software jobs, reset all to scraped, starting sequential resume generation (one at a time).',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing resume batch', error });
  }
});

router.post('/rerun-claude', async (_req: Request, res: Response) => {
  try {
    const pending = await Job.countDocuments({
      latexResume: { $exists: true, $nin: [null, ''] },
    });
    rerunClaudeForJobsWithLatex().catch(console.error);
    res.json({
      message: `Claude-only rerun started for ${pending} job(s) with saved LaTeX — one by one.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Claude rerun', error });
  }
});

router.post('/:id/rerun-claude', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    enqueueSingleClaude(job.id);
    res.json({
      message:
        'Claude-only step queued: uses saved LaTeX or reads from open ChatGPT tab if needed.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Claude rerun', error });
  }
});

router.post('/generate-resumes', async (req: Request, res: Response) => {
  try {
    if (isBulkTaskRunning()) {
      return res.status(409).json({ message: 'Another task is running. Stop it first or wait.' });
    }
    const limit = Number(req.body?.limit) || 0;
    const withOutreach = req.body?.withOutreach === true;
    const sourceRaw = String(req.body?.source || '').trim();
    if (sourceRaw && sourceRaw.toLowerCase() !== 'all' && !normalizeJobSourceFilter(sourceRaw)) {
      return res.status(400).json({
        message: `Invalid source. Use one of: ${JOB_SOURCE_FILTERS.join(', ')}`,
      });
    }
    const source = normalizeJobSourceFilter(sourceRaw);
    const pending = await Job.countDocuments(resumeQueueJobFilter(source));
    const count = limit > 0 ? Math.min(limit, pending) : pending;

    runResumesForScrapedJobs({
      limit: limit || undefined,
      withOutreach,
      source,
    }).catch(console.error);
    res.json({
      message: source
        ? `Resume generation started for up to ${count} ${source} job(s) — scraped + failed retries, newest first (${resumeAgentLabel()}).`
        : `Resume generation started for up to ${count} job(s) — scraped + failed retries, newest first (${resumeAgentLabel()}).`,
      count,
      source: source || 'all',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting resume queue', error });
  }
});

/** Clear generated LaTeX/PDFs (keep jobs). Optional source=scoutify|jobright|… */
router.post('/clear-resumes', async (req: Request, res: Response) => {
  try {
    if (isBulkTaskRunning()) {
      return res.status(409).json({ message: 'Another task is running. Stop it first or wait.' });
    }
    const sourceRaw = String(req.body?.source || '').trim();
    if (sourceRaw && sourceRaw.toLowerCase() !== 'all' && !normalizeJobSourceFilter(sourceRaw)) {
      return res.status(400).json({
        message: `Invalid source. Use one of: ${JOB_SOURCE_FILTERS.join(', ')}`,
      });
    }
    const result = await clearGeneratedResumes({ source: sourceRaw || undefined });
    res.json({
      message: result.source
        ? `Cleared resumes for ${result.cleared} ${result.source} job(s) (${result.filesRemoved} file(s) removed). Jobs kept as scraped.`
        : `Cleared resumes for ${result.cleared} job(s) (${result.filesRemoved} file(s) removed). Jobs kept as scraped.`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error clearing resumes', error });
  }
});

function parseScrapeCap(body: Record<string, unknown> | undefined): number {
  const cap = Number(body?.limit ?? body?.perSourceCap);
  return cap > 0 ? cap : config.pipeline.perSourceCap;
}

router.post('/scrape/jobright', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeJobright(cap, jobType).catch(console.error);
    res.json({ message: `Jobright scrape started: up to ${cap} new jobs. Karthik Chrome must stay open.` });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Jobright scrape', error });
  }
});

router.post('/scrape/linkedin', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeLinkedIn(cap, jobType).catch(console.error);
    res.json({ message: `LinkedIn scrape started: up to ${cap} new jobs (skips duplicates).` });
  } catch (error) {
    res.status(500).json({ message: 'Error starting LinkedIn scrape', error });
  }
});

router.post('/scrape/indeed', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeIndeed(cap, jobType).catch(console.error);
    res.json({ message: `Indeed scrape started: up to ${cap} new full-time jobs.` });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Indeed scrape', error });
  }
});

router.post('/scrape/ats', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeAts(cap, jobType).catch(console.error);
    res.json({
      message: `ATS board scrape started (Greenhouse + Lever, free public APIs): up to ${cap} new full-time jobs.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting ATS scrape', error });
  }
});

router.post('/scrape/faang-portals', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeFaangPortals(cap, jobType).catch(console.error);
    res.json({
      message: `FAANG portal scrape started (Amazon/Microsoft/Meta/Apple/Google): up to ${cap} new full-time jobs. Karthik Chrome must stay open.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting FAANG portal scrape', error });
  }
});

router.post('/scrape/github-lists', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeGithubLists(cap, jobType).catch(console.error);
    res.json({
      message: `GitHub + Simplify list scrape started (New-Grad-Positions + Top-New-Grad): up to ${cap} new full-time jobs.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting GitHub list scrape', error });
  }
});

router.post('/scrape/scoutify', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeScoutify(cap, jobType).catch(console.error);
    res.json({
      message: `Scoutify scrape started (US eng / full-time / YOE-capped public feed): up to ${cap} new jobs.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Scoutify scrape', error });
  }
});

router.post('/scrape/career-portals', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running.' });
    }
    const cap = parseScrapeCap(req.body);
    const jobType = 'fulltime' as const;
    runScrapeCareerPortals(cap, jobType).catch(console.error);
    res.json({ message: `Google Jobs scrape started (US): up to ${cap} new full-time jobs.` });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Google Jobs scrape', error });
  }
});

router.post('/prune-summer-2027', async (_req: Request, res: Response) => {
  try {
    return res.status(400).json({
      message:
        'Blocked: prune-summer-2027 would delete full-time jobs. Use job filters or delete individually. (Internship-only prune is disabled for Karthik FT targeting.)',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error pruning jobs', error });
  }
});

router.post('/reset-all', async (_req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Another task is running: wait before resetting jobs.' });
    }
    const count = await resetAllJobsToScraped();
    res.json({
      message: `Reset ${count} job(s) to scraped and removed their generated/uploaded resume files.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting jobs', error });
  }
});

const MANUAL_STATUSES: JobStatus[] = [
  'scraped',
  'resume_generated',
  'pdf_uploaded',
  'applied',
  'assessment',
  'interview',
  'confused_hold',
  'invalid_job',
  'accepted',
  'failed',
];

router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const status = req.body?.status as JobStatus;
    if (!MANUAL_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Use one of: ${MANUAL_STATUSES.join(', ')}`,
      });
    }

    job.status = status;
    job.pendingAction = null;
    job.errorMessage = undefined;
    job.applyPhase = status === 'confused_hold' ? 'confused_hold' : 'idle';
    if (status === 'scraped') {
      job.resumePhase = 'idle';
    }
    if (status === 'applied') {
      if (!job.appliedAt) job.appliedAt = new Date();
      if (!job.followUpAt) {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        job.followUpAt = d;
      }
      job.approvalNote = 'Marked as applied.';
    } else if (status === 'scraped') {
      job.approvalNote = 'Scraped: generate resume manually, then upload PDF.';
    } else if (status === 'resume_generated') {
      job.approvalNote = 'Resume generated: upload your PDF when ready.';
    } else if (status === 'pdf_uploaded') {
      job.approvalNote = 'PDF on file: apply on LinkedIn when ready.';
    } else if (status === 'assessment') {
      job.approvalNote = 'Assessment stage: complete the take-home or online test.';
    } else if (status === 'interview') {
      job.approvalNote = 'Interview stage: prep and track interview rounds.';
    } else if (status === 'confused_hold') {
      job.approvalNote = 'Confused/Hold: unclear fit or need to revisit later.';
    } else if (status === 'invalid_job') {
      job.approvalNote = 'Marked invalid: not a fit or wrong posting.';
    } else if (status === 'accepted') {
      job.approvalNote = 'Offer accepted: congratulations!';
    } else if (status === 'failed') {
      job.approvalNote = 'Marked as failed or skipped.';
    }
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error updating status', error });
  }
});

/** Notes, interest stars, follow-up date, cover letter / message drafts. */
router.patch('/:id/workspace', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (typeof req.body?.notes === 'string') {
      job.notes = req.body.notes.slice(0, 8000);
    }
    if (req.body?.interest === null || req.body?.interest === '') {
      job.interest = undefined;
    } else if (req.body?.interest != null) {
      const n = Number(req.body.interest);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        return res.status(400).json({ message: 'interest must be 1–5' });
      }
      job.interest = Math.round(n);
    }
    if (req.body?.followUpAt === null || req.body?.followUpAt === '') {
      job.followUpAt = undefined;
    } else if (typeof req.body?.followUpAt === 'string') {
      const d = new Date(req.body.followUpAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'Invalid followUpAt' });
      }
      job.followUpAt = d;
    }
    if (typeof req.body?.coverLetterDraft === 'string') {
      const { normalizeCoverLetterBody } = await import('../services/coverLetterPdf');
      job.coverLetterDraft = normalizeCoverLetterBody(req.body.coverLetterDraft.slice(0, 12000), {
        title: job.title,
        company: job.company,
      });
    }
    if (typeof req.body?.recruiterMessageDraft === 'string') {
      job.recruiterMessageDraft = req.body.recruiterMessageDraft.slice(0, 4000);
    }
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error updating workspace', error });
  }
});

/** Generate cover letter + LinkedIn note + contact suggestions for this job. */
router.post('/:id/generate-outreach', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    const { generateOutreachArtifacts } = await import('../services/outreachService');
    await generateOutreachArtifacts(String(job._id));
    const refreshed = await Job.findById(job._id);
    res.json({
      message: 'Cover letter & outreach drafts ready',
      job: refreshed,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Outreach generation failed',
      error: String(error),
    });
  }
});

/** Download cover letter as a PDF file (for ATS Additional Attachments uploads). */
router.get('/:id/cover-letter.pdf', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const { applicationProfile } = await import('../data/applicationProfile');
    const { writeCoverLetterPdf } = await import('../services/coverLetterPdf');
    const text = String(job.coverLetterDraft || applicationProfile.coverLetter || '').trim();
    if (!text) {
      return res.status(404).json({
        message: 'No cover letter yet — click Generate cover letter first.',
      });
    }

    const { buffer, filename } = writeCoverLetterPdf({
      jobId: String(job._id),
      text,
      company: job.company,
      title: job.title,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(buffer);
  } catch (error) {
    console.error('cover-letter.pdf:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to build cover letter PDF',
    });
  }
});

/** Edit JD text; optionally re-queue resume generation against the updated description. */
router.patch('/:id/job-description', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const jobDescription =
      typeof req.body?.jobDescription === 'string' ? req.body.jobDescription.trim() : '';
    if (!jobDescription || jobDescription.length < 40) {
      return res.status(400).json({
        message: 'Job description must be at least 40 characters.',
      });
    }

    const regenerate = req.body?.regenerate !== false;
    job.jobDescription = cleanJobDescriptionForResume(jobDescription);
    job.errorMessage = undefined;

    if (regenerate) {
      job.status = 'resume_generating';
      job.resumePhase = 'saving_jd';
      job.pendingAction = null;
      job.matchScore = undefined;
      job.keywordMatchScore = undefined;
      job.matchedKeywords = undefined;
      job.missingKeywords = undefined;
      job.skillGaps = undefined;
      job.approvalNote = `JD saved: starting resume generation (${resumeAgentLabel()})…`;
      await job.save();
      enqueueSingleOllamaResume(job.id);
      return res.json({
        job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
        message: 'JD saved: resume regeneration started. Watch progress steps below.',
      });
    }

    job.resumePhase = 'idle';
    job.approvalNote = 'JD updated: generate a resume when ready.';
    await job.save();
    res.json({
      job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
      message: 'Job description saved.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating job description', error });
  }
});

router.post('/scrape', async (_req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Scrape or pipeline already running. Wait for it to finish.' });
    }
    runScrapeOnly().catch(console.error);
    res.json({
      message:
        'Scraping Google Jobs (United States) for full-time / new-grad software roles.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting scrape', error });
  }
});

router.post('/refresh-jobs', async (_req: Request, res: Response) => {
  try {
    refreshExistingJobs().catch(console.error);
    res.json({ message: 'Refreshing all existing job listings (posted date, applicants).' });
  } catch (error) {
    res.status(500).json({ message: 'Error starting refresh', error });
  }
});

router.post('/:id/generate-resume', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    enqueueSingleResume(job.id);
    res.json({
      message: `Resume agent queued (${resumeAgentLabel()}): LaTeX in ~1–3 min.`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = /already running/i.test(msg) ? 409 : 500;
    res.status(status).json({ message: msg || 'Error starting pipeline', error: msg });
  }
});

router.post('/:id/generate-resume-ollama', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.status = 'resume_generating';
    job.resumePhase = 'generating';
    job.approvalNote = `Generating tailored resume (${resumeAgentLabel()})…`;
    await job.save();
    enqueueSingleOllamaResume(job.id);
    res.json({
      message: `Resume agent started (${resumeAgentLabel()}): watch progress steps on the job panel.`,
      job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = /already running/i.test(msg) ? 409 : 500;
    res.status(status).json({ message: msg || 'Error starting Ollama resume generation', error: msg });
  }
});

/** Recompute keyword + resume match scores from current JD + LaTeX. */
router.get('/:id/match-score', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!job.latexResume?.trim()) {
      return res.status(400).json({ message: 'No LaTeX resume on this job yet.' });
    }
    const match = scoreResumeAgainstJd(job.jobDescription, job.latexResume);
    applyMatchFieldsToJob(job, match);
    await job.save();
    res.json({
      resumeMatchScore: match.score,
      keywordMatchScore: match.score,
      matchedKeywords: match.matched,
      missingKeywords: match.missing,
      skillGaps: job.skillGaps || [],
      keywords: match.keywords,
      whyNot100:
        match.score >= 100 || match.missing.length === 0
          ? null
          : `Keyword coverage is ${match.score}%: missing ${match.missing.length} of ${match.keywords.length} JD keywords: ${match.missing.slice(0, 12).join(', ')}.`,
      job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error scoring resume', error });
  }
});

router.post('/:id/latex', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const latex = typeof req.body?.latex === 'string' ? sanitizeResumeLatex(req.body.latex.trim()) : '';
    if (!latex) return res.status(400).json({ message: 'LaTeX content is required' });

    // Keep the editor source exactly as the user typed it (minus dash sanitize),
    // but always rewrite the generic amazon header from this job's title/JD.
    const withHeader = applyJdHeaderTagline(latex, {
      title: job.title,
      jobDescription: job.jobDescription,
      company: job.company,
    });
    job.latexResume = withHeader;
    job.errorMessage = undefined;

    try {
      // preserveUserLatex: Recompile must reflect editor edits (Overleaf-style).
      const { pdfPath, pageCount } = compileLatexToPdf(withHeader, job.id, {
        preserveUserLatex: true,
        header: {
          title: job.title,
          jobDescription: job.jobDescription,
          company: job.company,
        },
      });
      job.pdfPath = pdfPath;
      job.latexResume = withHeader;
      applyMatchFieldsToJob(job, scoreResumeAgainstJd(job.jobDescription, withHeader));

      if (pageCount !== 1) {
        job.status = 'resume_generated';
        job.pendingAction = 'resume_review';
        job.errorMessage = `PDF is ${pageCount} page(s): must be exactly 1. Edit LaTeX and Recompile again.`;
        job.approvalNote = `Compiled to ${pageCount} page(s). Your edits are in the PDF: trim until exactly 1 page (template lock). Resume match ${job.matchScore ?? 0}%.`;
        await job.save();
        return res.status(200).json({
          message: job.errorMessage,
          pageCount,
          warning: job.errorMessage,
          job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
        });
      }

      job.status = 'pending_resume_approval';
      job.pendingAction = 'resume_review';
      job.errorMessage = undefined;
      job.approvalNote =
        job.priority === 'faang'
          ? `🚨 FAANG/MANGO: 1-page PDF ready (${job.matchScore ?? 0}% JD match). Apply manually on company site.`
          : `LaTeX recompiled: PDF preview updated. Resume match ${job.matchScore ?? 0}% · keyword match ${job.keywordMatchScore ?? 0}%.`;
      await job.save();
      return res.json({
        pageCount,
        job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
      });
    } catch (compileErr) {
      job.status = 'resume_generated';
      job.pendingAction = null;
      job.approvalNote =
        'LaTeX saved but PDF compile failed. Fix the LaTeX errors and Recompile, or upload a PDF manually.';
      job.errorMessage =
        compileErr instanceof Error ? compileErr.message : 'LaTeX compile failed';
      await job.save();
      return res.status(422).json({
        message: job.errorMessage,
        job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
      });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error saving LaTeX', error });
  }
});

router.post('/apply-career-queue', async (req: Request, res: Response) => {
  try {
    if (isScrapeRunning() || isPipelineRunning()) {
      return res.status(409).json({ message: 'Another task is already running.' });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit) || 20));
    runCareerApplyQueue(limit).catch(console.error);
    res.json({
      message: `Career-page apply queue started (up to ${limit}). Approve Submit in the tracker for each job.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting career apply queue', error });
  }
});

router.post('/:id/approve-resume', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!job.pdfPath) {
      return res.status(400).json({
        message: 'No PDF on file. Paste LaTeX from Ollama and build PDF, or upload a PDF manually.',
      });
    }

    job.pendingAction = null;
    job.status = 'pdf_uploaded';
    job.errorMessage = undefined;
    job.approvalNote =
      job.priority === 'faang'
        ? '🚨 FAANG/MANGO: resume approved. Apply manually on company site.'
        : /linkedin\.com\/(jobs|job)/i.test(job.url)
          ? 'Resume approved: click Auto-Apply for LinkedIn Easy Apply (approve before Submit).'
          : 'Resume approved: click Auto-Apply when ready.';
    await job.save();
    res.json(normalizeJob(job.toObject() as unknown as Record<string, unknown>));
  } catch (error) {
    res.status(500).json({ message: 'Error approving resume', error });
  }
});

router.post('/:id/approve-resume-and-apply', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!job.pdfPath) {
      return res.status(400).json({ message: 'No PDF on file.' });
    }
    if (job.priority === 'faang') {
      return res.status(400).json({
        message:
          'FAANG/MANGO roles are never auto-applied. Open the job URL and apply yourself.',
      });
    }
    if (!job.pdfPath) {
      return res.status(400).json({ message: 'No PDF on file.' });
    }

    job.pendingAction = null;
    job.status = 'pdf_uploaded';
    job.errorMessage = undefined;
    const detection = detectAts(job.url, job.source);
    const pathLabel = prefersCareerApply(job.url, job.source)
      ? `${detection.label} career apply`
      : 'LinkedIn Easy Apply';
    job.approvalNote = `Resume approved: starting ${pathLabel} (approve before Submit)…`;
    await job.save();

    autoApplyToJob(job.id).catch(console.error);
    res.json({
      message: `Resume approved and ${pathLabel} started. Review Chrome, then approve final Submit.`,
      job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error approving and applying', error });
  }
});

router.post('/:id/upload-pdf', upload.single('resume'), async (req: Request, res: Response) => {
  let writtenPath: string | undefined;
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!req.file) return res.status(400).json({ message: 'PDF file is required' });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    writtenPath = path.join(config.uploadsDir, `${job.id}-${Date.now()}-${safeName}`);
    fs.writeFileSync(writtenPath, req.file.buffer);

    const previousPath = job.pdfPath;
    job.pdfPath = writtenPath;
    job.status = 'pending_resume_approval';
    job.pendingAction = 'resume_review';
    job.errorMessage = undefined;
    job.approvalNote = 'PDF uploaded: review preview, then approve to apply.';
    await job.save();
    removeJobResumeFiles(job.id, previousPath, [writtenPath]);
    res.json(normalizeJob(job.toObject() as unknown as Record<string, unknown>));
  } catch (error) {
    if (writtenPath) {
      try {
        fs.unlinkSync(writtenPath);
      } catch {
        // Best-effort rollback if the database update failed.
      }
    }
    res.status(500).json({ message: 'Error uploading PDF', error });
  }
});

router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!job.pdfPath) return res.status(400).json({ message: 'Upload PDF before applying' });
    if (job.status === 'pending_resume_approval') {
      return res.status(400).json({ message: 'Approve the resume PDF before applying.' });
    }
    if (job.priority === 'faang') {
      return res.status(400).json({
        message:
          'FAANG/MANGO roles are never auto-applied. Open the job URL and apply yourself.',
      });
    }
    if (String(job.jobType) === 'internship') {
      return res.status(400).json({
        message: 'Internship listings are ignored. This tracker is full-time / new-grad only.',
      });
    }

    const detection = detectAts(job.url, job.source);
    autoApplyToJob(job.id).catch(console.error);
    res.json({
      message: `${detection.label} apply started. Forms fill automatically; approve final Submit in the tracker.`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting apply', error });
  }
});

router.post('/:id/approve-message', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (typeof req.body?.message === 'string' && req.body.message.trim()) {
      job.recruiterMessageDraft = req.body.message.trim();
    }
    job.pendingAction = null;
    job.status = 'applying';
    job.approvalNote = 'Message approved. Continuing application.';
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error approving message', error });
  }
});

router.post('/:id/approve-submit', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.pendingAction = null;
    job.approvalNote = 'Submit approved. Selenium will complete the application.';
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error approving submit', error });
  }
});

/**
 * Bring the stored job URL into orange Chrome so you can review the form
 * (Approve Submit is useless if Chrome is on a different tab/site).
 */
router.post('/:id/show-in-chrome', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    const { sanitizeStoredJobUrl } = await import('../services/jobrightApplyLink');
    const { attachDriver, releaseDriver } = await import('../services/chromeProfile');
    const { config } = await import('../config');
    const target = sanitizeStoredJobUrl(job.url);
    let driver = null as import('selenium-webdriver').WebDriver | null;
    try {
      driver = await attachDriver({
        kind: 'orange',
        userDataDir: config.linkedin.userDataDir,
        profileDirectory: config.linkedin.profileDirectory,
        debugPort: config.linkedin.debugPort,
        headless: config.linkedin.headless,
        startUrl: target,
      });
      await driver.get(target);
      await driver.sleep(2000);
      // Nudge window focus
      try {
        await driver.executeScript('window.focus();');
      } catch {
        // ignore
      }
      const currentUrl = await driver.getCurrentUrl();
      const title = await driver.getTitle();
      job.approvalNote = `Opened in orange Chrome for review: ${title || currentUrl}`;
      await job.save();
      res.json({ message: 'Opened in orange Chrome', url: currentUrl, title, job });
    } finally {
      await releaseDriver(driver);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ message: `Could not open Chrome: ${message}` });
  }
});

router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    job.status = 'failed';
    job.pendingAction = null;
    job.errorMessage = (req.body?.reason as string) || 'Rejected by user';
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting job step', error });
  }
});

export default router;
