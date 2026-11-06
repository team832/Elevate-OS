import type { Metadata } from 'next';
import { portalPage } from '../../server/portal';
import { forChild, PORTAL_PAGES, PortalClosed, PortalFrame } from '../../ui/portal-frame';

export const metadata: Metadata = { title: 'Portal' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ student?: string | string[] }>;

/** Portal home (F4-13): a guardian with several children picks one; then the pages for that child. */
export default async function PortalHome({ searchParams }: { searchParams: Params }) {
  const { student } = await searchParams;
  const view = await portalPage('/portal', student);
  if (view.closed) return <PortalClosed />;
  const picking = view.children.length > 1 && student === undefined;
  return (
    <PortalFrame
      view={view}
      path="/portal"
      title={picking ? 'Choose a student' : view.child.fullName}
      description="What Elevate Education has recorded. You can read it here; to change anything, ask the institute."
    >
      <ul className="portal-links">
        {picking
          ? view.children.map((c) => (
              <li key={c.id}>
                <a href={`/portal?student=${c.id}`}>
                  <strong>{c.fullName}</strong>
                </a>
              </li>
            ))
          : PORTAL_PAGES.slice(1).map(([href, label, about]) => (
              <li key={href}>
                <a href={forChild(view, href)}>
                  <strong>{label}</strong>
                  <span>{about}</span>
                </a>
              </li>
            ))}
      </ul>
    </PortalFrame>
  );
}
