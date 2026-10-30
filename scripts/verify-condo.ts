import {verifyCondoURL} from '../server/framework/condo-verify.ts';
const args=process.argv.slice(2),flags:Record<string,string>={};
for(let i=0;i<args.length;i+=2){if(!['--url','--expect-id'].includes(args[i])||flags[args[i]]||!args[i+1]||args[i+1].startsWith('--'))throw Error('用法：condo:verify -- --url https://your-home/ [--expect-id 16hex]');flags[args[i]]=args[i+1];}
if(!flags['--url'])throw Error('請提供 --url');
console.log(JSON.stringify(await verifyCondoURL(flags['--url'],{expectedId:flags['--expect-id']}),null,2));
