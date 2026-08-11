import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';
import { Select } from 'selenium-webdriver/lib/select';
import {
  resolveRadioAnswer,
  resolveSelectAnswer,
  resolveTextAnswer,
  resolveTextareaAnswer,
  yesNoPhrases,
} from './applicationAnswers';
import type { FormQuestionContext } from './applyHelpers';
import { isHoneypotField } from './careerApplyUtils';
async function fuzzySelectOption(select: Select, answer: string, optionsText: string[]): Promise<string> {
  try {
    await select.selectByVisibleText(answer);
    return answer;
  } catch {
    for (const phrase of yesNoPhrases(answer)) {
      for (const option of optionsText) {
        if (
          phrase.toLowerCase().includes(option.toLowerCase()) ||
          option.toLowerCase().includes(phrase.toLowerCase())
        ) {
          await select.selectByVisibleText(option);
          return option;
        }
      }
    }
    const options = await select.getOptions();
    if (options.length > 1) {
      const pick = options[Math.min(1, options.length - 1)];
      const text = await pick.getText();
      await select.selectByVisibleText(text);
      return text;
    }
    return answer;
  }
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function labelForField(driver: WebDriver, field: WebElement): Promise<string> {
  const id = await field.getAttribute('id');
  if (id) {
    try {
      const label = await driver.findElement(By.css(`label[for="${cssEscape(id)}"]`));
      const text = (await label.getText()).trim();
      if (text) return text;
    } catch {
      // no label
    }
  }

  for (const attr of ['aria-label', 'placeholder', 'name', 'id']) {
    const value = await field.getAttribute(attr);
    if (value?.trim()) return value.trim();
  }

  try {
    const parent = await field.findElement(By.xpath('./ancestor::fieldset[1]'));
    const legend = await parent.findElement(By.css('legend'));
    const text = (await legend.getText()).trim();
    if (text) return text;
  } catch {
    // no fieldset
  }

  return 'Unknown';
}

async function fillTextInput(
  driver: WebDriver,
  input: WebElement,
  ctx: FormQuestionContext
): Promise<void> {
  if (!(await input.isDisplayed())) return;

  const labelOrg = await labelForField(driver, input);
  const nameAttr = (await input.getAttribute('name')) || '';
  const idAttr = (await input.getAttribute('id')) || '';
  // Workday + generic ATS honeypots — never fill (auto-apply research 2026).
  if (
    isHoneypotField(labelOrg) ||
    isHoneypotField(nameAttr) ||
    isHoneypotField(idAttr)
  ) {
    return;
  }

  const label = labelOrg.toLowerCase();
  const prev = (await input.getAttribute('value')) || '';
  if (!ctx.profile.overwritePreviousAnswers && prev.trim()) return;

  // Never fill name=Suffix / MI with years-of-experience fallback
  if (/^(suffix|mi|middle)$/i.test(nameAttr) || /^suffix$/i.test(label.trim())) {
    return;
  }

  let { answer, needsAutocomplete } = resolveTextAnswer(label, ctx.profile, ctx.workLocation);

  if (!answer && ctx.useAi && ctx.aiAnswer) {
    const ai = await ctx.aiAnswer(labelOrg, 'text', ctx.jobDescription);
    if (ai) answer = ai;
  }
  if (!answer) return;

  await input.clear();
  await input.sendKeys(answer);
  if (needsAutocomplete) {
    await driver.sleep(1200);
    await driver.actions().sendKeys(Key.ARROW_DOWN).sendKeys(Key.ENTER).perform();
  }
  console.log(`Form text: "${labelOrg}" → "${answer.slice(0, 60)}"`);
}

async function fillTextarea(
  driver: WebDriver,
  textArea: WebElement,
  ctx: FormQuestionContext
): Promise<void> {
  if (!(await textArea.isDisplayed())) return;

  const labelOrg = await labelForField(driver, textArea);
  const label = labelOrg.toLowerCase();
  const prev = (await textArea.getAttribute('value')) || '';
  if (!ctx.profile.overwritePreviousAnswers && prev.trim()) return;

  let answer = resolveTextareaAnswer(label, ctx.profile);
  if (!answer && ctx.useAi && ctx.aiAnswer) {
    const ai = await ctx.aiAnswer(labelOrg, 'textarea', ctx.jobDescription);
    if (ai) answer = ai;
  }

  if (answer) {
    await textArea.clear();
    await textArea.sendKeys(answer);
    console.log(`Form textarea: "${labelOrg}"`);
  }
}

async function fillSelect(driver: WebDriver, selectEl: WebElement, ctx: FormQuestionContext): Promise<void> {
  if (!(await selectEl.isDisplayed())) return;

  const select = new Select(selectEl);
  const labelOrg = await labelForField(driver, selectEl);
  const label = labelOrg.toLowerCase();
  const options = await select.getOptions();
  const optionsText = await Promise.all(options.map((o) => o.getText()));
  const selected = await select.getFirstSelectedOption();
  const prev = selected ? await selected.getText() : '';

  if (!ctx.profile.overwritePreviousAnswers && prev && prev !== 'Select an option') return;

  const answer = resolveSelectAnswer(label, ctx.profile, ctx.workLocation);
  if (!answer) return;

  const picked = await fuzzySelectOption(select, answer, optionsText);
  console.log(`Form select: "${labelOrg}" → "${picked}"`);
}

async function fillRadioGroup(
  driver: WebDriver,
  name: string,
  ctx: FormQuestionContext
): Promise<void> {
  const radios = await driver.findElements(By.css(`input[type="radio"][name="${cssEscape(name)}"]`));
  if (!radios.length) return;

  const first = radios[0];
  const labelOrg = await labelForField(driver, first);
  const label = labelOrg.toLowerCase();
  const answer = resolveRadioAnswer(label, ctx.profile);

  for (const radio of radios) {
    const id = await radio.getAttribute('id');
    if (!id) continue;
    try {
      const optionLabel = await driver.findElement(By.css(`label[for="${cssEscape(id)}"]`));
      const text = (await optionLabel.getText()).trim();
      for (const phrase of [answer, ...yesNoPhrases(answer)]) {
        if (
          text === phrase ||
          text.toLowerCase().includes(phrase.toLowerCase()) ||
          phrase.toLowerCase().includes(text.toLowerCase())
        ) {
          await optionLabel.click();
          console.log(`Form radio: "${labelOrg}" → "${text}"`);
          return;
        }
      }
    } catch {
      // try next
    }
  }

  if (radios[0]) {
    try {
      await radios[0].click();
    } catch {
      // ignore
    }
  }
}

async function fillCheckboxes(driver: WebDriver, root: WebDriver | WebElement): Promise<void> {
  const boxes = await root.findElements(
    By.css('input[type="checkbox"]:not([disabled])')
  );
  for (const box of boxes) {
    try {
      if (!(await box.isDisplayed())) continue;
      const selected = await box.isSelected();
      const labelText = (await labelForField(driver, box)).toLowerCase();
      if (
        !selected &&
        (labelText.includes('acknowledge') ||
          labelText.includes('agree') ||
          labelText.includes('confirm') ||
          labelText.includes('certify'))
      ) {
        await box.click();
      }
    } catch {
      // skip
    }
  }
}

/**
 * Fill visible form fields on any page (Indeed, Jobright redirects, Greenhouse, Lever, Workday, etc.).
 */
export async function fillGenericFormFields(
  driver: WebDriver,
  root: WebDriver | WebElement,
  ctx: FormQuestionContext
): Promise<void> {
  const textInputs = await root.findElements(
    By.css(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type])'
    )
  );
  for (const input of textInputs) {
    try {
      const type = ((await input.getAttribute('type')) || 'text').toLowerCase();
      if (['hidden', 'file', 'radio', 'checkbox', 'submit', 'button'].includes(type)) continue;
      await fillTextInput(driver, input, ctx);
    } catch {
      // skip field
    }
  }

  const textareas = await root.findElements(By.css('textarea'));
  for (const area of textareas) {
    try {
      await fillTextarea(driver, area, ctx);
    } catch {
      // skip
    }
  }

  const selects = await root.findElements(By.css('select'));
  for (const select of selects) {
    try {
      await fillSelect(driver, select, ctx);
    } catch {
      // skip
    }
  }

  // When root is the WebDriver, Selenium cannot pass it as a DOM node — use document.
  const radioScope = root === driver ? null : root;
  const radioNames = await driver.executeScript(
    `
    const arg = arguments[0];
    const root =
      arg && typeof arg.querySelectorAll === 'function' ? arg : document;
    const names = new Set();
    for (const el of Array.from(root.querySelectorAll('input[type="radio"][name]'))) {
      if (el.offsetParent !== null) names.add(el.name);
    }
    return [...names];
    `,
    radioScope
  );

  if (Array.isArray(radioNames)) {
    for (const name of radioNames as string[]) {
      try {
        await fillRadioGroup(driver, name, ctx);
      } catch {
        // skip
      }
    }
  }

  await fillCheckboxes(driver, root);
}

