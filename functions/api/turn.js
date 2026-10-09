export async function onRequestGet({ env }) {
  const r = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    }
  );
  if (!r.ok) return new Response('turn error', { status: 502 });
  return new Response(await r.text(), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
