import { expect, test } from '@playwright/test';
import { parseBasesConfig, renderBasesBlock } from '../../src/lib/render/basesRenderer';

test('Bases config bounds query work and accepts only supported views', () => {
  expect(parseBasesConfig('view: kanban\nlimit: 10000')).toMatchObject({
    view: 'table',
    limit: 100,
  });
  expect(parseBasesConfig('view: cards\nlimit: 0')).toMatchObject({
    view: 'cards',
    limit: 1,
  });
});

test('Bases output escapes author config and renders returned values as text', () => {
  const hostileValue = '</script><img src=x onerror=alert(1)>';
  const html = renderBasesBlock(`type: ${hostileValue}\ntag: ${hostileValue}`);

  expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain(hostileValue);
  expect(html).not.toContain('innerHTML');
  expect(html).toContain('element.textContent = String(text)');
  expect(html).toContain("'/api/v1/resources/query?' + params.toString()");
});
