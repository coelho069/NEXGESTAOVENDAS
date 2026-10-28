/** Idade mínima para contratar uma assinatura pública. */
export const MIN_SUBSCRIPTION_AGE = 18;

/** Fuso de referência do produto (AGENTS.md). */
const REPORT_TIMEZONE = "America/Sao_Paulo";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Data de hoje em `YYYY-MM-DD`, no fuso America/Sao_Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Formato `YYYY-MM-DD` e data real: `1990-02-30` não passa. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Idade completa em anos em `today`. Ambas as datas em `YYYY-MM-DD`. */
export function ageOnDate(birthDate: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split("-").map(Number);
  const [year, month, day] = today.split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

export function isAdultOnDate(birthDate: string, today: string): boolean {
  if (!isIsoDate(birthDate) || birthDate > today) return false;
  return ageOnDate(birthDate, today) >= MIN_SUBSCRIPTION_AGE;
}
