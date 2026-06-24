# Docusaurus: Built-in Theme Components

Distilled from facebook/docusaurus (v3.x). Use in `.mdx` files with `import` from `@theme/`.

## Tabs / TabItem

```mdx
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs groupId="platform" queryString>
  <TabItem value="win" label="Windows" default>Windows steps</TabItem>
  <TabItem value="mac" label="macOS">macOS steps</TabItem>
  <TabItem value="linux" label="Linux">Linux steps</TabItem>
</Tabs>
```

Props:
- `Tabs`: `groupId` (string, syncs across same-page instances), `defaultValue`, `values`, `queryString` (persist in URL query param).
- `TabItem`: `value` (required, unique within `<Tabs>`), `label` (display name), `default` (pre-selected).

## CodeBlock

```mdx
import CodeBlock from '@theme/CodeBlock';

<CodeBlock language="js" title="src/hello.js" showLineNumbers>
  {`function hello() { return 'Hello!'; }`}
</CodeBlock>
```

Props: `language`, `title`, `showLineNumbers`, `metastring` (Prism token string).

## Admonition (programmatic form)

```mdx
import Admonition from '@theme/Admonition';

<Admonition type="tip" icon="💡" title="My tip">
  Content here.
</Admonition>
```

Types: `note`, `tip`, `info`, `warning`, `danger`.

## DocCardList (index pages)

```mdx
import DocCardList from '@theme/DocCardList';

<DocCardList />   // renders cards for all docs in the current category
```

## Mermaid (v3.3+)

```mdx
import Mermaid from '@theme/Mermaid';

<Mermaid value={`graph LR\n  A --> B`} />
```

Requires `@docusaurus/theme-mermaid` and `markdown: { mermaid: true }` in config.

## BrowserWindow (unofficial / theme utility)

Not a core component but commonly used in examples:
```mdx
import BrowserWindow from '@site/src/components/BrowserWindow';

<BrowserWindow url="https://example.com">
  Preview content
</BrowserWindow>
```

## Swizzling (customising components)

To override a theme component:
```sh
npx docusaurus swizzle @docusaurus/theme-classic Footer -- --eject   # copy to src/theme/
```

Preferred: `--wrap` (wrap the original), `--eject` (full copy).
Overridden component lives in `src/theme/Footer/index.js`.

## Custom React components

Place in `src/components/`. Import with `@site/src/components/MyComp` in MDX files.

```mdx
import MyCard from '@site/src/components/MyCard';

<MyCard title="Hello">Content</MyCard>
```

## Head metadata injection

```mdx
import Head from '@docusaurus/Head';

<Head>
  <meta name="twitter:card" content="summary_large_image" />
</Head>
```
