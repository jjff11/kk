export async function onRequest(context) {
  return new Response(context.env.ABLY_KEY, {
    headers: { 'Content-Type': 'text/plain' }
  });
}
