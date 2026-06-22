# MkDocs: Material Components

Distilled from squidfunk/mkdocs-material (v9.x). MkDocs uses Markdown extensions, not importable components.

## Summary

MkDocs-Material uses Markdown extensions and HTML/CSS utility classes rather than React/Vue components.
"Components" here means the patterns you use in Markdown to produce rich UI elements.

## Cards grid

Requires `attr_list` + `md_in_html`.

```md
<div class="grid cards" markdown>

- :material-clock-fast:{ .lg .middle } **Install in 5 minutes**

    ---
    Quick setup for any project.
    [:octicons-arrow-right-24: Getting started](getting-started.md)

- :material-scale-balance:{ .lg .middle } **Open Source**

    ---
    Material for MkDocs is licensed under MIT.

</div>
```

## Annotations

Requires `content.code.annotate` feature + `attr_list`.

```md
Lorem ipsum (1) dolor sit amet.
{ .annotate }

1. This is the annotation text.
```

## Tooltips

Requires `pymdownx.snippets` + `attr_list`.

```md
[Hover me](example.com "Tooltip text"){ title="Tooltip text" }
```

## Details (collapsible blocks)

```md
??? "Summary line"
    Content inside the collapsible block.

???+ "Open by default"
    This one starts expanded.
```

## Status badges in nav

Set per-page in frontmatter:
```yaml
status: new       # shows "New" badge
status: deprecated
```

## Content tabs

```md
=== "Tab One"
    Content for tab one.

=== "Tab Two"
    Content for tab two.
```

## Feedback widget

Configured in `mkdocs.yml` analytics section. Renders thumbs up/down per page.

```yaml
analytics:
  feedback:
    title: Was this page helpful?
    ratings:
      - icon: material/thumb-up-outline
        name: This page was helpful
        data: 1
        note: Thanks for your feedback!
      - icon: material/thumb-down-outline
        name: This page could be improved
        data: 0
        note: Thanks for the feedback!
```

## Blog (Material plugin)

Requires the `blog` plugin:
```yaml
plugins:
  - blog
```

Blog posts live in `docs/blog/posts/`.

## Social cards

Automatically generated thumbnails (requires `[imaging]` extras):
```yaml
plugins:
  - social
```
