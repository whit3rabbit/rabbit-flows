# Starlight: Built-in Components

Distilled from withastro/starlight docs + component source (`packages/starlight/user-components/`).

Built-in components for `.mdx` pages (also usable in `.astro`). Not available in plain `.md`.

---

## Cross-framework authoring: use the CROSSWALK, not Starlight syntax

This file is **Starlight-only**. If you are authoring for Docusaurus, MkDocs, VitePress, or
another framework, do NOT use `<Aside>`, `<Card>`, `<FileTree>`, `<Steps>`, `<Tabs>`, or any
`@astrojs/starlight` import — those are Starlight-specific and will break other frameworks.

The canonical per-framework syntax lives in the `CROSSWALK` const in
`.claude/workflows/docs-create.js` (and is injected automatically into author prompts at
runtime). The six framework-neutral constructs it covers are:

| Construct   | Intent                          | Starlight syntax (this file)                   |
|-------------|----------------------------------|------------------------------------------------|
| `callout`   | Information callout / admonition | `:::note` / `:::tip` / `<Aside>` in .mdx      |
| `tabs`      | Tabbed content switcher          | `<Tabs>` + `<TabItem>` in .mdx                 |
| `steps`     | Numbered sequential procedure    | `<Steps>` wrapping an ordered list in .mdx     |
| `card`      | Highlighted content card block   | `<Card>` inside `<CardGrid>` in .mdx           |
| `filetree`  | Annotated directory/file tree    | `<FileTree>` wrapping a nested list in .mdx    |
| `code-title`| Code block with filename label   | Fenced block with `title="filename.js"`        |

When authoring outside Starlight: look up your framework's column in the CROSSWALK before
writing any of the above constructs. The CROSSWALK is the authoritative source; this table
is the Starlight column only.

---

## Import

Pull several at once from one entry point:

```mdx
import { Aside, Badge, Card, CardGrid, FileTree, Icon, LinkButton, LinkCard, Steps, Tabs, TabItem } from '@astrojs/starlight/components';
```

Notes that apply throughout:
- `icon` / `name` props take a Starlight built-in icon name (string). See `/reference/icons/`.
- `title` / `description` on Card and LinkCard render as HTML (`set:html`), so inline markup is allowed.

---

## Aside

Callout box. In `.md`/`.mdx` you can also use the `:::note` / `:::tip` / `:::caution` / `:::danger` colon syntax; the component is for `.mdx` when you need it inline.

Props:
- `type?: 'note' | 'tip' | 'caution' | 'danger'` — default `'note'`.
- `title?: string` — heading; defaults to a localized label for the type.
- `icon?: StarlightIcon` — override the default per-type icon.

```mdx
<Aside type="caution" title="Watch out">Back up before running this.</Aside>
```

Colon equivalent: `:::tip[Did you know?]{icon="heart"}` ... `:::`.

---

## Badge

Small inline label. Renders a `<span>`; extra HTML attributes (e.g. `class`) pass through.

Props:
- `text: string` — **required**, the label.
- `variant?: 'note' | 'tip' | 'danger' | 'caution' | 'success' | 'default'` — default `'default'`.
- `size?: 'small' | 'medium' | 'large'` — default `'small'`.

```mdx
<Badge text="New" variant="success" size="medium" />
```

---

## Card

Boxed content block, usually inside CardGrid.

Props:
- `title: string` — **required** (renders as HTML).
- `icon?: StarlightIcon`.

```mdx
<Card title="Fast" icon="rocket">Built on Astro for top performance.</Card>
```

---

## CardGrid

Responsive grid wrapper for Card / LinkCard.

Props:
- `stagger?: boolean` — default `false`; offsets alternate cards vertically.

```mdx
<CardGrid stagger>
  <Card title="Check it out" icon="open-book">Interesting content.</Card>
  <Card title="Other feature" icon="information">More info.</Card>
</CardGrid>
```

---

## FileTree

Renders a styled file/directory tree from a Markdown bulleted list in its slot. No props. Bold a name to highlight it; add a `# comment` after a name; use a trailing `...`/`…` placeholder entry for "more files".

```mdx
<FileTree>
- src
  - components
    - **Header.astro** the site header
  - pages/
- package.json
</FileTree>
```

A name ending in `/` (or with children) is treated as a directory.

---

## Icon

Renders one of Starlight's built-in icons.

Props:
- `name: StarlightIcon` — **required**.
- `label?: string` — accessible label; when set, the icon is exposed to assistive tech (otherwise `aria-hidden`).
- `color?: string` — CSS color.
- `size?: string` — CSS size, default `'1em'`.
- `class?: string`.

```mdx
<Icon name="star" color="goldenrod" size="2rem" label="Featured" />
```

---

## LinkButton

Visually-prominent call-to-action link. Renders an `<a>`; extra anchor attributes pass through.

Props:
- `href: string | URL` — **required**.
- `variant?: 'primary' | 'secondary' | 'minimal'` — default `'primary'`.
- `icon?: StarlightIcon`.
- `iconPlacement?: 'start' | 'end'` — default `'end'`.

```mdx
<LinkButton href="/getting-started/" icon="right-arrow">Get started</LinkButton>
<LinkButton href="/reference/" variant="secondary">Reference</LinkButton>
```

---

## LinkCard

Prominent linked card for navigation. Renders an `<a>`; extra anchor attributes pass through (e.g. `target`).

Props:
- `title: string` — **required** (renders as HTML).
- `href: string | URL` — **required** (the navigation target).
- `description?: string` — supporting text (renders as HTML).

```mdx
<LinkCard title="Authoring Content" href="/guides/authoring-content/" description="Learn the Markdown syntax Starlight supports." />
```

Group multiple LinkCards inside `<CardGrid>` to lay them out side by side.

---

## Steps

Numbers an ordered list to display a sequential procedure. Wrap a single `<ol>` (Markdown ordered list). No props.

```mdx
<Steps>

1. Install the integration:

   ```sh
   npx astro add markdoc
   ```

2. Add the preset to your config.

</Steps>
```

---

## Tabs + TabItem

Tabbed interface. `<Tabs>` wraps one or more `<TabItem>`.

`Tabs` props:
- `syncKey?: string` — tabs sharing the same key sync their selection across the page and persist it in `localStorage` (e.g. one `syncKey="pkg"` for all package-manager tab sets).

`TabItem` props:
- `label: string` — **required**, the tab's visible label.
- `icon?: StarlightIcon`.

```mdx
<Tabs syncKey="pkg">
  <TabItem label="npm" icon="seti:npm">
    ```sh
    npm install @astrojs/starlight
    ```
  </TabItem>
  <TabItem label="pnpm">
    ```sh
    pnpm add @astrojs/starlight
    ```
  </TabItem>
</Tabs>
```

The first `TabItem` is selected by default. For sync to work, the labels must match across the synced tab sets.
