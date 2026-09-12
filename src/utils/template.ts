import type { ExecutionPageContext, Secrets, Variables } from "../types/actions";

export interface TemplateContext {
  page?: ExecutionPageContext;
  variables?: Variables;
  secrets?: Secrets;
  inputs?: Record<string, string>;
}

/**
 * Escapes a string for safe embedding inside a JSON string literal if needed.
 */
export function escapeJsonString(str: string): string {
  const quoted = JSON.stringify(str);
  return quoted.slice(1, -1);
}

/**
 * Replaces page context, stored values, and action input placeholders.
 */
export function interpolateTemplate(
  template: string,
  context: TemplateContext,
  options: { escapeJson?: boolean } = {},
): string {
  if (!template) return "";

  const { page = {}, variables = {}, secrets = {}, inputs = {} } = context;

  // Regex matches {{key}} or {{ key }}
  return template.replace(/\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/gu, (_match, rawKey: string) => {
    const key = rawKey.trim();
    let value = "";

    if (key === "page.selection") {
      value = page.selection ?? "";
    } else if (key === "page.url") {
      value = page.url ?? "";
    } else if (key === "page.title") {
      value = page.title ?? "";
    } else if (key === "page.domain") {
      if (page.domain) {
        value = page.domain;
      } else if (page.url) {
        try {
          value = new URL(page.url).hostname;
        } catch {
          value = "";
        }
      }
    } else if (key === "link.url") {
      value = page.linkUrl ?? "";
    } else if (key === "image.url") {
      value = page.imageUrl ?? "";
    } else if (key === "video.url") {
      value = page.videoUrl ?? "";
    } else if (key === "audio.url") {
      value = page.audioUrl ?? "";
    } else if (key.startsWith("var.")) {
      const varKey = key.slice(4);
      value = variables[varKey] ?? "";
    } else if (key.startsWith("secret.")) {
      const secretKey = key.slice(7);
      value = secrets[secretKey] ?? "";
    } else if (Object.keys(inputs).includes(key)) {
      value = inputs[key] ?? "";
    } else {
      // Unknown placeholder - leave unchanged or empty
      return _match;
    }

    if (options.escapeJson) {
      return escapeJsonString(value);
    }
    return value;
  });
}

export function isValidTemplateKey(key: string): boolean {
  return /^[\p{L}\p{N}_.-]+$/u.test(key);
}
