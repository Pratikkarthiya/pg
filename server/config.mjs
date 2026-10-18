export function publicConfiguration(publicOrigin, setupToken, dataDir) {
  if (!publicOrigin) return { origin: '', secure: false };
  let url;
  try { url = new URL(publicOrigin); } catch { throw new Error('Public deployment requires a valid HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Public deployment requires an HTTPS origin without a path, credentials or query.');
  if (typeof setupToken !== 'string' || setupToken.length < 32) throw new Error('Set BLISS_SETUP_TOKEN to a private random value of at least 32 characters.');
  if (!dataDir) throw new Error('Set BLISS_DATA_DIR to persistent storage before deploying.');
  return { origin: url.origin, secure: true };
}
