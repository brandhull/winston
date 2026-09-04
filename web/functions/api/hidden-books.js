function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

async function fetchStatusRow(env) {
  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const res = await fetch(
    `${baseUrl}/api/database/rows/table/${env.BASEROW_SYNC_TABLE_ID}/?user_field_names=true&size=1`,
    { headers: { Authorization: `Token ${env.BASEROW_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Baserow fetch failed: ${res.status}`);
  const data = await res.json();
  return data.results[0];
}

function parseHiddenBooks(row) {
  if (!row || !row.hidden_books) return [];
  try {
    const parsed = JSON.parse(row.hidden_books);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ request, env }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  try {
    const row = await fetchStatusRow(env);
    return new Response(JSON.stringify(parseHiddenBooks(row)), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(err.message, { status: 502 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  const { hiddenBooks } = await request.json();
  if (!Array.isArray(hiddenBooks)) return new Response('Missing hiddenBooks array', { status: 400 });

  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const row = await fetchStatusRow(env);

  const res = await fetch(
    `${baseUrl}/api/database/rows/table/${env.BASEROW_SYNC_TABLE_ID}/${row.id}/?user_field_names=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Token ${env.BASEROW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hidden_books: JSON.stringify(hiddenBooks) }),
    }
  );
  if (!res.ok) return new Response(await res.text(), { status: res.status });

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/json' },
  });
}
