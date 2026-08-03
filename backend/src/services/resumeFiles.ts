import fs from 'fs';
import path from 'path';
import { config } from '../config';

function resolvedUploadsDir(): string {
  return path.resolve(config.uploadsDir);
}

function isInsideUploads(filePath: string): boolean {
  const root = resolvedUploadsDir();
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function safeJobPrefix(jobId: string): string | null {
  const value = jobId.trim();
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  return `${value}-`;
}

/** Remove resume artifacts for one job, never files outside the configured uploads directory. */
export function removeJobResumeFiles(
  jobId: string,
  referencedPath?: string | null,
  keepPaths: string[] = []
): number {
  const keep = new Set(keepPaths.map((candidate) => path.resolve(candidate)));
  const candidates = new Set<string>();
  const prefix = safeJobPrefix(jobId);

  if (prefix && fs.existsSync(config.uploadsDir)) {
    for (const name of fs.readdirSync(config.uploadsDir)) {
      if (
        name.startsWith(prefix) &&
        /\.(?:pdf|tex)$/i.test(name)
      ) {
        candidates.add(path.join(config.uploadsDir, name));
      }
    }
  }

  if (referencedPath && isInsideUploads(referencedPath)) {
    candidates.add(referencedPath);
    if (/\.pdf$/i.test(referencedPath)) {
      candidates.add(referencedPath.replace(/\.pdf$/i, '.tex'));
    }
  }

  let removed = 0;
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (keep.has(resolved) || !isInsideUploads(resolved)) continue;
    try {
      if (fs.statSync(resolved).isFile()) {
        fs.unlinkSync(resolved);
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Could not remove resume artifact ${resolved}:`, error);
      }
    }
  }
  return removed;
}

/** Remove all PDF/TeX artifacts from the dedicated uploads directory. */
export function removeAllResumeFiles(): number {
  if (!fs.existsSync(config.uploadsDir)) return 0;

  let removed = 0;
  for (const name of fs.readdirSync(config.uploadsDir)) {
    if (!/\.(?:pdf|tex)$/i.test(name)) continue;
    const candidate = path.join(config.uploadsDir, name);
    if (!isInsideUploads(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.unlinkSync(candidate);
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Could not remove resume artifact ${candidate}:`, error);
      }
    }
  }
  return removed;
}
