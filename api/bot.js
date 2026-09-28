// Temporary stable VK Callback API bridge.
// VK is still configured to call the long-lived codex deployment, while the
// canonical cross-channel student + teacher flow lives on feat/telegram-mvp-v2.
// Keep one source of truth by forwarding the callback instead of maintaining a
// second copy of the bot logic. Remove this bridge after the canonical branch
// is merged to main and VK is pointed at production.

const CANONICAL_VK_ENTRY = 'https://tutoros-git-feat-telegram-mvp-v2-theoceo00.vercel.app/api/vk-entry';

export default async function handler(req, res) {
  try {
    const response = await fetch(CANONICAL_VK_ENTRY, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : JSON.stringify(req.body || {}),
    });
    const body = await response.text();
    return res.status(response.status).send(body);
  } catch (error) {
    console.error('VK canonical bridge failed:', error?.message || error);
    // VK retries failed callbacks aggressively. Return 200 so a transient bridge
    // failure cannot duplicate student or teacher actions.
    return res.status(200).send('ok');
  }
}
