export function interpolateBranchTemplate(template: string, taskId: string): string {
  return template
    .replace("{taskId}", taskId)
    .replace("{taskIdShort}", taskId.slice(0, 4));
}

export function validateBranchTemplate(template: string): boolean {
  return template.includes("{taskId}") || template.includes("{taskIdShort}");
}
