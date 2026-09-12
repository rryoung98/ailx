// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConsumerTest } from '../features/consumer/ConsumerTest';
import { CONSUMER_STORAGE_KEY } from '../features/consumer/useConsumerHistory';
const navigation = vi.hoisted(()=>({search:''}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(navigation.search),useRouter:()=>({replace:(url:string)=>{navigation.search=url.split('?')[1]??'';}})}));
(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
let host:HTMLDivElement; let root:Root; let saved:Map<string,string>;
beforeEach(()=>{
 navigation.search=''; saved=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value)}});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function render(){await act(async()=>root.render(createElement(ConsumerTest)));}
async function click(text:string){const button=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>button!.click());}
it('requires a choice, resumes saved decisions, and reveals the result only at completion',async()=>{
 await render();await click("Let's find out");await click('Continue');
 expect(host.textContent).toContain('Choose an option');
 for(let i=0;i<8;i++){
  expect(host.textContent).toContain(`Decision ${i+1} of 8`);
  await act(async()=>host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  await click(i===7?'See my profile':'Continue');
  if(i===2){act(()=>root.unmount());navigation.search='';root=createRoot(host);await render();}
 }
 expect(host.textContent).toContain('decisions matched the brief');
 expect(host.textContent).toContain('Copy share summary');
 expect(JSON.parse(saved.get(CONSUMER_STORAGE_KEY)!)[0].responses).toHaveLength(8);
 await click('Try the demo again');expect(host.textContent).toContain('Decision 1 of 8');
 expect(JSON.parse(saved.get(CONSUMER_STORAGE_KEY)!)).toHaveLength(2);
});
it('preserves unreadable storage while allowing an explicitly unsaved session',async()=>{
 saved.set(CONSUMER_STORAGE_KEY,'unreadable');await render();
 expect(host.textContent).toContain('will not be saved');await click("Let's find out");
 expect(host.textContent).toContain('Exit (not saved)');expect(saved.get(CONSUMER_STORAGE_KEY)).toBe('unreadable');
});

it('compares completed runs and lets the reader revisit an earlier profile', async () => {
 const { ConsumerHome } = await import('../features/consumer/ConsumerHome');
 const { startConsumerAttempt } = await import('@ailx/session');
 saved.set(CONSUMER_STORAGE_KEY, JSON.stringify([
  {...startConsumerAttempt('first', 1000), responses:['a','a','a','a','a','a','a','a']},
  {...startConsumerAttempt('second', 2000), responses:['b','a','c','b','a','c','b','a']},
 ]));
 await act(async()=>root.render(createElement(ConsumerHome)));
 expect(host.querySelector<HTMLInputElement>('input[type=range]')?.value).toBe('1');
 expect(host.querySelectorAll('tbody tr')).toHaveLength(6);
 expect(host.textContent).toContain('Drag the timeline');
 expect(host.querySelector('[stroke-dasharray]')).toBeNull();
 expect(host.querySelector('tbody tr')?.textContent).toContain('1/10/1');
 let animation: FrameRequestCallback = () => {};
 vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { animation = callback; return 1; });
 vi.stubGlobal('cancelAnimationFrame', vi.fn());
 const outline = () => host.querySelector('polygon[stroke="var(--fg)"]')?.getAttribute('points');
 const before = outline();
 await act(async()=>{const slider=host.querySelector<HTMLInputElement>('input[type=range]')!;slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>animation(0));
 expect(outline()).toBe(before);
 await act(async()=>animation(325));
 const halfway = outline();
 expect(halfway).not.toBe(before);
 await act(async()=>animation(650));
 expect(outline()).not.toBe(halfway);
 vi.unstubAllGlobals();
 expect(host.textContent).toContain('Your first snapshot');
 expect(host.querySelector('a[href="/test?attempt=first"]')).not.toBeNull();
 vi.useFakeTimers();
 try {
  await click('Play history');
  expect(host.textContent).toContain('Pause');
  await act(async()=>vi.advanceTimersByTime(1200));
  expect(host.querySelector<HTMLInputElement>('input[type=range]')?.value).toBe('1');
  expect(host.textContent).toContain('Play history');
 } finally { vi.useRealTimers(); }
});

it('keeps a quota-failed attempt usable and reports that it is unsaved', async () => {
 Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: () => null,
  setItem: () => { throw new Error('Quota exceeded'); },
 }});
 await render(); await click("Let's find out");
 expect(host.textContent).toContain('could not be saved');
 expect(host.textContent).toContain('Exit (not saved)');
 await act(async()=>host.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
 await click('Continue');
 expect(host.textContent).toContain('Decision 2 of 8');
});

it('does not expose another browser’s result from an unknown attempt link', async () => {
 navigation.search='attempt=missing'; await render();
 expect(host.textContent).toContain('This test is not in this browser');
 expect(host.textContent).not.toContain('What your decisions showed');
 await click('Start my test');
 expect(host.textContent).toContain('Decision 1 of 8');
});
