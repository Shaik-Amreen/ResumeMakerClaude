import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config';

const OLLAMA_DB = path.join(os.homedir(), 'Library/Application Support/Ollama/db.sqlite');

export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Ollama desktop UI port (not 11434 API). Auto-detected from lsof when unset. */
export function detectOllamaDesktopPort(): number {
  if (config.ollama.desktopPort > 0) return config.ollama.desktopPort;

  try {
    const out = execSync('lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null | grep -i ollama', {
      encoding: 'utf8',
    });
    for (const line of out.split('\n')) {
      const match = line.match(/127\.0\.0\.1:(\d+)/);
      if (!match) continue;
      const port = Number(match[1]);
      if (port !== 11434 && port !== 11435) return port;
    }
  } catch {
    // fall through
  }

  return 0;
}

export function findOllamaChatIdByTitle(title: string): string | null {
  if (!fs.existsSync(OLLAMA_DB)) return null;

  const safe = title.replace(/'/g, "''");
  try {
    const id = execSync(`sqlite3 "${OLLAMA_DB}" "SELECT id FROM chats WHERE title = '${safe}' LIMIT 1;"`, {
      encoding: 'utf8',
    }).trim();
    return id || null;
  } catch {
    return null;
  }
}

export function resolveOllamaResumeChatId(): string {
  if (config.ollama.chatId?.trim()) return config.ollama.chatId.trim();

  const fromDb = findOllamaChatIdByTitle(config.ollama.chatName);
  if (fromDb) return fromDb;

  throw new Error(
    `Ollama chat "${config.ollama.chatName}" not found — create it in Ollama desktop or set OLLAMA_CHAT_ID in .env.`
  );
}

/** User correction / rule messages from the "Resumes" Ollama desktop chat. */
export function loadOllamaChatRules(): string {
  if (!fs.existsSync(OLLAMA_DB)) return '';

  try {
    const chatId = resolveOllamaResumeChatId();
    const db = new Database(OLLAMA_DB, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          `SELECT content FROM messages
           WHERE chat_id = ? AND role = 'user' AND length(content) BETWEEN 30 AND 4000
           ORDER BY id ASC`
        )
        .all(chatId) as { content: string }[];

      const skip = /^(hi|this|\?\?|can you generate latex)/i;
      const rules = rows
        .map((r) => r.content.trim())
        .filter((c) => c && !skip.test(c))
        .filter((c) => !c.includes('\\documentclass'))
        .filter((c) => !c.toLowerCase().includes('the latex code of my amazon'));

      if (!rules.length) return '';
      return rules.map((r) => `• ${r}`).join('\n\n');
    } finally {
      db.close();
    }
  } catch {
    return '';
  }
}

/** Recent turns from the Ollama desktop "Resumes" chat (read-only). */
export function loadOllamaChatMessages(chatId: string, maxMessages = 20): OllamaChatMessage[] {
  if (!fs.existsSync(OLLAMA_DB)) return [];

  const db = new Database(OLLAMA_DB, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare(
        `SELECT role, content FROM messages
         WHERE chat_id = ? AND role IN ('user', 'assistant') AND length(content) > 0
         ORDER BY id DESC LIMIT ?`
      )
      .all(chatId, maxMessages) as { role: string; content: string }[];

    return rows
      .reverse()
      .filter((r) => r.content.trim())
      .filter((r) => {
        // Drop prior LaTeX resume outputs — keep your instruction / setup messages
        if (r.role === 'assistant' && r.content.includes('```latex')) return false;
        if (r.content.length > 8000) return false;
        return true;
      })
      .map((r) => ({
        role: r.role as OllamaChatMessage['role'],
        content: r.content,
      }));
  } finally {
    db.close();
  }
}

/** Save user + assistant messages so they appear in Ollama desktop "Resumes" chat. */
export function appendOllamaChatMessages(
  chatId: string,
  userContent: string,
  assistantContent: string
): void {
  if (!fs.existsSync(OLLAMA_DB)) return;

  const db = new Database(OLLAMA_DB);
  try {
    const insert = db.prepare(
      `INSERT INTO messages (chat_id, role, content, thinking, stream, model_name, model_cloud, model_ollama_host)
       VALUES (?, ?, ?, '', 0, ?, 1, 0)`
    );
    insert.run(chatId, 'user', userContent, config.ollama.model);
    insert.run(chatId, 'assistant', assistantContent, config.ollama.model);
  } finally {
    db.close();
  }
}