export async function findSubmitButton(
  root: WebDriver | WebElement
): Promise<WebElement | null> {
  const xpaths = [
    './/*[@data-automation-id="bottom-navigation-next-button" and (contains(translate(., "SUBMIT", "submit"), "submit") or contains(translate(., "REVIEW", "review"), "review"))]',
    './/*[@data-automation-id="pageFooterNextButton"]',
    './/button[contains(translate(., "SUBMIT", "submit"), "submit")]',
    './/button[contains(., "Send application")]',
    './/button[contains(., "Submit application")]',
    './/button[contains(., "Complete application")]',
    './/button[contains(translate(., "FINISH", "finish"), "finish")]',
    './/input[contains(translate(@value, "FINISH", "finish"), "finish")]',
    './/*[@id="buttonPrimary" and (contains(translate(@value, "FINISH", "finish"), "finish") or contains(translate(., "FINISH", "finish"), "finish"))]',
    './/*[@data-qa="btn-submit"]',
    './/*[@data-qa="btn-submit-application"]',
    './/input[@type="submit"]',
    './/button[@type="submit"]',
    // Some ATS use a plain "Apply" as the final submit — never treat "Apply Now" (JD entry) as submit.
    './/button[contains(translate(normalize-space(.), "APPLY", "apply"), "apply") and not(contains(translate(., "EASY", "easy"), "easy")) and not(contains(translate(., "APPLY NOW", "apply now"), "apply now"))]',
  ];

  for (const xpath of xpaths) {
    const buttons = await root.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
        const text = (
          ((await btn.getText()) || '') +
          ' ' +
          ((await btn.getAttribute('value')) || '') +
          ' ' +
          ((await btn.getAttribute('aria-label')) || '')
        )
          .trim()
          .toLowerCase();
        if (!text) continue;
        // Never treat login / account-wall CTAs as application submit
        if (
          /standard login|sign in|log in|login|create account|sign up|register|forgot password/.test(
            text
          )
        ) {
          continue;
        }
        // Resume upload step (AppOne "Submit Resume") is not the final application submit
        if (/submit resume|upload resume|attach resume|upload cv|submit cv/.test(text)) {
          continue;
        }
        // "Continue" / "Next" are multi-step navigation — handled by findNextButton
        if (/^(continue|next|save and continue)$/i.test(text.trim())) continue;
        if (text === 'apply now' || text.startsWith('apply now')) continue;
        if (await btn.isDisplayed() && await btn.isEnabled()) return btn;
      } catch {
        // try next
      }
    }
  }
  return null;
}

