import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correctTextLocal, correctWord } from '../dist/test/local-spellcheck.mjs';
import { isSafeAiReplacement } from '../dist/test/ai-correction.mjs';
import { isExcludedSite, countChangedWords, looksProtected } from '../dist/test/helpers.mjs';

describe('local spellcheck', () => {
  it('Test 1: helo -> hello', () => {
    assert.equal(correctTextLocal('helo', 'balanced').text, 'hello');
  });
  it('Test 2: recieve -> receive', () => {
    assert.equal(correctTextLocal('recieve', 'balanced').text, 'receive');
  });
  it('Test 3: i wnat to lern python (local pass fixes known words)', () => {
    const { text } = correctTextLocal('i wnat to lern python', 'balanced');
    assert.ok(text.includes('want'), `got: ${text}`);
    assert.ok(text.includes('learn'), `got: ${text}`);
  });
  it('Test 4: how ar yu -> how are you', () => {
    assert.equal(correctTextLocal('how ar yu', 'balanced').text, 'how are you');
  });
  it('Test 5: I love JavaScript untouched', () => {
    assert.equal(correctTextLocal('I love JavaScript', 'balanced').text, 'I love JavaScript');
  });
  it('Test 6: URL unchanged', () => {
    assert.equal(
      correctTextLocal('Visit https://google.com', 'aggressive').text,
      'Visit https://google.com'
    );
  });
  it('Test 7: email unchanged', () => {
    assert.equal(
      correctTextLocal('my email is test@gmail.com', 'aggressive').text,
      'my email is test@gmail.com'
    );
  });
  it('Test 5b: form must NOT become from; its/their untouched without context', () => {
    assert.equal(correctWord('form', 'aggressive'), 'form');
    assert.equal(correctTextLocal('its form', 'balanced').text, 'its form');
    assert.equal(correctTextLocal('their there', 'balanced').text, 'their there');
  });
  it('common: teh->the, adn->and, wierd->weird, definately->definitely', () => {
    assert.equal(correctWord('teh'), 'the');
    assert.equal(correctWord('adn'), 'and');
    assert.equal(correctWord('wierd'), 'weird');
    assert.equal(correctWord('definately'), 'definitely');
  });
  it('conservative mode does not fuzzy-correct unknown words', () => {
    assert.equal(correctWord('speling', 'conservative'), 'speling');
  });
  it('short words and acronyms preserved', () => {
    assert.equal(correctWord('API', 'aggressive'), 'API');
    assert.equal(correctWord('a', 'aggressive'), 'a');
  });
  it('rapid-typing fragments are not corrected mid-word (short unknown kept)', () => {
    assert.equal(correctWord('prog', 'balanced'), 'prog');
  });
});

describe('AI safety validation', () => {
  it('accepts minimal correction', () => {
    assert.equal(isSafeAiReplacement('their going home', "they're going home"), true);
  });
  it('rejects chatty wrappers', () => {
    assert.equal(isSafeAiReplacement('helo', 'Sure! Here is the corrected text: hello'), false);
  });
  it('rejects dropped URLs', () => {
    assert.equal(isSafeAiReplacement('Visit https://google.com', 'Visit the site'), false);
  });
  it('rejects empty / rewrite responses', () => {
    assert.equal(isSafeAiReplacement('hello world', ''), false);
    assert.equal(
      isSafeAiReplacement('hi', 'This is a completely different long essay about nothing relevant at all yes indeed'),
      false
    );
  });
});

describe('helpers', () => {
  it('exclusion matching incl. subdomains', () => {
    assert.equal(isExcludedSite('github.com', ['github.com']), true);
    assert.equal(isExcludedSite('gist.github.com', ['github.com']), true);
    assert.equal(isExcludedSite('google.com', ['github.com']), false);
  });
  it('protected tokens detected', () => {
    assert.equal(looksProtected('test@gmail.com'), true);
    assert.equal(looksProtected('https://x.com'), true);
    assert.equal(looksProtected('#tag'), true);
  });
  it('changed-word counting', () => {
    assert.equal(countChangedWords('a b c', 'a B c'), 1);
  });
});
