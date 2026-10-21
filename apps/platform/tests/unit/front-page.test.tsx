import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FrontPage } from '../../src/app/_components/front-page';

describe('public front page (signed-out /)', () => {
  const html = renderToStaticMarkup(<FrontPage />);

  it('offers staff sign-in and links only to real places', () => {
    expect(html.match(/href="\/login"/g)).toHaveLength(2);
    for (const href of [
      'https://elevateeducation.in',
      'https://elevateeducation.in/privacy-policy',
      'tel:+918505099888',
      'mailto:team@elevateeducation.in',
    ])
      expect(html).toContain(`href="${href}"`);
    expect(html).not.toContain('href="#"');
  });

  it('lists the owner-confirmed programmes and no internal data', () => {
    for (const p of [
      'CLAT',
      'IPMAT',
      'CUET',
      'CA Foundation',
      'Class 11 Commerce',
      'Class 12 Commerce',
      'Dropper',
    ])
      expect(html).toContain(`<dt>${p}</dt>`);
    expect(html).toContain('Online, and offline at the Sikar centre');
    expect(html).not.toMatch(/example\.test|fictional|Sample data/i);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });
});
