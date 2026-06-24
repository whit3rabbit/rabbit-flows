# Fumadocs: Content Authoring

Distilled from fuma-nama/fumadocs (v14.x). Content is `.mdx` files in `content/docs/`.

## File format

All doc pages use `.mdx` (MDX — Markdown + JSX). Standard Markdown works inside MDX.

## Callouts / admonitions

Via the `Callout` component (included in `fumadocs-ui/mdx` defaults):

```mdx
import { Callout } from 'fumadocs-ui/components/callout'

<Callout type="info">This is an info callout.</Callout>
<Callout type="warn">Warning callout.</Callout>
<Callout type="error">Error callout.</Callout>
<Callout title="Custom Title">Note with a title.</Callout>
```

Types: `info` (default), `warn`, `error`.

Or use the remark-based syntax (if `remarkAdmonition` plugin is configured):
```md
> [!NOTE]
> GitHub-style admonition.
```

## Code blocks

Standard fenced code blocks with optional title and highlighting via `rehypeCode`:

````md
```ts title="hello.ts"
function hello(): string {
  return 'Hello!'
}
```
````

Diff:
````md
```ts
const a = 1  // [!code --]
const b = 2  // [!code ++]
```
````

## Tabs

```mdx
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'

<Tabs items={['npm', 'pnpm', 'yarn']}>
  <Tab value="npm">
    ```sh
    npm install fumadocs-ui
    ```
  </Tab>
  <Tab value="pnpm">
    ```sh
    pnpm add fumadocs-ui
    ```
  </Tab>
  <Tab value="yarn">
    ```sh
    yarn add fumadocs-ui
    ```
  </Tab>
</Tabs>
```

## Steps

```mdx
import { Steps, Step } from 'fumadocs-ui/components/steps'

<Steps>
  <Step>
    ### Install

    Run `npm install fumadocs-ui`.
  </Step>
  <Step>
    ### Configure

    Add `RootProvider` to your layout.
  </Step>
</Steps>
```

## File tree

```mdx
import { Files, Folder, File } from 'fumadocs-ui/components/files'

<Files>
  <Folder name="app" defaultOpen>
    <File name="page.tsx" />
    <File name="layout.tsx" />
  </Folder>
  <File name="next.config.mjs" />
</Files>
```

## Cards

```mdx
import { Cards, Card } from 'fumadocs-ui/components/card'

<Cards>
  <Card title="Getting Started" href="/docs/getting-started" icon={<MyIcon />} />
  <Card title="API Reference" href="/docs/api" description="Full API docs." />
</Cards>
```

## Accordion

```mdx
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion'

<Accordions>
  <Accordion title="What is Fumadocs?">
    Fumadocs is a Next.js documentation framework.
  </Accordion>
  <Accordion title="How do I install it?">
    Run `npm create fumadocs-app@latest`.
  </Accordion>
</Accordions>
```

## Auto-install snippet (fumadocs-docgen)

```mdx
import { AutoTypeTable } from 'fumadocs-typescript/ui'

<AutoTypeTable path="./my-types.ts" name="MyConfig" />
```

## MDX defaults

`defaultMdxComponents` from `fumadocs-ui/mdx` pre-wires all built-in components.
Pass it to `<MDX components={defaultMdxComponents} />` in the page component.
Individual components can be added to it:

```tsx
import defaultMdxComponents from 'fumadocs-ui/mdx'
const components = { ...defaultMdxComponents, MyComponent }
```
