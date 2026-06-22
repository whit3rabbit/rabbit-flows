# Fumadocs: UI Components

Distilled from fuma-nama/fumadocs (v14.x). Import from `fumadocs-ui/components/*`.

## Callout

```tsx
import { Callout } from 'fumadocs-ui/components/callout'

<Callout type="info" title="Optional title">
  Content here.
</Callout>
```

Props: `type?: 'info' | 'warn' | 'error'`, `title?: string`, `icon?: ReactNode`.

## Tabs / Tab

```tsx
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'

<Tabs items={['Tab 1', 'Tab 2']} defaultIndex={0} persist groupId="install">
  <Tab value="Tab 1">Content for tab 1</Tab>
  <Tab value="Tab 2">Content for tab 2</Tab>
</Tabs>
```

Props:
- `Tabs`: `items` (string[], required), `defaultIndex`, `persist` (remember in localStorage), `groupId` (sync across instances).
- `Tab`: `value` (string matching items entry, required).

## Steps / Step

```tsx
import { Steps, Step } from 'fumadocs-ui/components/steps'

<Steps>
  <Step>### Step One\n\nContent.</Step>
  <Step>### Step Two\n\nContent.</Step>
</Steps>
```

No required props; each `Step` renders its children as markdown.

## Cards / Card

```tsx
import { Cards, Card } from 'fumadocs-ui/components/card'

<Cards>
  <Card href="/docs/intro" title="Introduction" description="Learn the basics." />
  <Card href="/docs/api" title="API Reference" icon={<BookIcon />} />
</Cards>
```

Props for `Card`: `href` (string), `title` (string), `description?` (string), `icon?` (ReactNode), `external?` (boolean).

## Files / Folder / File

```tsx
import { Files, Folder, File } from 'fumadocs-ui/components/files'

<Files>
  <Folder name="src" defaultOpen>
    <File name="index.ts" />
    <Folder name="lib">
      <File name="utils.ts" />
    </Folder>
  </Folder>
</Files>
```

Props for `Folder`: `name` (string), `defaultOpen?` (boolean).
Props for `File`: `name` (string), `icon?` (ReactNode).

## Accordion / Accordions

```tsx
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'

<Accordions type="single" collapsible>
  <Accordion id="faq-1" title="Question 1">Answer 1</Accordion>
  <Accordion id="faq-2" title="Question 2">Answer 2</Accordion>
</Accordions>
```

Props for `Accordions`: `type?: 'single' | 'multiple'`, `collapsible?` (boolean).
Props for `Accordion`: `id` (string), `title` (string).

## Codeblock (manual)

```tsx
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock'

<CodeBlock filename="hello.ts" allowCopy>
  <Pre>{`const x = 1;`}</Pre>
</CodeBlock>
```

## ImageZoom

```tsx
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'

<ImageZoom src="/screenshot.png" alt="Screenshot" width={800} height={400} />
```

Wraps Next.js `<Image>` with a click-to-zoom lightbox.

## DocsPage layout components

Used in `app/docs/[[...slug]]/page.tsx`:

```tsx
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
  DocsCategory,
} from 'fumadocs-ui/page'
```

- `DocsPage`: root wrapper; accepts `toc`, `full`, `tableOfContent`, `tableOfContentPopover`.
- `DocsBody`: wraps rendered MDX content.
- `DocsTitle`: renders page `title` as `<h1>`.
- `DocsDescription`: renders page `description`.
- `DocsCategory`: renders child pages as a card grid (for index/category pages).
