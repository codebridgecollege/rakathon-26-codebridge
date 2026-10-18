import type { Locator, Page } from "@playwright/test";

export type FilePayload = { name: string; mimeType: string; buffer: Buffer };

// A small generated file with no patient content: the demo server lists such a file by name and size only.
export function syntheticFile(name: string, mimeType = "application/pdf"): FilePayload {
  const body = mimeType === "application/pdf" ? "%PDF-1.4\n% e2e synthetic file\n%%EOF\n" : `e2e synthetic file ${name}\n`;
  return { name, mimeType, buffer: Buffer.from(body) };
}

// Picks files the way a user does: a click on the upload zone opens the system file chooser.
export async function chooseFiles(page: Page, zone: Locator, files: (string | FilePayload)[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await zone.click();
  await (await chooser).setFiles(files as never);
}