export async function findNextButton(root: WebDriver | WebElement): Promise<WebElement | null> {
  const xpaths = [
    './/*[@data-automation-id="bottom-navigation-next-button"]',
    './/*[@data-automation-id="pageFooterNextButton"]',
    './/button[contains(., "Next")]',
    './/button[contains(., "Continue")]',
    './/button[contains(., "Save and Continue")]',
    './/button[contains(., "Review")]',
    './/a[contains(., "Next")]',
    './/input[@value="Next"]',
    './/input[@value="Continue"]',
    './/input[contains(@value, "Continue")]',
    './/input[@id="ucButtons_btnSubmit"]',
    './/input[contains(@name, "btnSubmit")]',
    './/input[contains(@value, "Submit Resume")]',
    './/button[contains(., "Submit Resume")]',
  ];

  for (const xpath of xpaths) {
    const buttons = await root.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
        const text = (
          ((await btn.getText()) || '') +
          ' ' +
          ((await btn.getAttribute('value')) || '')
        )
          .trim()
          .toLowerCase();
        // Skip login-wall continues that aren't form navigation
        if (/standard login|sign in|^log in$/.test(text)) continue;
        if (await btn.isDisplayed() && await btn.isEnabled()) return btn;
      } catch {
        // try next
      }
    }
  }
  return null;
}

