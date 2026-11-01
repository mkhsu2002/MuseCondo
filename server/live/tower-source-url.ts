/** Structural public-source restrictions apply before any network access, including approved cases. */
export function towerSourceURL(value:unknown){
 if(typeof value!=='string'||value.length>1000)throw Error('source_url_rejected');
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||value.includes('?')||value.includes('#')||!u.hostname.includes('.')||u.hostname.endsWith('.')||u.hostname.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/[\]:]/.test(u.hostname)||u.hostname.includes('[')||/^\d+(?:\.\d+)*$/.test(u.hostname)||/(?:^|\.)(localhost|local|internal)$/.test(u.hostname)||!/^\/(?:[A-Za-z0-9_-]+\/)*condo\.json$/.test(u.pathname)||u.href!==value)throw Error('source_url_rejected');return u;
}
