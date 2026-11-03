import test from 'node:test';
import assert from 'node:assert/strict';
import {isLiveRoute,createNavigationEpoch} from '../src/route-policy.ts';
test('historical and unknown routes stay out of the live renderer',()=>{
 for(const path of ['move-in','neighbors','home/0123456789abcdef','home/0123456789abcdef/inside','home/0123456789abcdef/dreams'])assert.equal(isLiveRoute(path),true,path);
 for(const path of ['about','入住','選輯紀錄','m7k2px','m7k2px/inside','m7k2px/dreams','home/bad','neighbors/bad','move-in-extra','home/0123456789abcdef/unknown','unknown'])assert.equal(isLiveRoute(path),false,path);
});
test('delayed live imports cannot render or focus after a newer demo navigation',async()=>{
 const navigation=createNavigationEpoch(),events:string[]=[];
 let release!:()=>void;
 const delayed=new Promise<void>(resolve=>{release=resolve;});
 async function visit(label:string,wait:Promise<void>){const current=navigation.begin();events.push('cancel:'+label);await wait;if(!current())return;events.push('render:'+label);await Promise.resolve();if(current())events.push('focus:'+label);}
 const old=visit('live',delayed);await visit('demo',Promise.resolve());release();await old;
 assert.deepEqual(events,['cancel:live','cancel:demo','render:demo','focus:demo']);
});

test('historical refresh retries an existing edition and blocks duplicate in-flight clicks',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');const ts=(await import('typescript')).default;
 const source=readFileSync(new URL('../src/demo.ts',import.meta.url),'utf8'),file=ts.createSourceFile('demo.ts',source,ts.ScriptTarget.Latest,true);
 let handler:import('typescript').ArrowFunction|undefined;
 const visit=(node:import('typescript').Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='listen'&&node.arguments[1]?.getText(file)==="'click'"&&node.arguments[2]?.getText(file).includes('data-refresh-community')&&ts.isArrowFunction(node.arguments[2]))handler=node.arguments[2];ts.forEachChild(node,visit);};visit(file);assert.ok(handler);
 const code=ts.transpileModule('const click='+handler!.getText(file)+';click(event);',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const loading of [false,true]){let refreshes=0;runInNewContext(code,{community:{edition:{id:'already-loaded'}},communityLoading:loading,refreshCommunity:()=>{refreshes++;},event:{target:{closest:(selector:string)=>selector==='[data-refresh-community]'?{}:null}}});assert.equal(refreshes,loading?0:1);}
});
