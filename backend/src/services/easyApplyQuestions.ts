import { By, Key, WebDriver, WebElement } from 'selenium-webdriver';
import { Select } from 'selenium-webdriver/lib/select';
import { applicationProfile, type ApplicationProfile } from '../data/applicationProfile';
import {
  resolveRadioAnswer,
  resolveSelectAnswer,
  resolveTextAnswer,
  resolveTextareaAnswer,
  yesNoPhrases,
} from './applicationAnswers';
import type { FormQuestionContext } from './applyHelpers';

export type EasyApplyContext = FormQuestionContext;

async function readLabel(question: WebElement): Promise<{ org: string; lower: string }> {
  try {
    const label = await question.findElement(By.css('label'));
    let text = '';
    try {
      const span = await label.findElement(By.css('span'));
      text = (await span.getText()).trim();
    } catch {
      text = (await label.getText()).trim();
    }
    return { org: text || 'Unknown', lower: (text || 'unknown').toLowerCase() };
  } catch {
    return { org: 'Unknown', lower: 'unknown' };
  }
}

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
      console.warn(`Easy Apply: fuzzy select fallback for "${answer}" → "${text}"`);
      return text;
    }
    return answer;
  }
}

async function answerSelectQuestion(
  question: WebElement,
  profile: ApplicationProfile,
  workLocation: string
): Promise<void> {
  const selectEl = await question.findElement(By.css('select'));
  const select = new Select(selectEl);
  const { org: labelOrg, lower: label } = await readLabel(question);

  const options = await select.getOptions();
  const optionsText = await Promise.all(options.map((o) => o.getText()));
  const selected = await select.getFirstSelectedOption();
  const prevAnswer = selected ? await selected.getText() : '';

  if (!profile.overwritePreviousAnswers && prevAnswer && prevAnswer !== 'Select an option') {
    return;
  }

  const answer = resolveSelectAnswer(label, profile, workLocation);
  if (!answer) return;

  const picked = await fuzzySelectOption(select, answer, optionsText);
  console.log(`Easy Apply select: "${labelOrg}" → "${picked}"`);
}

async function answerRadioQuestion(question: WebElement, profile: ApplicationProfile): Promise<void> {
  const fieldset = await question.findElement(
    By.css('fieldset[data-test-form-builder-radio-button-form-component="true"]')
  );
  const { org: labelOrg, lower: label } = await readLabel(question);
  const answer = resolveRadioAnswer(label, profile);

  const options = await fieldset.findElements(By.css('input'));
  let clicked = false;

  for (const option of options) {
    const id = await option.getAttribute('id');
    if (!id) continue;
    try {
      const optionLabel = await fieldset.findElement(By.css(`label[for="${id}"]`));
      const text = (await optionLabel.getText()).trim();
      if (text === answer || text.toLowerCase().includes(answer.toLowerCase())) {
        await optionLabel.click();
        clicked = true;
        console.log(`Easy Apply radio: "${labelOrg}" → "${text}"`);
        break;
      }
    } catch {
      // try next
    }
  }

  if (!clicked && options.length) {
    for (const phrase of yesNoPhrases(answer)) {
      for (const option of options) {
        const id = await option.getAttribute('id');
        if (!id) continue;
        try {
          const optionLabel = await fieldset.findElement(By.css(`label[for="${id}"]`));
          const text = (await optionLabel.getText()).trim();
          if (
            phrase.toLowerCase().includes(text.toLowerCase()) ||
            text.toLowerCase().includes(phrase.toLowerCase())
          ) {
            await optionLabel.click();
            clicked = true;
            console.log(`Easy Apply radio (fuzzy): "${labelOrg}" → "${text}"`);
            break;
          }
        } catch {
          // try next
        }
      }
      if (clicked) break;
    }
  }

  if (!clicked && options.length) {
    const id = await options[0].getAttribute('id');
    if (id) {
      const optionLabel = await fieldset.findElement(By.css(`label[for="${id}"]`));
      await optionLabel.click();
      console.warn(`Easy Apply radio fallback: "${labelOrg}"`);
    }
  }
}

