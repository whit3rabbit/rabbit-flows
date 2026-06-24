# MkDocs: Content Authoring

Distilled from mkdocs/mkdocs + squidfunk/mkdocs-material (v9.x) with pymdownx extensions.

## Admonitions

Requires `admonition` + `pymdownx.details` extensions.

```md
!!! note
    Note content (4-space indented).

!!! tip "Custom title"
    Tip with a custom title.

!!! warning ""
    Warning with no title (empty string).

??? note "Collapsible (closed by default)"
    Expand to see content.

???+ tip "Collapsible (open by default)"
    Open by default.
```

Types: `note`, `abstract`, `info`, `tip`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote`.

## Code blocks

Requires `pymdownx.highlight` + `pymdownx.superfences`.

````md
```python title="hello.py" linenums="1"
def hello():
    print("Hello, World!")
```
````

Inline highlighting: `` `#!python range()` `` (syntax: `` `#!<lang> code` ``).

Code annotations (requires `content.code.annotate` theme feature):
````md
```python
def hello():  # (1)!
    print("Hello")
```

1. This is an annotation.
````

## Content tabs

Requires `pymdownx.tabbed` with `alternate_style: true`.

```md
=== "Python"
    ```python
    print("Hello")
    ```

=== "JavaScript"
    ```js
    console.log("Hello");
    ```
```

## Mermaid diagrams

Requires `pymdownx.superfences` with the mermaid custom fence.

````md
```mermaid
graph LR
  A[Start] --> B[End]
```
````

## Math (KaTeX/MathJax)

Enable in config: `pymdownx.arithmatex` extension + JS loader.

```md
Inline: $E = mc^2$

Block:
$$
\int_0^\infty e^{-x} dx = 1
$$
```

## Grids (Material)

Requires `attr_list` + `md_in_html`.

```md
<div class="grid cards" markdown>

- :material-clock-fast:{ .lg .middle } **Set up in 5 minutes**

    Install and configure quickly.

    [:octicons-arrow-right-24: Getting started](getting-started.md)

</div>
```

## Buttons

Requires `attr_list`.

```md
[Subscribe to newsletter](#){ .md-button }
[Download :fontawesome-solid-download:](#){ .md-button .md-button--primary }
```

## Images with captions

Requires `attr_list` + `md_in_html`.

```md
![My Image](path/to/image.png){ align=right width=300 }

<figure markdown="span">
  ![Image title](path/to/image.png){ width="300" }
  <figcaption>Image caption</figcaption>
</figure>
```

## Snippets (reusable content)

Requires `pymdownx.snippets`.

```md
--8<-- "includes/common-steps.md"
```

Place shared content in `docs/includes/`.

## Emoji

Requires `pymdownx.emoji`.

```md
:material-home: :fontawesome-brands-github: :octicons-arrow-right-24:
```

## Keyboard keys

Requires `pymdownx.keys`.

```md
++ctrl+alt+del++
```
