/**
 * Resume attach only — set tracker PDF on the page file input.
 * Never clicks Submit. Used after Simplify (or manual) form fill.
 * Single-upload: never assign+drop both (Workday duplicates resumes).
 */
(function () {
  const VERSION = 17;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function fieldLabel(el) {
    const bits = [];
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) bits.push(lab.innerText || '');
      } catch {
        /* */
      }
    }
    bits.push(el.getAttribute('aria-label') || '');
    bits.push(el.getAttribute('name') || '');
    bits.push(el.accept || '');
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function isGreenhouseHost() {
    return /greenhouse\.io/i.test(location.hostname);
  }

  function isWorkdayHost() {
    return /myworkdayjobs\.com|workday\.com/i.test(location.hostname);
  }

  function pageMentionsFilename(name) {
    if (!name) return false;
    return (document.body?.innerText || '').includes(name);
  }

  function countFilenameMentions(name) {
    if (!name) return 0;
    const body = document.body?.innerText || '';
    let n = 0;
    let idx = 0;
    while ((idx = body.indexOf(name, idx)) !== -1) {
      n += 1;
      idx += name.length;
    }
    return n;
  }

  function inputMeta(el) {
    const wrap = el.closest(
      '[data-automation-id], .ant-upload, [class*="upload"], [class*="Upload"], [class*="resume"], [class*="Resume"], [class*="cover"], [data-provides="fileinput"], form, fieldset, li, section, div'
    );
    return [
      fieldLabel(el),
      el.accept || '',
      el.name || '',
      el.id || '',
      el.className || '',
      el.getAttribute('data-automation-id') || '',
      wrap?.className || '',
      wrap?.getAttribute?.('aria-label') || '',
      wrap?.getAttribute?.('data-automation-id') || '',
      (wrap?.querySelector?.('label, h2, h3, legend, [class*="label"]')?.innerText || '').slice(0, 80),
      (wrap?.innerText || '').slice(0, 120),
    ]
      .join(' ')
      .toLowerCase();
  }

  function isCoverLetterInput(el) {
    return /cover.?letter|coverletter|cover_letter/.test(inputMeta(el));
  }

  function isResumeInput(el) {
    if (isCoverLetterInput(el)) return false;
    return /resume|cv|curriculum|job_application\[resume\]|file-upload-input|--input/.test(
      inputMeta(el)
    );
  }

  function dedupeInputs(inputs) {
    const seen = new Set();
    const out = [];
    for (const el of inputs) {
      const key = `${el.name || ''}|${el.id || ''}|${el.getAttribute('data-automation-id') || ''}|${el.accept || ''}`;
      if (seen.has(el)) continue;
      seen.add(el);
      if (key !== '|||' && seen.has(key)) continue;
      if (key !== '|||') seen.add(key);
      out.push(el);
    }
    return out;
  }

  function findFileInputs(kind) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(
      (el) => !el.disabled
    );
    const scored = inputs
      .map((el) => {
        const meta = inputMeta(el);
        const cover = isCoverLetterInput(el);
        const resume = isResumeInput(el);
        if (kind === 'resume' && cover) return null;
        if (kind === 'cover_letter' && !cover) return null;
        if (kind === 'resume' && !resume) {
          // Workday unlabeled file inputs only
          if (!(isWorkdayHost() && !cover)) return null;
        }
        let score = 10;
        if (kind === 'resume' && /resume|cv|curriculum|job_application\[resume\]/.test(meta)) {
          score -= 8;
        }
        if (kind === 'cover_letter' && /cover.?letter|coverletter/.test(meta)) score -= 8;
        if ((el.accept || '').includes('pdf') || /pdf/.test(meta)) score -= 2;
        // Prefer empty inputs so we don't stack a second upload
        if (el.files && el.files.length) score += 5;
        return { el, score };
      })
      .filter(Boolean);
    scored.sort((a, b) => a.score - b.score);
    return dedupeInputs(scored.map((s) => s.el));
  }

  /** Click one Attach control — never spam (Workday doubles uploads). */
  async function revealUploader(kind) {
    const wantCover = kind === 'cover_letter';
    const candidates = Array.from(
      document.querySelectorAll('button, a, [role="button"], label')
    ).filter((el) => {
      const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!t || t.length > 48) return false;
      if (/^attach$/i.test(t) || /^attach\s*(resume|cv|file|cover)?$/i.test(t)) return true;
      if (/select file|upload resume|choose file|drag your resume|drop files/i.test(t)) return true;
      return false;
    });

    const ranked = candidates
      .map((el) => {
        const block = el.closest(
          'div, section, fieldset, li, [class*="resume"], [class*="Resume"], [class*="cover"], [data-testid], [data-automation-id]'
        );
        const context = `${block?.innerText || ''} ${fieldLabel(el)}`.toLowerCase();
        let score = 5;
        const hasResume = /resume|cv|curriculum/.test(context);
        const hasCover = /cover.?letter|coverletter/.test(context);
        if (wantCover) {
          if (hasCover) score -= 4;
          if (hasResume && !hasCover) score += 6;
        } else {
          if (hasResume) score -= 4;
          if (hasCover && !hasResume) score += 6;
        }
        return { el, score };
      })
      .sort((a, b) => a.score - b.score);

    const best = ranked[0];
    if (!best) return;
    try {
      best.el.click();
    } catch {
      /* */
    }
    await sleep(250);
  }

  function assignFileToInput(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      input.files = dt.files;
    } catch {
      try {
        Object.defineProperty(input, 'files', { configurable: true, value: dt.files });
      } catch {
        return false;
      }
    }
    try {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
      if (desc?.set) desc.set.call(input, dt.files);
    } catch {
      /* */
    }
    // Single change event — Workday treats repeats as multiple uploads
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return !!(input.files && input.files.length);
  }

  function dropFileOnTarget(target, file) {
    if (!target) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      try {
        target.dispatchEvent(new DragEvent(type, opts));
      } catch {
        /* */
      }
    }
  }

  /**
   * Attach exactly once to the best matching input.
   * Never assign+drop both (Workday creates duplicate upload chips).
   */
  async function assignNamedPdf(file, kind) {
    let inputs = findFileInputs(kind);
    if (!inputs.length) {
      await revealUploader(kind);
      await sleep(250);
      inputs = findFileInputs(kind);
    } else if (isGreenhouseHost() && kind === 'resume' && !inputs.some((el) => isResumeInput(el))) {
      await revealUploader(kind);
      await sleep(250);
      inputs = findFileInputs(kind);
    }

    if (!inputs.length && kind === 'resume') {
      inputs = dedupeInputs(
        Array.from(document.querySelectorAll('input[type="file"]')).filter(
          (el) => !el.disabled && !isCoverLetterInput(el)
        )
      );
    }
    if (!inputs.length) return { ok: false, filename: file.name, kind };

    const input = inputs[0];
    let assigned = assignFileToInput(input, file);
    // Drop only as fallback when assign failed — and never on Workday
    if (!assigned && !isWorkdayHost()) {
      const host = input.closest(
        '.ant-upload-drag, .ant-upload, [class*="upload"], [data-automation-id*="file"]'
      );
      if (host) dropFileOnTarget(host, file);
      await sleep(120);
      assigned = assignFileToInput(input, file) || assigned;
    }

    const shown = pageMentionsFilename(file.name);
    return {
      ok: assigned || shown,
      filename: file.name,
      kind,
      target: fieldLabel(input) || kind,
      alreadyOnPage: shown,
    };
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function findCoverLetterTextAreas() {
    return Array.from(document.querySelectorAll('textarea, input[type="text"]')).filter((el) => {
      if (el.disabled || el.readOnly) return false;
      const meta = [
        fieldLabel(el),
        el.name || '',
        el.id || '',
        el.placeholder || '',
        el.getAttribute('aria-label') || '',
        el.closest('div, section, fieldset, li')?.innerText?.slice(0, 160) || '',
      ]
        .join(' ')
        .toLowerCase();
      return /cover.?letter|coverletter|cover_letter/.test(meta);
    });
  }

  function hasCoverLetterFileField() {
    return findFileInputs('cover_letter').length > 0;
  }

  async function revealCoverLetterManualEntry() {
    const buttons = Array.from(
      document.querySelectorAll('button, a, [role="button"], span, div, label')
    ).filter((el) => {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40) return false;
      return /enter manually|type manually|paste|write (a )?cover/i.test(t);
    });
    for (const el of buttons.slice(0, 2)) {
      const ctx = (el.closest('div, section, li, fieldset')?.innerText || '').toLowerCase();
      if (/cover/.test(ctx) || /enter manually/i.test(el.innerText || '')) {
        try {
          el.click();
        } catch {
          /* */
        }
        await sleep(250);
      }
    }
  }

  /** Minimal one-page PDF from plain cover-letter text (for file-upload fields). */
  function simplePdfFromText(text) {
    const lines = String(text || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .flatMap((line) => {
        const words = line.split(/\s+/).filter(Boolean);
        if (!words.length) return [''];
        const out = [];
        let cur = '';
        for (const w of words) {
          const next = cur ? `${cur} ${w}` : w;
          if (next.length > 90) {
            if (cur) out.push(cur);
            cur = w;
          } else cur = next;
        }
        if (cur) out.push(cur);
        return out;
      })
      .slice(0, 45);

    const escapePdf = (s) =>
      String(s)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

    const ops = ['BT', '/F1 11 Tf', '50 750 Td', '14 TL'];
    lines.forEach((line, i) => {
      if (i === 0) ops.push(`(${escapePdf(line)}) Tj`);
      else ops.push('T*', `(${escapePdf(line)}) Tj`);
    });
    ops.push('ET');
    const stream = ops.join('\n');
    const objects = [];
    objects.push('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');
    objects.push('2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n');
    objects.push(
      '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n'
    );
    objects.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`);
    objects.push('5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(pdf.length);
      pdf += obj;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let i = 1; i < offsets.length; i++) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const out = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 0xff;
    return out;
  }

  async function attachCoverLetter({ coverLetterText, coverLetterFilename }) {
    const text = String(coverLetterText || '').trim();
    if (!text) {
      return { ok: false, mode: null, error: 'No cover letter text from tracker/profile' };
    }

    // 1) Prefer textarea / Enter manually — never touches Resume/CV
    await revealCoverLetterManualEntry();
    let areas = findCoverLetterTextAreas();
    if (!areas.length) {
      await sleep(150);
      areas = findCoverLetterTextAreas();
    }
    if (areas.length) {
      setNativeValue(areas[0], text);
      await sleep(100);
      if (String(areas[0].value || '').trim().length > 20) {
        return {
          ok: true,
          mode: 'text',
          filename: null,
          target: fieldLabel(areas[0]) || 'cover letter text',
        };
      }
    }

    // 2) File upload ONLY if a dedicated cover-letter input exists
    if (!hasCoverLetterFileField()) {
      return { ok: false, mode: null, error: 'No separate cover letter field (skipped — resume only)' };
    }

    const coverName = coverLetterFilename || 'Karthik_Kovi_Cover_Letter.pdf';
    const coverFile = new File([simplePdfFromText(text)], coverName, { type: 'application/pdf' });
    const fileResult = await assignNamedPdf(coverFile, 'cover_letter');
    if (fileResult.ok) {
      return { ok: true, mode: 'file', filename: coverName, target: fileResult.target };
    }
    return { ok: false, mode: null, error: 'No cover letter field on page' };
  }

  async function attachResume({
    pdfUrl,
    filename,
    coverLetterFilename,
    alsoCoverLetter,
    coverLetterText,
    bytesBase64,
  }) {
    let bytes;
    try {
      if (bytesBase64) {
        bytes = base64ToUint8Array(bytesBase64);
      } else if (pdfUrl) {
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      } else {
        return { ok: false, error: 'Missing PDF — reload extension and retry' };
      }
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
    if (!bytes?.byteLength) return { ok: false, error: 'PDF is empty' };

    const resumeName = filename || 'Karthik_Kovi_Resume.pdf';

    // Already uploaded once (Simplify or prior attach) — do not stack a second chip
    const mentions = countFilenameMentions(resumeName);
    if (mentions >= 1 || /Successfully Uploaded!/i.test(document.body?.innerText || '')) {
      const alreadyOurs = mentions >= 1;
      if (alreadyOurs) {
        let coverResult = null;
        if (alsoCoverLetter) {
          coverResult = await attachCoverLetter({ coverLetterText, coverLetterFilename });
        }
        return {
          ok: true,
          target: 'resume already on page',
          filename: resumeName,
          bytes: bytes.byteLength,
          engine: VERSION,
          skippedDuplicate: true,
          coverAttached: !!(coverResult && coverResult.ok),
          coverMode: coverResult?.mode || null,
          coverFilename: coverResult?.filename || null,
          note: 'Resume already on page — skipped re-upload to avoid duplicates. Verify, then Submit yourself.',
        };
      }
    }

    const resumeFile = new File([bytes], resumeName, { type: 'application/pdf' });
    const resumeResult = await assignNamedPdf(resumeFile, 'resume');

    let coverResult = null;
    if (alsoCoverLetter) {
      coverResult = await attachCoverLetter({ coverLetterText, coverLetterFilename });
    }

    if (!resumeResult.ok) {
      return {
        ok: false,
        error:
          'No resume file input — click Attach under Resume/CV on the page, then Attach resume again',
        engine: VERSION,
        cover: coverResult,
      };
    }

    return {
      ok: true,
      target: resumeResult.target,
      filename: resumeResult.filename,
      bytes: bytes.byteLength,
      engine: VERSION,
      coverAttached: !!(coverResult && coverResult.ok),
      coverMode: coverResult?.mode || null,
      coverFilename: coverResult?.filename || null,
      note: coverResult?.ok
        ? coverResult.mode === 'text'
          ? 'Resume attached + cover letter text filled. Verify, then Submit yourself.'
          : 'Resume + cover letter PDF attached. Verify filenames, then Submit yourself.'
        : alsoCoverLetter
          ? `Resume attached once. Cover letter skipped: ${coverResult?.error || 'no field'}. Verify, then Submit yourself.`
          : 'Resume attached once. Verify filename on page, then Submit yourself.',
    };
  }

  window.__rmAttachVersion = VERSION;
  window.__rmFillVersion = VERSION;
  window.__rmAttachHandler = async function (message) {
    if (message?.type === 'RM_ATTACH_RESUME') {
      return attachResume(message.payload || {});
    }
    if (message?.type === 'RM_PAGE_META') {
      return {
        title: document.title || '',
        url: location.href,
        h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 160),
      };
    }
    if (message?.type === 'RM_VERSION') {
      return { version: VERSION };
    }
    return { ok: false, error: 'unknown' };
  };

  if (!window.__rmAttachListenerAttached) {
    window.__rmAttachListenerAttached = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      Promise.resolve(window.__rmAttachHandler(message))
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
      return true;
    });
  }
})();
