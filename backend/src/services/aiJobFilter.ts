import { openRouterChatCompletion } from './resumeAgent/openRouterProvider';
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
6. TIMING MISMATCH: The candidate graduates in December 2026 and starts full-time work in January 2027. Reject jobs that strictly require starting full-time BEFORE January 2027 (e.g., "Summer 2026 start"). If it says "2027 New Grad" or does not specify a strict start date, it is eligible.

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
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    // We race the chat completion against the abort controller since openRouterChatCompletion 
    // doesn't natively support passing a signal right now.
    const responsePromise = openRouterChatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { 
        maxTokens: 150, 
        temperature: 0.1, 
        model: config.scraperAi.model,
        apiKey: config.scraperAi.apiKey,
        baseUrl: config.scraperAi.baseUrl
      }
    );

    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('AbortError')));
    });

    let responseText = await Promise.race([responsePromise, abortPromise]);

    clearTimeout(timeoutId);

    // Strip out <think>...</think> if the model embeds it in the response
    responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '');

    // Clean up potential markdown blocks if the LLM ignores instructions
    let cleanText = responseText.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```/, '').replace(/```$/, '').trim();
    }

    // console.log('AI Filter Raw Output:', responseText);
    const parsed = JSON.parse(cleanText) as AiJobFilterResult;
    
    if (typeof parsed.eligible === 'boolean' && typeof parsed.reason === 'string') {
      return parsed;
    }
    
    console.warn('AI Filter returned malformed JSON shape:', parsed);
    return null;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.message === 'AbortError' || error.name === 'AbortError') {
      console.log('  ↳ AI Filter timed out (OpenRouter took > 10s).');
    } else {
      console.error('AI Job Filter failed:', error.message || error);
    }
    return null;
  }
}
