import { test, expect, type App } from "../fixtures";
import { Discussion } from "../discussion";

// The running MDT (screen S-4, PRODUCT.md F-15, F-22) and the AI recorder (F-25). No real speech service is called:
// the recorder's health flag, token and socket are stubbed at the network level, and Chromium's fake microphone
// stands in for a real one.

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["microphone"],
});

async function startSession(app: App): Promise<void> {
  await app.open("patient/10/overview");
  await app.main.getByRole("button", { name: "Zahájit MDT", exact: true }).click();
  const dlg = app.dialog("Zahájit MDT");
  await expect(dlg.getByRole("heading", { level: 2, name: "Zahájit MDT · Čt 22. 10." })).toBeVisible();
  await expect(dlg.getByText("Pořadí (7)")).toBeVisible();
  await dlg.getByRole("combobox", { name: "Neurochirurgie" }).first().selectOption({ label: "MUDr. Novák" });
  await dlg.getByRole("button", { name: "Zahájit MDT ▸" }).click();
  await expect(app.page.getByRole("navigation", { name: "Probíhající MDT" })).toBeVisible();
}

test("starting the MDT shows the session bar; the arrows and pills move between cases; it ends", async ({ app, page }) => {
  await startSession(app);
  const bar = page.getByRole("navigation", { name: "Probíhající MDT" });
  await expect(bar.getByText("MDT · Čt 22. 10.")).toBeVisible();
  await expect(bar.getByRole("button", { name: /^\d{2}:\d{2} / })).toHaveCount(7);
  await expect(bar.getByRole("button", { name: "14:00 Poláček Daniel, NO-010" })).toHaveAttribute("aria-current", "true");
  await expect(bar.getByRole("button", { name: "Předchozí pacient" })).toBeDisabled();
  await expect(bar.getByRole("button", { name: "Přítomní (1)" })).toBeVisible();
  // In a session the discussion card is open.
  await expect(new Discussion(app).card.getByRole("heading", { level: 3, name: "Záznam diskuse" })).toBeVisible();

  await bar.getByRole("button", { name: "Další pacient" }).click();
  await expect(app.main.getByRole("heading", { level: 1, name: /Kotěrová Jaroslava/ })).toBeVisible();
  await bar.getByRole("button", { name: "14:50 Jelen Otakar, NO-017" }).click();
  await expect(app.main.getByRole("heading", { level: 1, name: /Jelen Otakar/ })).toBeVisible();

  // The session is stored on the server: a reload keeps it.
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Probíhající MDT" })).toBeVisible();
  await page.getByRole("navigation", { name: "Probíhající MDT" }).getByRole("button", { name: "Ukončit MDT" }).click();
  await expect(page.getByText("MDT ukončeno")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Probíhající MDT" })).toHaveCount(0);
});

test("without a speech service the recorder is visibly unavailable and the conclusion can be typed", async ({ app }) => {
  await app.open("patient/10/overview");
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: "AI záznam", exact: true }).click();
  await expect(d.card.getByRole("button", { name: "● Spustit záznam" })).toBeDisabled();
  await expect(d.card.getByText("AI záznam v této kopii aplikace není dostupný (chybí server pro přepis). Závěr lze zapsat ručně.")).toBeVisible();
  await expect(d.conclusion).toBeEditable();
});

test("with a (stubbed) speech service the recorder starts, shows live words in the case, and stops", async ({ app, page }) => {
  // Pretend the Worker has a speech key: only the health flag changes, everything else is the real server's answer.
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.features = { ...body.features, stt: true };
    await route.fulfill({ response: res, json: body });
  });
  // The token route would ask ElevenLabs; answer with a socket address that only this test serves.
  await page.route("**/api/stt/token", (route) =>
    route.fulfill({ json: { ws_url: "wss://stt.e2e.invalid/v1/speech-to-text/realtime?token=e2e", expires_in_s: 900 } }),
  );
  let chunks = 0;
  await page.routeWebSocket("wss://stt.e2e.invalid/**", (ws) => {
    ws.onMessage((msg) => {
      const m = JSON.parse(String(msg)) as { message_type: string };
      if (m.message_type !== "input_audio_chunk") return;
      chunks += 1;
      // After a few chunks of the fake microphone, send what the service sends: a partial, then a committed sentence
      // whose words start inside the recorded time.
      if (chunks === 3) {
        ws.send(JSON.stringify({ message_type: "partial_transcript", text: "ložisko v mozečku" }));
        ws.send(
          JSON.stringify({
            message_type: "committed_transcript_with_timestamps",
            words: ["Ložisko", "v", "mozečku", "doporučujeme", "ozářit."].map((text, i) => ({ type: "word", text, start: 0.1 + i * 0.05 })),
          }),
        );
      }
    });
  });

  await app.open("patient/10/overview");
  const d = new Discussion(app);
  await d.expand();
  await d.card.getByRole("button", { name: "AI záznam", exact: true }).click();
  await expect(d.card.getByText("Záznam je vypnutý.")).toBeVisible();
  await d.card.getByRole("button", { name: "● Spustit záznam" }).click();
  await expect(d.card.getByRole("button", { name: "■ Zastavit záznam" })).toBeVisible();
  await expect(d.card.getByText("Nahrávám.", { exact: false })).toBeVisible();
  await expect(d.card.getByText(/Ložisko v mozečku doporučujeme ozářit\./)).toBeVisible();
  // The header pill offers a stop from anywhere in the app.
  await expect(page.getByRole("button", { name: /Zastavit/ }).first()).toBeVisible();

  await d.card.getByRole("button", { name: "■ Zastavit záznam" }).click();
  await expect(d.card.getByRole("button", { name: "● Spustit záznam" })).toBeEnabled();
  await expect(d.card.getByText("Záznam je vypnutý.")).toBeVisible();
  // The live words stay with the case after stopping.
  await expect(d.card.getByText(/Ložisko v mozečku doporučujeme ozářit\./)).toBeVisible();
});
