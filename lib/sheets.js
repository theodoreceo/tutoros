const SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
const SHEETS_SECRET = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;

export async function emitSheetEvent(type, payload) {
  if (!SHEETS_WEBHOOK_URL || !SHEETS_SECRET) return { skipped: true };

  try {
    const response = await fetch(SHEETS_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tutoros-sync-secret': SHEETS_SECRET,
      },
      body: JSON.stringify({
        secret: SHEETS_SECRET,
        type,
        occurred_at: new Date().toISOString(),
        payload,
      }),
    });
    if (!response.ok) {
      console.error(`Google Sheets sync failed: ${response.status}`);
      return { ok: false, status: response.status };
    }
    const result = await response.json().catch(() => null);
    if (!result?.ok) {
      console.error(`Google Sheets sync failed: ${result?.error || 'invalid response'}`);
      return { ok: false, status: response.status };
    }
    return { ok: true };
  } catch (error) {
    console.error(`Google Sheets sync failed: ${error.message}`);
    return { ok: false };
  }
}
