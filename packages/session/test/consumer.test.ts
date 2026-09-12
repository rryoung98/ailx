import { describe, expect, it } from 'vitest';
import { appendConsumerResponse, consumerComplete, parseConsumerHistory, startConsumerAttempt } from '../src/consumer.js';
describe('consumer attempts', () => {
  it('appends immutably and rejects repeated or out-of-order decisions', () => {
    const initial = startConsumerAttempt('one', 0);
    const next = appendConsumerResponse(initial, 0, 'b');
    expect(initial.responses).toEqual([]);
    expect(next.responses).toEqual(['b']);
    expect(() => appendConsumerResponse(next, 0, 'a')).toThrow();
    expect(() => appendConsumerResponse(next, 2, 'a')).toThrow();
    let full = next;
    for (let i = 1; i < 8; i++) full = appendConsumerResponse(full, i, 'a');
    expect(consumerComplete(full)).toBe(true);
    expect(() => appendConsumerResponse(full, 8, 'a')).toThrow();
  });
  it('round trips saved decisions and rejects unsupported data', () => {
    const attempt = appendConsumerResponse(startConsumerAttempt('one', 0), 0, 'c');
    expect(parseConsumerHistory(JSON.stringify([attempt]))).toEqual([attempt]);
    expect(parseConsumerHistory(null)).toEqual([]);
    for (const data of ['{', '{}', JSON.stringify([attempt, attempt]), JSON.stringify([{...attempt, formVersion:'future'}]), JSON.stringify([{...attempt,responses:['x']}])]) expect(() => parseConsumerHistory(data)).toThrow();
  });
});
