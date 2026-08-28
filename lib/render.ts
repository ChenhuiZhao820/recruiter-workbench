// Renders a message template. Missing values are left as a visible gap
// so the recruiter notices before pasting.

export function renderTemplate(
  body: string,
  values: { first_name?: string; role_title?: string; calendar_link?: string }
): string {
  return body.replace(/\{\{\s*(first_name|role_title|calendar_link)\s*\}\}/g, (_, key) => {
    const value = values[key as keyof typeof values];
    return value && value.trim() ? value.trim() : `[MISSING: ${key}]`;
  });
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}
