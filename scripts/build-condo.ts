import {buildCondo,parseCondoBuildArgs} from '../server/framework/condo-build.ts';
const result=await buildCondo(parseCondoBuildArgs(process.argv.slice(2)));
console.log(JSON.stringify(result));
