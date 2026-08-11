import { Router, Request, Response } from 'express';
import {
  deleteAnswer,
  lookupAnswer,
  mergedAnswerBank,
  normalizeQuestion,
  readAnswerBank,
  upsertAnswer,
  writeAnswerBank,
} from '../services/answerBankService';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const answers = mergedAnswerBank();
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.json({ answers, count: answers.length });
});

router.post('/', (req: Request, res: Response) => {
  const question = String(req.body?.question || '').trim();
  const answer = String(req.body?.answer || '').trim();
  if (!question || !answer) {
    return res.status(400).json({ message: 'question and answer required' });
  }
  const row = upsertAnswer(question, answer);
  res.json({ ok: true, answer: row, count: readAnswerBank().length });
});

router.post('/batch', (req: Request, res: Response) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ message: 'items[] required' });
  let added = 0;
  for (const item of items) {
    const question = String(item?.question || '').trim();
    const answer = String(item?.answer || '').trim();
    if (!question || !answer || answer.length > 4000) continue;
    upsertAnswer(question, answer);
    added += 1;
  }
  res.json({ ok: true, added, count: readAnswerBank().length });
});

router.post('/lookup', (req: Request, res: Response) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ message: 'question required' });
  res.json(lookupAnswer(question));
});

router.post('/delete', (req: Request, res: Response) => {
  const questionNorm =
    String(req.body?.questionNorm || '').trim() ||
    normalizeQuestion(String(req.body?.question || ''));
  if (!questionNorm) return res.status(400).json({ message: 'question or questionNorm required' });
  const ok = deleteAnswer(questionNorm);
  res.json({ ok, count: readAnswerBank().length });
});

/** Wipe custom answers (keeps profile defaults via merge on next GET). */
router.post('/reset-custom', (_req: Request, res: Response) => {
  writeAnswerBank([]);
  res.json({ ok: true, count: 0 });
});

export default router;
