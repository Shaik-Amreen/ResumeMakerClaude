import emailjs from '@emailjs/nodejs';
import { config } from '../config';

export async function sendEmailNotification(message: string): Promise<boolean> {
  const { emailjs: emailCfg } = config;
  if (!emailCfg.enabled) return false;

  const text = (message || '').trim();
  if (!text) return false;

  const publicKey = emailCfg.publicKey.trim();
  if (!publicKey) {
    console.warn('Email skipped — set EMAILJS_PUBLIC_KEY in .env');
    return false;
  }

  const templateParams = {
    from_name: emailCfg.fromName,
    to_name: emailCfg.toName,
    from_email: emailCfg.fromEmail,
    to_email: emailCfg.toEmail,
    message: text,
  };

  const options: { publicKey: string; privateKey?: string } = { publicKey };
  if (emailCfg.privateKey.trim()) {
    options.privateKey = emailCfg.privateKey.trim();
  }

  try {
    const response = await emailjs.send(
      emailCfg.serviceId,
      emailCfg.templateId,
      templateParams,
      options
    );
    console.log(`Email alert sent to ${emailCfg.toEmail}: ${response.status} ${response.text}`);
    return response.status === 200;
  } catch (err) {
    console.error('Email alert failed:', err);
    return false;
  }
}