export async function clickApplyEntryPoint(driver: WebDriver): Promise<boolean> {
  // Prefer a primary Apply CTA via DOM scoring (Paychex AppOne header vs sidebar [Apply Now]).
  try {
    const clicked = (await driver.executeScript(`
      function visible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const st = window.getComputedStyle(el);
        return st.visibility !== 'hidden' && st.display !== 'none';
      }
      function inNoise(el) {
        let n = el;
        for (let i = 0; i < 8 && n; i++) {
          const t = ((n.innerText || n.textContent || '') + ' ' + (n.className || '') + ' ' + (n.id || '')).toLowerCase();
          if (/we also recommend|other jobs|similar jobs|recommended|related jobs|sidebar/.test(t) && t.length < 4000) {
            // Only treat as noise if this subtree is a recommendation chrome, not the whole page
            if (/we also recommend|other jobs within|similar openings/.test(t)) return true;
          }
          n = n.parentElement;
        }
        return false;
      }
      const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]'));
      let best = null;
      let bestScore = -1;
      for (const el of nodes) {
        if (!visible(el)) continue;
        if (inNoise(el)) continue;
        const text = ((el.innerText || el.value || el.getAttribute('aria-label') || el.textContent || '') + '').replace(/\\s+/g, ' ').trim();
        const low = text.toLowerCase();
        if (!low) continue;
        if (/applied|view application|already applied|withdraw/.test(low)) continue;
        if (!/\\bapply\\b/.test(low) && !/apply now|start application|apply for this|apply to this|apply with/.test(low)) continue;
        // Skip sidebar-style "[Apply Now]" for other listings when possible
        let score = 0;
        if (/^apply now$/i.test(text)) score += 50;
        else if (/apply now/i.test(text)) score += 35;
        else if (/^apply$/i.test(text)) score += 30;
        else if (/start application|apply for this job/i.test(text)) score += 40;
        else score += 10;
        const href = (el.getAttribute('href') || el.href || '').toLowerCase();
        if (/javascript:.*submit/.test(href)) score += 60;
        if (/applytojob|appone|\\/apply|apply\\?/.test(href)) score += 25;
        // Paychex sidebar / other-job links
        if (/\\[apply now\\]/.test(text)) score -= 40;
        if (/maininforeq\\.asp/.test(href) && /r_id=/.test(href)) score -= 30;
        const cls = String(el.className || '').toLowerCase() + ' ' + String(el.id || '').toLowerCase();
        if (/apply/.test(cls)) score += 15;
        // Prefer top-of-page primary CTA (Paychex grey bar)
        const top = el.getBoundingClientRect().top;
        if (top >= 0 && top < 220) score += 20;
        if (top >= 0 && top < 120) score += 10;
        // Prefer form-submit Apply Now over secondary Main.asp links
        if (/^apply now$/i.test(text) && /javascript:/i.test(href)) score += 25;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (!best || bestScore < 10) return { ok: false, score: bestScore };
      best.scrollIntoView({ block: 'center', inline: 'nearest' });
      best.click();
      return { ok: true, score: bestScore, text: ((best.innerText || best.value || '') + '').trim().slice(0, 80) };
    `)) as { ok: boolean; score?: number; text?: string };
    if (clicked?.ok) {
      await driver.sleep(2500);
      const handles = await driver.getAllWindowHandles();
      if (handles.length > 1) {
        await driver.switchTo().window(handles[handles.length - 1]);
      }
      console.log(`Career apply: clicked Apply entry (${clicked.text || 'Apply'}, score=${clicked.score})`);
      return true;
    }
  } catch (err) {
    console.warn('Career apply: primary Apply click script failed:', err);
  }

  // XPath fallback
  const xpaths = [
    "//a[normalize-space()='Apply Now' or normalize-space()='APPLY NOW']",
    "//button[normalize-space()='Apply Now' or normalize-space()='APPLY NOW']",
    "//a[contains(translate(., 'APPLY NOW', 'apply now'), 'apply now')]",
    "//button[contains(translate(., 'APPLY NOW', 'apply now'), 'apply now')]",
    "//a[contains(@href, 'ApplyToJob') or contains(@href, 'applytojob')]",
    "//a[contains(@href, '/apply')]",
    "//a[contains(@href, 'apply?')]",
    "//button[contains(translate(., 'APPLY', 'apply'), 'apply')]",
    "//a[contains(translate(., 'APPLY', 'apply'), 'apply')]",
    "//button[@id='indeedApplyButton']",
    "//button[contains(@data-testid, 'apply')]",
  ];

  for (const xpath of xpaths) {
    const buttons = await driver.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
        const text = (await btn.getText()).toLowerCase();
        if (text.includes('applied') || text.includes('view application')) continue;
        if (/\[apply now\]/.test(text) && text.length > 20) continue;
        if (await btn.isDisplayed() && await btn.isEnabled()) {
          const handlesBefore = await driver.getAllWindowHandles();
          try {
            await driver.executeScript('arguments[0].click();', btn);
          } catch {
            await btn.click();
          }
          await driver.sleep(2500);
          const handlesAfter = await driver.getAllWindowHandles();
          if (handlesAfter.length > handlesBefore.length) {
            await driver.switchTo().window(handlesAfter[handlesAfter.length - 1]);
          }
          return true;
        }
      } catch {
        // try next
      }
    }
  }
  return false;
}
