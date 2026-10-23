import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { DonutChart } from '../src/components/charts';
import { shareLabels } from '../src/components/chart-math';

const data = [
  { label: 'Paid', value: 70 },
  { label: 'Outstanding', value: 30, href: '/ops/fees?open=outstanding' },
];

describe('DonutChart', () => {
  it('a datum with href makes its segment a named link; the drawing becomes a group', () => {
    const out = render(<DonutChart label="Tuition" data={data} />);
    expect(out).toContain('<svg viewBox="0 0 42 42" role="group"');
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain(
      '<a href="/ops/fees?open=outstanding" aria-label="Outstanding 30 (30%)"><circle',
    );
  });

  it('without links it stays one image and draws no table unless asked', () => {
    const out = render(<DonutChart label="Tuition" data={data.map(({ href: _, ...d }) => d)} />);
    expect(out).toContain('role="img"');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('Show as table');
  });

  it('table adds "Show as table" with every value', () => {
    const out = render(<DonutChart label="Tuition" data={data} table />);
    expect(out).toContain('<summary>Show as table</summary>');
    expect(out).toMatch(/<th scope="row">Outstanding<\/th><td class="el-num">30<\/td>/);
  });
});

describe('shareLabels: one rounding, shares add up to 100', () => {
  it.each([
    [
      [70, 30],
      ['70%', '30%'],
    ],
    [
      [1, 2],
      ['33%', '67%'],
    ],
    [
      [1, 1, 1],
      ['34%', '33%', '33%'],
    ],
    [
      [996, 4],
      ['>99%', '<1%'],
    ],
    [
      [4, 996],
      ['<1%', '>99%'],
    ],
    [
      [0, 5],
      ['0%', '100%'],
    ],
    [
      [null, 5],
      ['—', '100%'],
    ],
    [
      [0, 0],
      ['—', '—'],
    ],
  ])('%j → %j', (values, expected) => expect(shareLabels(values)).toEqual(expected));

  it('the donut legend and its name use the same shares', () => {
    const out = render(
      <DonutChart
        label="Tuition"
        data={[
          { label: 'Paid', value: 996 },
          { label: 'Outstanding', value: 4 },
        ]}
      />,
    );
    expect(out).toContain('Tuition: Paid 996 (&gt;99%), Outstanding 4 (&lt;1%)');
  });
});