async function answerInputQuestion(
  driver: WebDriver,
  question: WebElement,
  profile: ApplicationProfile,
  ctx: EasyApplyContext
): Promise<void> {
  const input = await question.findElement(By.css('input[type="text"]'));
  const { org: labelOrg, lower: label } = await readLabel(question);
  const prevAnswer = (await input.getAttribute('value')) || '';

  if (!profile.overwritePreviousAnswers && prevAnswer.trim()) return;

  let { answer, needsAutocomplete } = resolveTextAnswer(label, profile, ctx.workLocation);

  if (!answer && ctx.useAi && ctx.aiAnswer) {
    const aiAnswer = await ctx.aiAnswer(labelOrg, 'text', ctx.jobDescription);
    if (aiAnswer) {
      answer = aiAnswer;
      console.log(`Easy Apply AI text: "${labelOrg}" → "${answer.slice(0, 80)}..."`);
    }
  }

  if (!answer) {
    answer = profile.yearsOfExperience;
    console.warn(`Easy Apply text fallback: "${labelOrg}" → "${answer}"`);
  }

  await input.clear();
  await input.sendKeys(answer);
  if (needsAutocomplete) {
    await driver.sleep(1500);
    await driver.actions().sendKeys(Key.ARROW_DOWN).sendKeys(Key.ENTER).perform();
  }
}

async function answerTextareaQuestion(
  question: WebElement,
  profile: ApplicationProfile,
  ctx: EasyApplyContext
): Promise<void> {
  const textArea = await question.findElement(By.css('textarea'));
  const { org: labelOrg, lower: label } = await readLabel(question);
  const prevAnswer = (await textArea.getAttribute('value')) || '';

  if (!profile.overwritePreviousAnswers && prevAnswer.trim()) return;

  let answer = resolveTextareaAnswer(label, profile);

  if (!answer && ctx.useAi && ctx.aiAnswer) {
    const aiAnswer = await ctx.aiAnswer(labelOrg, 'textarea', ctx.jobDescription);
    if (aiAnswer) {
      answer = aiAnswer;
      console.log(`Easy Apply AI textarea: "${labelOrg}" → "${answer.slice(0, 80)}..."`);
    }
  }

  await textArea.clear();
  if (answer) await textArea.sendKeys(answer);
}

async function answerCheckboxQuestion(question: WebElement): Promise<void> {
  const checkbox = await question.findElement(By.css('input[type="checkbox"]'));
  const selected = await checkbox.isSelected();
  if (!selected) {
    try {
      await checkbox.click();
    } catch {
      const label = await question.findElement(By.css('label[for]'));
      await label.click();
    }
  }
}

export async function answerEasyApplyQuestions(
  driver: WebDriver,
  modal: WebElement,
  ctx: EasyApplyContext
): Promise<void> {
  const profile = ctx.profile ?? applicationProfile;
  const questions = await modal.findElements(By.css('div[data-test-form-element]'));

  for (const question of questions) {
    try {
      const selects = await question.findElements(By.css('select'));
      if (selects.length) {
        await answerSelectQuestion(question, profile, ctx.workLocation);
        continue;
      }

      const radios = await question.findElements(
        By.css('fieldset[data-test-form-builder-radio-button-form-component="true"]')
      );
      if (radios.length) {
        await answerRadioQuestion(question, profile);
        continue;
      }

      const textInputs = await question.findElements(By.css('input[type="text"]'));
      if (textInputs.length) {
        await answerInputQuestion(driver, question, profile, ctx);
        continue;
      }

      const textareas = await question.findElements(By.css('textarea'));
      if (textareas.length) {
        await answerTextareaQuestion(question, profile, ctx);
        continue;
      }

      const checkboxes = await question.findElements(By.css('input[type="checkbox"]'));
      if (checkboxes.length) {
        await answerCheckboxQuestion(question);
      }
    } catch (err) {
      console.warn('Easy Apply question skipped:', (err as Error).message);
    }
  }

  try {
    const todayBtn = await modal.findElements(
      By.xpath(".//button[contains(@aria-label, 'This is today')]")
    );
    if (todayBtn.length) await todayBtn[0].click();
  } catch {
    // optional date picker
  }
}

export async function findEasyApplyModal(driver: WebDriver): Promise<WebElement | null> {
  for (const selector of ['.jobs-easy-apply-modal', '.artdeco-modal']) {
    try {
      const modal = await driver.findElement(By.css(selector));
      if (await modal.isDisplayed()) return modal;
    } catch {
      // try next
    }
  }
  return null;
}
