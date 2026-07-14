export async function onRequestGet({ request, env }) {
  const pin = request.headers.get('X-Pin');
  if (!pin || pin !== env.PIN) {
    return new Response('Unauthorized', { status: 401 });
  }
  return new Response('ok');
}
