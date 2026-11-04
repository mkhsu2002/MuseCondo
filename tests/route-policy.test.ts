import test from 'node:test';
import assert from 'node:assert/strict';
import {isLiveRoute,createNavigationEpoch} from '../src/route-policy.ts';
test('historical and unknown routes stay out of the live renderer',()=>{
 for(const path of ['move-in','neighbors','tower-weekly','tower-weekly/tower-weekly-inaugural','tower-scenes','home/0123456789abcdef','home/0123456789abcdef/inside','home/0123456789abcdef/dreams'])assert.equal(isLiveRoute(path),true,path);
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


test('weekly resident links keep native document navigation and never render the legacy public-room model',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');const ts=(await import('typescript')).default;
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),file=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 let handler:import('typescript').ArrowFunction|undefined;
 const visit=(node:import('typescript').Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='root.addEventListener'&&node.arguments[0]?.getText(file)==="'click'"&&ts.isArrowFunction(node.arguments[1]))handler=node.arguments[1];ts.forEachChild(node,visit);};visit(file);assert.ok(handler);
 const {usesPublishedHomeDocument,usesStandaloneDocument}=await import('../src/route-policy.ts');
 const code=ts.transpileModule('const click='+handler!.getText(file).replaceAll('import.meta.env.VITE_MUSE_DEMO','false')+';click(event);',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const home of ['home/da854b41f3bf3504','home/da854b41f3bf3504/inside','home/d0e4167aba9b3e75/dreams','project','tower-history','tower-history/fang-soul-vault']){
  let prevented=0,pushed=0,navigated=0;
  runInNewContext(code,{usesPublishedHomeDocument,usesStandaloneDocument,base:'',URL,location:{origin:'https://tower.example',pathname:'/tower-weekly/tower-weekly-inaugural'},history:{pushState(){pushed++;}},navigate(){navigated++;},event:{button:0,target:{closest(){return {href:'https://tower.example/'+home,target:'',hasAttribute(){return false;}};}},preventDefault(){prevented++;}}});
  assert.deepEqual({prevented,pushed,navigated},{prevented:0,pushed:0,navigated:0},home);
 }
});

test('native home navigation recognizes current hosted views without swallowing unrelated or standalone paths',async()=>{
 const {usesPublishedHomeDocument:f}=await import('../src/route-policy.ts');
 for(const suffix of ['','/inside','/dreams','/'])assert.equal(f('/home/0123456789abcdef'+suffix),true);
 assert.equal(f('/preview/home/0123456789abcdef/inside','/preview'),true);
 for(const path of ['/home/not-a-room','/home/0123456789abcdef/private','/move-in','/tower-weekly','/other/home/0123456789abcdef'])assert.equal(f(path),false,path);
});

test('history restoration to a hosted home reloads its published document before any legacy renderer',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');const ts=(await import('typescript')).default;
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),file=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const fn=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='navigate') as import('typescript').FunctionDeclaration;assert.ok(fn?.body);
 const code=ts.transpileModule('async function navigate(focus=false)'+fn.body!.getText(file).replaceAll('import.meta.env.VITE_MUSE_DEMO','false')+';navigate();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const {usesPublishedHomeDocument,usesStandaloneDocument}=await import('../src/route-policy.ts');let destination='';
 await runInNewContext(code,{usesPublishedHomeDocument,usesStandaloneDocument,base:'',location:{pathname:'/home/da854b41f3bf3504/inside',href:'https://tower.example/home/da854b41f3bf3504/inside',replace(url:string){destination=url;}}});
 assert.equal(destination,'https://tower.example/home/da854b41f3bf3504/inside');
});
