function checkPin(request, env) {
  const pin = request.headers.get('X-Pin');
  return pin && pin === env.PIN;
}

async function createRow(baseUrl, env, fields) {
  return fetch(`${baseUrl}/api/database/rows/table/${env.BASEROW_SENECA_TABLE_ID}/?user_field_names=true`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${env.BASEROW_SENECA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fields),
  });
}

export async function onRequestPost({ request, env }) {
  if (!checkPin(request, env)) return new Response('Unauthorized', { status: 401 });

  const { quote, author, comment, senecaRowId } = await request.json();
  if (!quote) return new Response('Missing quote', { status: 400 });

  const baseUrl = env.BASEROW_API_URL || 'https://api.baserow.io';
  const fields = { Quote: quote, Author: author || '', 'My Comments': comment || '' };

  let res;
  if (senecaRowId) {
    res = await fetch(
      `${baseUrl}/api/database/rows/table/${env.BASEROW_SENECA_TABLE_ID}/${senecaRowId}/?user_field_names=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Token ${env.BASEROW_SENECA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fields),
      }
    );
    // The remembered row may have been deleted in Baserow since — fall back to creating a new one.
    if (res.status === 404) {
      res = await createRow(baseUrl, env, fields);
    }
  } else {
    res = await createRow(baseUrl, env, fields);
  }

  if (!res.ok) {
    return new Response(await res.text(), { status: res.status });
  }

  return new Response(await res.text(), {
    headers: { 'Content-Type': 'application/json' },
  });
}
