/**
 * Frame of every signed-in portal page (F4-13): a slim bar (brand, sign out), the page title with
 * the student's name, the portal pages as pills. No staff rail, no workspaces. Phone first.
 */
import type { ReactNode } from 'react';
import {
  BrandLogo,
  Button,
  EmptyState,
  INSTITUTE,
  instituteTelHref,
  PageHeader,
  SampleBadge,
  Subnav,
} from '@elevate/shared-ui';
import type { PortalView } from '../server/portal';
import '../app/portal/portal.css';

export const PORTAL_PAGES = [
  ['/portal', 'Home', ''],
  ['/portal/attendance', 'Attendance', 'Classes attended in each batch, and recent absences.'],
  ['/portal/tests', 'Tests and results', 'Published test results.'],
  [
    '/portal/homework',
    'Homework',
    'Homework set for the student’s batches and whether it was handed in.',
  ],
  ['/portal/fees', 'Fees', 'The fee agreement, instalments, payments and receipts.'],
  ['/portal/timetable', 'Timetable', 'Classes in the next 14 days.'],
] as const;

/** `?error=` codes of the portal sign-in and setup handlers (server/portal.ts). */
export const PORTAL_ERRORS: Record<string, string> = {
  invalid: 'The login or password is not right.',
  missing: 'Enter your login and password.',
  locked: 'Too many failed attempts. Try again in 15 minutes.',
  closed: 'The portal is not open yet.',
  unavailable: 'This is not working just now. Try again in a few minutes.',
};

type Open = Extract<PortalView, { closed: false }>;

/** A portal link for the shown student (the parameter only when the login has several). */
export const forChild = (view: Open, href: string) =>
  view.children.length > 1 ? `${href}?student=${view.child.id}` : href;

function Bar({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="portal-bar">
      <a className="el-skip-link" href="#portal-main">
        Skip to content
      </a>
      <a href="/portal" className="portal-brand">
        <BrandLogo size="sm" decorative />
        <span className="el-visually-hidden">Elevate Education portal home</span>
      </a>
      {signedIn ? (
        <form method="post" action="/api/v1/portal/logout">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      ) : null}
    </header>
  );
}

export function PortalFrame({
  view,
  path,
  title,
  description,
  children,
}: {
  view: Open;
  path: (typeof PORTAL_PAGES)[number][0];
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const several = view.children.length > 1;
  return (
    <div className="portal">
      <Bar signedIn />
      <main id="portal-main" className="portal-main">
        <PageHeader
          title={title}
          description={description}
          meta={
            <>
              {view.child.isSample ? <SampleBadge /> : null}
              {several ? <a href="/portal">Change student</a> : null}
            </>
          }
          tabs={
            <Subnav
              label="Portal pages"
              items={PORTAL_PAGES.map(([href, text]) => [forChild(view, href), text] as const)}
              current={forChild(view, path)}
            />
          }
        />
        <div className="el-stack">{children}</div>
      </main>
    </div>
  );
}

/** Setting portal.enabled is off (Proposed default), or a page outside the frame (sign-in, setup). */
export function PortalPlain({ children }: { children: ReactNode }) {
  return (
    <div className="portal">
      <Bar signedIn={false} />
      <main id="portal-main" className="portal-main">
        {children}
      </main>
    </div>
  );
}

export function PortalClosed() {
  return (
    <PortalPlain>
      <EmptyState
        level={1}
        title="The portal is not open yet"
        description={
          <>
            Elevate Education will tell you when you can sign in. For anything urgent, call the
            institute on <a href={instituteTelHref}>{INSTITUTE.phone}</a>.
          </>
        }
      />
    </PortalPlain>
  );
}

/** The student is not set up in Academic yet: nothing to show, said plainly (never zeros). */
export const NotInAcademic = () => (
  <EmptyState
    title="Nothing recorded yet"
    description="Classes, tests and homework appear here once the student has been placed in a batch."
  />
);
