function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

export async function onRequestPost({ request, env }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  const { quote, author } = await request.json();
  if (!quote) return new Response('Missing quote', { status: 400 });

  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const res = await fetch(
    `${baseUrl}/api/database/rows/table/${env.BASEROW_SENECA_TABLE_ID}/?user_field_names=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.BASEROW_SENECA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ Quote: quote, Author: author || '' }),
    }
  );

  if (!res.ok) {
    return new Response(await res.text(), { status: res.status });
  }

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/json' },
  });
}
