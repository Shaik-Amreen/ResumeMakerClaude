import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Job from '../models/Job';
import { config } from '../config';
import {
  runScrapeOnly,
  refreshExistingJobs,
  isScrapeRunning,
  runResumesForScrapedJobs,
  prepareAndGenerateResumes,
  enqueueSingleResume,
  rerunClaudeForJobsWithLatex,
  enqueueSingleClaude,
  enqueueSingleOllamaResume,
} from '../services/orchestratorService';
import { resetAllJobsToScraped, pruneNonSummer2027Jobs } from '../services/jobMaintenance';
import { getSchedulerStatus } from '../services/schedulerService';
import { filterJobs, normalizeJob, sortJobs, type JobRecord } from '../utils/jobQuery';
import type { JobStatus } from '../models/Job';
import { autoApplyToJob } from '../services/jobApplier';
import { compileLatexToPdf } from '../services/latexCompileService';

const router = Router();

fs.mkdirSync(config.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const jobId = req.params.id;
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${jobId}-${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

router.get('/scheduler/status', (_req: Request, res: Response) => {
  res.json(getSchedulerStatus());
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
    });
    const sorted = sortJobs(filtered, (req.query.sort as string) || 'priority');
    res.json(sorted.map((j) => normalizeJob(j)));
  } catch (error) {
    res.status(500).json({ message: 'Error fetching jobs', error });
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

router.post('/prepare-and-generate-resumes', async (_req: Request, res: Response) => {
  try {
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
        'Claude-only step queued — uses saved LaTeX or reads from open ChatGPT tab if needed.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Claude rerun', error });
  }
});

router.post('/generate-resumes', async (_req: Request, res: Response) => {
  try {
    const pending = await Job.countDocuments({ status: 'scraped' });
    runResumesForScrapedJobs().catch(console.error);
    res.json({
      message: `Resume generation started for ${pending} scraped job(s) — one by one (ChatGPT → Claude).`,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting resume queue', error });
  }
});

router.post('/prune-summer-2027', async (_req: Request, res: Response) => {
  try {
    const { removed, kept } = await pruneNonSummer2027Jobs();
    res.json({
      message: `Summer 2027 software-only filter: kept ${kept}, removed ${removed}.`,
      kept,
      removed,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error pruning jobs', error });
  }
});

router.post('/reset-all', async (_req: Request, res: Response) => {
  try {
    const count = await resetAllJobsToScraped();
    res.json({ message: `Reset ${count} job(s) to scraped. Upload resumes manually in job tracker.` });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting jobs', error });
  }
});

const MANUAL_STATUSES: JobStatus[] = [
  'scraped',
  'resume_generated',
  'pdf_uploaded',
  'applied',
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
    if (status === 'scraped') {
      job.approvalNote = 'Scraped — generate resume manually, then upload PDF.';
    } else if (status === 'resume_generated') {
      job.approvalNote = 'Resume generated — upload your PDF when ready.';
    } else if (status === 'pdf_uploaded') {
      job.approvalNote = 'PDF on file — apply on LinkedIn when ready.';
    } else if (status === 'applied') {
      job.approvalNote = 'Marked as applied.';
    } else if (status === 'failed') {
      job.approvalNote = 'Marked as failed / skipped.';
    }
    await job.save();
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: 'Error updating status', error });
  }
});

router.post('/scrape', async (_req: Request, res: Response) => {
  try {
    if (isScrapeRunning()) {
      return res.status(409).json({ message: 'Scrape already running. Wait for it to finish.' });
    }
    runScrapeOnly().catch(console.error);
    res.json({
      message:
        'Scraping FAANG + MANGOES career portals only (Summer 2027 software internships).',
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
    res.json({ message: 'Resume queued (sequential — runs after any jobs ahead in queue).' });
  } catch (error) {
    res.status(500).json({ message: 'Error starting pipeline', error });
  }
});

router.post('/:id/generate-resume-ollama', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    enqueueSingleOllamaResume(job.id);
    res.json({
      message:
        'Ollama resume generation started — Green Chrome will open, send JD to Ollama, compile PDF when done.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error starting Ollama resume generation', error });
  }
});

router.post('/:id/latex', async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    const latex = typeof req.body?.latex === 'string' ? req.body.latex.trim() : '';
    if (!latex) return res.status(400).json({ message: 'LaTeX content is required' });

    job.latexResume = latex;
    job.errorMessage = undefined;

    try {
      const { pdfPath } = compileLatexToPdf(latex, job.id);
      job.pdfPath = pdfPath;
      job.status = 'pending_resume_approval';
      job.pendingAction = 'resume_review';
      job.approvalNote =
        'LaTeX compiled to PDF — review the preview below. Approve to enable auto-apply (full-time).';
      await job.save();
      return res.json(normalizeJob(job.toObject() as unknown as Record<string, unknown>));
    } catch (compileErr) {
      job.status = 'resume_generated';
      job.pendingAction = null;
      job.approvalNote =
        'LaTeX saved but PDF compile failed. Install BasicTeX or upload a PDF manually.';
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
      job.jobType === 'fulltime'
        ? 'Resume approved. Click Auto-Apply when ready (submit still requires your approval).'
        : 'Resume approved. Apply manually on the company site for internships.';
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
    if (job.jobType !== 'fulltime') {
      return res.status(400).json({
        message: 'Auto-apply is full-time only. Approve the resume and apply manually for internships.',
      });
    }

    job.pendingAction = null;
    job.status = 'pdf_uploaded';
    job.errorMessage = undefined;
    job.approvalNote = 'Resume approved — starting auto-apply…';
    await job.save();

    autoApplyToJob(job.id).catch(console.error);
    res.json({
      message:
        'Resume approved and auto-apply started. You will be asked to approve before final submit.',
      job: normalizeJob(job.toObject() as unknown as Record<string, unknown>),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error approving and applying', error });
  }
});

router.post('/:id/upload-pdf', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (!req.file) return res.status(400).json({ message: 'PDF file is required' });

    job.pdfPath = req.file.path;
    job.status = 'pending_resume_approval';
    job.pendingAction = 'resume_review';
    job.errorMessage = undefined;
    job.approvalNote = 'PDF uploaded — review preview, then approve to apply.';
    await job.save();
    res.json(normalizeJob(job.toObject() as unknown as Record<string, unknown>));
  } catch (error) {
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
    if (job.jobType !== 'fulltime') {
      return res.status(400).json({
        message: 'Auto-apply is enabled for full-time jobs only. Apply to internships manually on the company site.',
      });
    }

    autoApplyToJob(job.id).catch(console.error);
    res.json({
      message:
        'Auto-apply started (full-time). Form questions will be filled automatically; you must approve before final submit.',
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
