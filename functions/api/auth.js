const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function hmac(secret, msg, out) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return out === 'b64' ? b64(s) : hex(s);
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function pwdOk(input, secret) {   // 先各自做 HMAC 再比较，避免长度和时序泄露
  return safeEq(await hmac('cmp', input, 'hex'), await hmac('cmp', secret, 'hex'));
}
async function makeTicket(secret) {
  const exp = Date.now() + 30 * 86400000;
  return exp + '.' + await hmac(secret, 'host:' + exp, 'hex');
}
async function ticketOk(t, secret) {
  const [exp, sig] = String(t).split('.');
  if (!/^\d+$/.test(exp || '') || Number(exp) < Date.now() || !sig) return false;
  return safeEq(sig, await hmac(secret, 'host:' + exp, 'hex'));
}

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: 'bad request' }, 400); }
  const { role, rid, cid } = b || {};
  if (!['host', 'guest'].includes(role) || !/^[0-9a-f]{24}$/.test(rid || '') || !/^[\w-]{6,40}$/.test(cid || ''))
    return json({ error: 'bad request' }, 400);
  if (!env.ABLY_API_KEY) return json({ error: 'ABLY_API_KEY missing' }, 500);

  let ticket;
  if (role === 'host') {
    if (!env.HOST_PASSWORD) return json({ error: 'HOST_PASSWORD missing' }, 500);
    let ok = false;
    if (b.ticket) ok = await ticketOk(b.ticket, env.HOST_PASSWORD);
    else if (typeof b.password === 'string' && b.password) ok = await pwdOk(b.password, env.HOST_PASSWORD);
    if (!ok) { await new Promise(r => setTimeout(r, 800)); return json({ error: 'unauthorized' }, 401); }
    ticket = await makeTicket(env.HOST_PASSWORD);   // 每次成功都续期
  }

  // 双频道：:h = 主播 → 观众，:g = 观众 → 主播
  const h = `zw:${rid}:h`, g = `zw:${rid}:g`;
  const cap = role === 'host' ? { [h]: ['publish'], [g]: ['subscribe'] } : { [h]: ['subscribe'], [g]: ['publish'] };
  const capability = JSON.stringify(cap);

  const key = env.ABLY_API_KEY, i = key.indexOf(':');
  const keyName = key.slice(0, i), keySecret = key.slice(i + 1);
  const ttl = 3600000, timestamp = Date.now(), nonce = crypto.randomUUID().replace(/-/g, '');
  const text = `${keyName}\n${ttl}\n${capability}\n${cid}\n${timestamp}\n${nonce}\n`;
  const mac = await hmac(keySecret, text, 'b64');

  return json({ tokenRequest: { keyName, ttl, capability, clientId: cid, timestamp, nonce, mac }, ticket });
}
