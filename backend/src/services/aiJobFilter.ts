import { config } from '../config';

export interface AiJobFilterResult {
  eligible: boolean;
  reason: string;
}

const SYSTEM_PROMPT = `You are a strict, objective technical recruiter screening job descriptions for a new-grad/junior Software Engineer (MS Computer Science candidate).
Your job is to read the provided Job Description (JD) and determine if the candidate is eligible.

RULES FOR INELIGIBILITY (If ANY of these are true, eligible must be false):
1. CLEARANCE: Requires an active US Security Clearance (Secret, Top Secret, TS/SCI) or explicitly states "US Citizenship required" (do not confuse with standard "authorized to work in US").
2. EXPERIENCE TOO HIGH: Strictly requires more than 3 years of professional experience (e.g., "5+ years required", "Senior", "Staff", "Lead"). 0-3 years is acceptable.
3. WRONG LEVEL: It is strictly for Undergraduate/Bachelors only, or PhD only. (The candidate has a Master's degree).
4. LOCATION: The role is located entirely outside of the United States.
5. NON-TECHNICAL: It is not a Software Engineering, Data, or IT role (e.g. it is sales, HR, or manual labor).

Output ONLY valid JSON matching this schema, with NO markdown formatting, NO code blocks, and NO extra text:
{
  "eligible": boolean,
  "reason": "Short 1-sentence explanation of why it is eligible or why it was rejected."
}`;

export async function evaluateJobWithAI(
  title: string,
  company: string,
  description: string
): Promise<AiJobFilterResult | null> {
  const userMessage = `TITLE: ${title}\nCOMPANY: ${company}\n\nDESCRIPTION:\n${description.slice(0, 10000)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const ollamaUrl = config.ollama?.apiUrl || 'http://127.0.0.1:11434';
    const ollamaModel = config.ollama?.model || 'qwen3.5:latest';

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: ollamaModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        stream: false,
        options: {
          temperature: 0.1
        }
      })
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    clearTimeout(timeoutId);

    const data = await res.json() as { message?: { content?: string } };
    let responseText = data.message?.content || '';

    // Strip out <think>...</think> if the model embeds it in the response
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '');

    // Clean up potential markdown blocks if the LLM ignores instructions
    let cleanText = responseText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    console.log('Ollama Response Text:', responseText);
    const parsed = JSON.parse(cleanText) as AiJobFilterResult;
    
    if (typeof parsed.eligible === 'boolean' && typeof parsed.reason === 'string') {
      return parsed;
    }
    
    console.warn('AI Filter returned malformed JSON shape:', parsed);
    return null;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.log('  ↳ AI Filter timed out (local LLM too slow).');
    } else {
      console.error('AI Job Filter failed:', error.message || error);
    }
    return null;
  }
}
