import { getStore } from '@netlify/blobs';
import { getUser, refreshSession, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'hobunji-cloud-saves';
const MAX_SAVE_BYTES = 5 * 1024 * 1024;
const SAVE_SCHEMA_VERSION = 1;

function json(data, status = 200) {
  return Response.json(data, { status });
}

function errorStatus(error) {
  const candidate = Number(error?.status || error?.statusCode || error?.code);
  return Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 400;
}

function blobKey(userId) {
  // userId comes only from verified Netlify Identity state, never from caller input.
  return `users/${userId}/save.json`;
}

function summaryFromMetadata(entry) {
  if (!entry) return null;
  const metadata = entry.metadata || {};
  return {
    revision: Number(metadata.revision) || 0,
    updatedAt: Number(metadata.updatedAt) || 0,
    deviceId: metadata.deviceId ? String(metadata.deviceId) : null,
    bytes: Number(metadata.bytes) || 0,
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Save snapshot is missing.');
  if (!snapshot.meta || typeof snapshot.meta !== 'object') throw new Error('Save snapshot has no meta object.');
  if (!Array.isArray(snapshot.meta.characters) || !Array.isArray(snapshot.meta.worlds)) {
    throw new Error('Save snapshot has invalid character/world lists.');
  }
  if (!snapshot.farmLayouts || typeof snapshot.farmLayouts !== 'object' || Array.isArray(snapshot.farmLayouts)) {
    throw new Error('Save snapshot has invalid farm layouts.');
  }
}

async function refreshedUser() {
  try {
    await refreshSession();
  } catch (error) {
    if (Number(error?.status || error?.statusCode) >= 500) throw error;
  }
  return getUser();
}

export default async function hobunjiCloudSave(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  try {
    verifyRequestOrigin(req);
    const user = await refreshedUser();
    if (!user) return json({ ok: false, error: 'Sign in to use cloud saves.' }, 401);

    let body = {};
    try { body = await req.json(); } catch {}
    const action = String(body.action || 'status');
    const key = blobKey(user.id);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    if (action === 'status') {
      const entry = await store.getMetadata(key, { consistency: 'strong' });
      return json({ ok: true, remote: summaryFromMetadata(entry) });
    }

    if (action === 'pull') {
      const entry = await store.getWithMetadata(key, { consistency: 'strong', type: 'json' });
      if (!entry?.data) return json({ ok: false, error: 'No cloud save exists for this account.' }, 404);
      return json({ ok: true, remote: summaryFromMetadata(entry), snapshot: entry.data.snapshot });
    }

    if (action === 'push') {
      validateSnapshot(body.snapshot);
      const serializedSnapshot = JSON.stringify(body.snapshot);
      const bytes = new TextEncoder().encode(serializedSnapshot).byteLength;
      if (bytes > MAX_SAVE_BYTES) {
        return json({ ok: false, error: `Cloud save is too large (${bytes} bytes; limit ${MAX_SAVE_BYTES}).` }, 413);
      }

      const current = await store.getMetadata(key, { consistency: 'strong' });
      const remote = summaryFromMetadata(current);
      const remoteRevision = remote?.revision || 0;
      const baseRevision = Math.max(0, Number(body.baseRevision) || 0);
      const force = body.force === true;

      if (!force && baseRevision !== remoteRevision) {
        return json({
          ok: false,
          conflict: true,
          error: 'Cloud save changed on another device.',
          remote,
        }, 409);
      }

      const updatedAt = Date.now();
      const revision = remoteRevision + 1;
      const deviceId = body.deviceId ? String(body.deviceId).slice(0, 120) : 'unknown-device';
      const envelope = {
        schemaVersion: SAVE_SCHEMA_VERSION,
        revision,
        updatedAt,
        deviceId,
        snapshot: body.snapshot,
      };
      const metadata = { revision, updatedAt, deviceId, bytes };
      const options = current?.etag
        ? { onlyIfMatch: current.etag, metadata }
        : { onlyIfNew: true, metadata };
      const result = await store.set(key, JSON.stringify(envelope), options);

      if (result?.modified === false) {
        const latest = await store.getMetadata(key, { consistency: 'strong' });
        return json({
          ok: false,
          conflict: true,
          error: 'Cloud save changed while this device was uploading.',
          remote: summaryFromMetadata(latest),
        }, 409);
      }

      return json({ ok: true, remote: { revision, updatedAt, deviceId, bytes } });
    }

    return json({ ok: false, error: `Unknown cloud-save action: ${action}` }, 400);
  } catch (error) {
    console.error('[HobunjiCloudSave]', error);
    return json({ ok: false, error: String(error?.message || error) }, errorStatus(error));
  }
}
