export function normalizeLF(s: string): string {
  return s.replace(/\r\n/g, "\n");
}
