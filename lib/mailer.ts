import {
  hasMailer as hasMailerJs,
  sendConfirmMail as sendConfirmJs,
  sendDigestMail as sendDigestJs,
  siteUrl as siteUrlJs,
} from './mailer.mjs';

export const hasMailer = (): boolean => hasMailerJs() as boolean;
export const siteUrl = (): string => siteUrlJs() as string;

export function sendConfirmMail(email: string, token: string) {
  return sendConfirmJs(email, token) as Promise<unknown>;
}

export interface DigestData {
  title: string;
  lead?: string;
  intro: string;
  url: string;
  items: { title: string; account?: string }[];
  unsubUrl: string;
}

export function sendDigestMail(email: string, data: DigestData) {
  return sendDigestJs(email, data) as Promise<unknown>;
}
