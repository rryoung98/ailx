import { expect, it } from 'vitest';
import { runPure } from '@ailx/core';
import { startConsumerAttempt, type ConsumerChoice } from '@ailx/session';
import { CONSUMER_QUESTIONS, CONSUMER_PROFILES, consumerResult } from '../src/consumer.js';
it('withholds incomplete profiles and explains every completed decision', () => {
  const attempt = startConsumerAttempt('one', 0);
  expect(consumerResult(attempt)).toEqual({kind:'incomplete'});
  const result = runPure(() => consumerResult({...attempt, responses:CONSUMER_QUESTIONS.map(q => q.answer)}));
  expect(result.kind).toBe('complete');
  if (result.kind !== 'complete') throw new Error('missing result');
  expect(result.profile).toEqual(CONSUMER_PROFILES.balanced);
  expect(result.skills.map(s => s.matched)).toEqual([2,2,2,2]);
  expect(result.metrics.map(m => m.matched)).toEqual([1,1,2,2,1,1]);
  expect(result.decisions.every(d => d.explanation && d.matched)).toBe(true);
});
it('produces bounded, deterministic observations for every response combination', () => {
  const choices: ConsumerChoice[] = ['a','b','c'];
  for (let n=0; n<3**8; n++) {
    const responses = Array.from({length:8},(_,i)=>choices[Math.floor(n/3**i)%3]);
    const attempt = {...startConsumerAttempt('one',0),responses};
    const result = consumerResult(attempt);
    expect(result).toEqual(consumerResult(attempt));
    if(result.kind !== 'complete') throw new Error('missing result');
    expect(result.skills.every(s=>s.matched>=0 && s.matched<=2)).toBe(true);
    expect(result.metrics.reduce((sum,m)=>sum+m.matched,0)).toBe(result.decisions.filter(d=>d.matched).length);
    expect(result.metrics.every(m=>m.matched>=0 && m.matched<=m.total)).toBe(true);
    expect(result.skills.reduce((sum,s)=>sum+s.matched,0)).toBe(result.decisions.filter(d=>d.matched).length);
    const leaders=result.skills.filter(s=>s.matched===Math.max(...result.skills.map(s=>s.matched)));
    if(leaders.length>1 && !result.decisions.every(d=>d.matched)) expect(result.profile).toEqual(CONSUMER_PROFILES.mixed);
  }
});
