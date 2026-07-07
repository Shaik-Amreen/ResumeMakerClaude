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
  const label = labelOrg.toLowerCase();
  const prev = (await input.getAttribute('value')) || '';
  if (!ctx.profile.overwritePreviousAnswers && prev.trim()) return;

  let { answer, needsAutocomplete } = resolveTextAnswer(label, ctx.profile, ctx.workLocation);

  if (!answer && ctx.useAi && ctx.aiAnswer) {
    const ai = await ctx.aiAnswer(labelOrg, 'text', ctx.jobDescription);
    if (ai) answer = ai;
  }
  if (!answer) answer = ctx.profile.yearsOfExperience;

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

  const radioNames = await driver.executeScript(`
    const root = arguments[0];
    const names = new Set();
    for (const el of root.querySelectorAll('input[type="radio"][name]')) {
      if (el.offsetParent !== null) names.add(el.name);
    }
    return [...names];
  `, root);

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
    './/button[contains(translate(., "SUBMIT", "submit"), "submit")]',
    './/button[contains(translate(., "APPLY", "apply"), "apply") and not(contains(translate(., "EASY", "easy"), "easy"))]',
    './/input[@type="submit"]',
    './/button[@type="submit"]',
    './/button[contains(., "Send application")]',
    './/button[contains(., "Submit application")]',
    './/button[contains(., "Complete application")]',
  ];

  for (const xpath of xpaths) {
    const buttons = await root.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
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
    './/button[contains(., "Next")]',
    './/button[contains(., "Continue")]',
    './/button[contains(., "Review")]',
    './/a[contains(., "Next")]',
    './/input[@value="Next"]',
  ];

  for (const xpath of xpaths) {
    const buttons = await root.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
        if (await btn.isDisplayed() && await btn.isEnabled()) return btn;
      } catch {
        // try next
      }
    }
  }
  return null;
}

export async function clickApplyEntryPoint(driver: WebDriver): Promise<boolean> {
  const xpaths = [
    "//button[contains(translate(., 'APPLY', 'apply'), 'apply')]",
    "//a[contains(translate(., 'APPLY', 'apply'), 'apply')]",
    "//button[@id='indeedApplyButton']",
    "//button[contains(@data-testid, 'apply')]",
    "//a[contains(@href, '/apply')]",
    "//a[contains(@href, 'apply?')]",
  ];

  for (const xpath of xpaths) {
    const buttons = await driver.findElements(By.xpath(xpath));
    for (const btn of buttons) {
      try {
        const text = (await btn.getText()).toLowerCase();
        if (text.includes('applied') || text.includes('view application')) continue;
        if (await btn.isDisplayed() && await btn.isEnabled()) {
          const handlesBefore = await driver.getAllWindowHandles();
          await btn.click();
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
