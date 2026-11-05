function parseTrustedProxyHops(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 10) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 1 to 10.');
  }
  return Number(value);
}

function configureTrustedProxy(app, value = process.env.TRUST_PROXY_HOPS) {
  const hops = parseTrustedProxyHops(value);
  if (hops !== undefined) app.set('trust proxy', hops);
  return hops;
}

module.exports = { configureTrustedProxy, parseTrustedProxyHops };
