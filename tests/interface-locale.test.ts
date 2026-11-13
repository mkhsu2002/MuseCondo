import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInterfaceLocale,resolveInterfaceLocale,translateInterfaceText} from '../src/shared/interface-locale.ts';
test('interface locale respects deliberate choice, volunteered home language and browser fallback',()=>{
 assert.equal(normalizeInterfaceLocale('zh-Hant-TW'),'zh-TW');
 assert.equal(normalizeInterfaceLocale('en-CA'),'en');
 assert.equal(normalizeInterfaceLocale('fr'),undefined);
 assert.equal(resolveInterfaceLocale({explicit:'en',saved:'zh-TW',home:'zh-TW',browser:'zh-TW'}),'en');
 assert.equal(resolveInterfaceLocale({saved:'zh-TW',home:'en'}),'zh-TW');
 assert.equal(resolveInterfaceLocale({home:'zh-TW',browser:'en-US'}),'zh-TW');
 assert.equal(resolveInterfaceLocale({browser:'zh-TW, en;q=0.8'}),'zh-TW');
 assert.equal(resolveInterfaceLocale({browser:'fr'}),'en');
});
test('only exact interface catalog messages translate and reverse with whitespace intact',()=>{
 assert.equal(translateInterfaceText(' Home ','zh-TW'),' 家 ');
 assert.equal(translateInterfaceText(' 家 ','en'),' Home ');
 assert.equal(translateInterfaceText('My own poem about Home','zh-TW'),'My own poem about Home');
 assert.equal(translateInterfaceText('Character profile','zh-TW'),'角色資料');
});
test('prototype-looking values are never catalog entries',()=>{
 for(const value of ['constructor','toString','__proto__'])assert.equal(translateInterfaceText(value,'zh-TW'),value);
});
