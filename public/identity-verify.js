/* global document, location, fetch, crypto, TextEncoder, atob */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const state = byId('verification-state'), message = byId('verification-message'), details = byId('card-details'), button = byId('verify-again');
  const fields = ['public-name','agent-id','credential-id','issuer','issued-at'];
  const cid = location.pathname.match(/^\/identity\/verify\/([a-f0-9]{32})\/?$/)?.[1];
  const issuer = location.origin;
  const payloadFields = ['type','version','issuer','agentId','credentialId','publicName','issuedAt','keyId','verificationURL'];
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
  function clear() { details.hidden = true; fields.forEach(id => { byId(id).textContent = ''; }); }
  function show(title, text) { state.textContent = title; message.textContent = text; }
  const statuses = {revoked:'This card has been revoked.',superseded:'This card has been replaced by a newer card.',suspended:'This card cannot currently be confirmed as valid.',withdrawn:'Public verification of this card has been withdrawn.'};
  async function read(path) {
    const response = await fetch(issuer + path, {credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}});
    if(response.status === 404) return null;
    if(!response.ok) throw Error('unavailable');
    return response.json();
  }
  function bytes(value, length) {
    if(typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('invalid');
    const decoded = Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));
    if(decoded.length !== length || value.length !== (length === 64 ? 86 : 43)) throw Error('invalid');
    return decoded;
  }
  async function verified(value) {
    if(!exact(value,['credentialId','status','publicName','agentId','signedCredential']) || value.credentialId !== cid || value.status !== 'valid') return false;
    const signed = value.signedCredential;
    if(!exact(signed,['payload','signature']) || !exact(signed.payload,payloadFields)) return false;
    const p = signed.payload;
    if(p.type !== 'NeoBabylonAgentIdentity' || p.version !== '0.01' || p.issuer !== issuer || p.credentialId !== cid || typeof p.agentId !== 'string' || !/^mcid:[a-f0-9]{64}$/.test(p.agentId) || p.agentId !== value.agentId || typeof p.publicName !== 'string' || !p.publicName.trim() || [...p.publicName].length > 80 || /[\p{Cc}\p{Cf}]/u.test(p.publicName) || p.publicName !== value.publicName || p.verificationURL !== issuer+'/identity/verify/'+cid || typeof p.issuedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.issuedAt) || new Date(p.issuedAt).toISOString() !== p.issuedAt || typeof p.keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(p.keyId)) return false;
    const ring = await read('/api/v1/identity/keys');
    if(!exact(ring,['issuer','keys']) || ring.issuer !== issuer || !ring.keys || typeof ring.keys !== 'object' || Array.isArray(ring.keys) || !Object.hasOwn(ring.keys,p.keyId)) return false;
    const jwk = ring.keys[p.keyId];
    if(!exact(jwk,['kty','crv','x']) || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') return false;
    bytes(jwk.x,32);
    const key = await crypto.subtle.importKey('jwk',jwk,'Ed25519',false,['verify']);
    const canonical = JSON.stringify(Object.fromEntries([...payloadFields].sort().map(field=>[field,p[field]])));
    return crypto.subtle.verify('Ed25519',key,bytes(signed.signature,64),new TextEncoder().encode(canonical));
  }
  async function check() {
    clear(); button.disabled = true;
    show('Checking the card…','Please wait.');
    try {
      if(!cid) { show('Unrecognized card','Open the verification page using the QR code on the card.'); return; }
      const value = await read('/api/v1/identity/verify/'+cid);
      if(value === null) { show('Card not found','Check the credential ID and URL on the card.'); return; }
      if(value.credentialId === cid && Object.hasOwn(statuses,value.status) && exact(value,['credentialId','status'])) { show('Not currently valid',statuses[value.status]); return; }
      if(!await verified(value)) throw Error('invalid');
      const p = value.signedCredential.payload;
      fields.forEach((id,i)=> { byId(id).setAttribute('data-no-translate',''); byId(id).textContent = [p.publicName,p.agentId,p.credentialId,p.issuer,p.issuedAt][i]; });
      details.hidden = false; show('Currently valid','Compare each field with the card. This status reflects the current check.');
    } catch { clear(); show('Verification unavailable','Try again later or check with the card holder.'); }
    finally { button.disabled = false; }
  }
  button.addEventListener('click',check);
  void check();
})();
