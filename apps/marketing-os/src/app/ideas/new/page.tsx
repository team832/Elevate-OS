import { Button, Card, Checkbox, Field, Select, TextArea, TextInput } from '@elevate/shared-ui';
import { COURSE_PREFIXES, EXAM_PREFIXES, IDEA_SCOPES, modulePath } from '../../../domain';
import { createIdeaAction } from '../../actions/ideas';
import { MarketingPage, type SearchParams } from '../../../ui/shell';

export const dynamic = 'force-dynamic';

export default async function NewIdeaPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <MarketingPage
      permission="marketing:ideas:write"
      path={modulePath('ideas/new')}
      active="ideas"
      title="New idea"
      description="The code is assigned when you save. An identical title in the same course is refused; similar titles are saved with a warning so you can compare."
      searchParams={await searchParams}
    >
      {() => (
        <Card>
          <form action={createIdeaAction} className="el-stack">
            <Field
              id="coursePrefix"
              label="Course"
              hint="GEN = founder, parents, careers — not tied to one exam."
            >
              <Select id="coursePrefix" name="coursePrefix" required defaultValue="CLAT">
                {COURSE_PREFIXES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="title" label="Title">
              <TextInput id="title" name="title" required minLength={3} maxLength={300} />
            </Field>
            <Field
              id="pillar"
              label="Pillar"
              hint="Free text until the pillar list is decided (OD-004)."
            >
              <TextInput id="pillar" name="pillar" maxLength={80} />
            </Field>
            <Field id="series" label="Series">
              <TextInput id="series" name="series" maxLength={120} />
            </Field>
            <Field id="objective" label="Objective">
              <TextArea id="objective" name="objective" rows={2} maxLength={1000} />
            </Field>
            <Field id="audience" label="Audience">
              <TextInput id="audience" name="audience" maxLength={500} />
            </Field>
            <Field id="brief" label="Brief">
              <TextArea id="brief" name="brief" rows={4} maxLength={5000} />
            </Field>
            <Field
              id="source"
              label="Source"
              hint="Where the idea came from (comment, scan, WhatsApp note…)."
            >
              <TextInput id="source" name="source" maxLength={300} />
            </Field>
            <Field id="masterAsset" label="Master asset">
              <TextInput id="masterAsset" name="masterAsset" maxLength={200} />
            </Field>
            <Field
              id="scope"
              label="Scope (collab rule)"
              hint="cross exam = comparisons and “every path” content; tick the exams involved."
            >
              <Select id="scope" name="scope" defaultValue="">
                <option value="">Default for the course</option>
                {IDEA_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend>Exams involved (cross exam only)</legend>
              {EXAM_PREFIXES.map((p) => (
                <Checkbox key={p} name="scopePrefixes" value={p} label={p} />
              ))}
            </fieldset>
            <div>
              <Button type="submit">Save idea</Button>
            </div>
          </form>
        </Card>
      )}
    </MarketingPage>
  );
}
