/* ── REST API Communications ── */

export async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.json();
}

export async function patchConfig(patch) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return await res.json();
}

export async function testDbConn(dsn) {
  const res = await fetch('/api/db/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dsn }),
  });
  return await res.json();
}

export async function startPipeline(mode) {
  const res = await fetch('/api/pipeline/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return await res.json();
}

export async function stopPipeline() {
  const res = await fetch('/api/pipeline/stop', { method: 'POST' });
  return await res.json();
}

export async function fetchPlotData(body) {
  const res = await fetch('/api/plot/static', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await res.json();
}

export async function fetchChannels(dbTarget, dsn) {
  const res = await fetch('/api/db/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ db_target: dbTarget, dsn }),
  });
  return await res.json();
}
