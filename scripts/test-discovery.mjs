import {readdirSync} from 'node:fs';
import {join} from 'node:path';

/** Keep the verification inventory automatic as suites and subdirectories grow. */
export function discoverTests(root){
 const files=[];
 for(const [directory,pattern] of [['tests',/\.test\.(?:ts|mjs)$/],['scripts',/\.test\.mjs$/]]){
  function visit(relative){
   for(const entry of readdirSync(join(root,relative),{withFileTypes:true})){
    const file=relative+'/'+entry.name;
    if(entry.isDirectory())visit(file);
    else if(entry.isFile()&&pattern.test(entry.name))files.push(file);
   }
  }
  visit(directory);
 }
 return files.sort();
}
