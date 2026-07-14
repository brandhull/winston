function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

export async function onRequestPatch({ request, env, params }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const tableId = env.BASEROW_TABLE_ID;
  const token = env.BASEROW_TOKEN;
  const body = await request.json();

  const res = await fetch(
    `${baseUrl}/api/database/rows/table/${tableId}/${params.id}/?user_field_names=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    return new Response(await res.text(), { status: res.status });
  }

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/json' },
  });
}
