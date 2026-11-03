import {readFileSync} from 'node:fs';
const supported=readFileSync(new URL('../.node-version',import.meta.url),'utf8').trim();
if(process.versions.node!==supported){
 console.error(`MuseCondo verification requires Node.js ${supported}; found ${process.versions.node}. Select the version in .node-version or .nvmrc.`);
 process.exit(1);
}
