# JQHTML VS Code Extension

Syntax highlighting and language support for JQHTML template files.

## Introduction

JQHTML is a component templating system built on jQuery. It lets you compose logical
concepts in HTML rather than assembling visual primitives with cryptic class names.

### What JQHTML Is

JQHTML provides:

- Component-based architecture without virtual DOM
- Template compilation to efficient JavaScript
- Deterministic lifecycle (create -> render -> load -> ready)
- Direct jQuery integration - components ARE jQuery objects

Full documentation lives at [jqhtml.org](https://jqhtml.org/).

## Features

### Syntax Highlighting

Full syntax highlighting for all JQHTML constructs:

- **Component Definitions**: `<Define:ComponentName>`
- **Template Expressions**: `<%= expression %>`
- **Control Flow**: `<% if (condition) { %> ... <% } %>`
- **Slots**: `<Slot:slotname>` for both definition and content
- **Data Bindings**: `:property="value"`
- **Event Handlers**: `@click="handler"`
- **Special Attributes**: `$sid="name"`, `$property="value"`
- **Components**: `<MyComponent />`
- **Comments**: `<%-- comment --%>`

### Language Configuration

- **Auto-closing pairs**: Automatically close tags, brackets, and quotes
- **Bracket matching**: Highlight matching brackets and tags
- **Code folding**: Fold component definitions
- **Smart indentation**: Handles control flow
- **Comment toggling**: Use standard VS Code shortcuts to toggle comments

### Code Snippets

Snippets for common template patterns, in `.jqhtml` files:

| Prefix | Description |
|--------|-------------|
| `define` | Component definition |
| `definecomp` | Component with structure |
| `if{` | If statement (brace style) |
| `for{` | For loop (brace style) |
| `exp` | Expression `<%= %>` |
| `expraw` | Unescaped expression `<%!= %>` |
| `expbr` | Expression with nl2br `<%br= %>` |
| `$id` | Scoped ID attribute |
| `:prop` | Property binding |
| `@event` | Event handler |
| `slot` | Named slot |
| `slotself` | Self-closing slot |
| `comment` | Comment block |
| `comp` | Component usage |
| `compslot` | Component with slot content |

And for component classes, in JavaScript and TypeScript files:

| Prefix | Description |
|--------|-------------|
| `jqcomponent` | Component class with the common lifecycle hooks |
| `jqon_create` | `on_create()` hook |
| `jqon_load` | `on_load()` hook |
| `jqon_loaded` | `on_loaded()` hook |
| `jqon_render` | `on_render()` hook |
| `jqon_ready` | `on_ready()` hook |
| `jqon_stop` | `on_stop()` hook |
| `jqon_viewport_resize` | `on_viewport_resize()` hook |
| `jqgate_load` | `gate_load()` call |
| `jqon` | Event listener |
| `jqonce` | One-shot event listener |
| `jqtrigger` | Trigger an event |
| `jqload_only` | `_load_only` lifecycle flag |
| `jqload_render_only` | `_load_render_only` lifecycle flag |
| `jqforce_initial_render` | `_force_initial_render` lifecycle flag |

## Usage

The extension automatically activates for `.jqhtml` files. Features include:

### Syntax Highlighting

All JQHTML syntax is highlighted with semantic colors:

```jqhtml
<Define:UserCard>
  <div class="user-card" $sid="card">
    <h2><%= this.data.name %></h2>

    <% if (this.data.isAdmin) { %>
      <span class="admin">Admin</span>
    <% } %>

    <button @click="handleClick">Click Me</button>

    <% for (const skill of this.data.skills) { %>
      <div class="skill"><%= skill %></div>
    <% } %>
  </div>
</Define:UserCard>
```

### IntelliSense

Basic HTML tag and attribute completion is provided through VS Code's built-in HTML support. In addition, the extension ships custom, JQHTML-aware providers:

- **Go to Definition** - Jump from a component tag, `$` attribute reference, `extends=""` attribute, or `Slot:` name to where it's defined, backed by a workspace-wide component index.
- **Hover** - Hover over a component name for JQHTML-specific information, using the same component index.

### Code Folding

Component definitions can be folded at the `<Define:>` level:

```
▼ <Define:MyComponent>
  ...
  </Define:MyComponent>
```

### Formatting Support

The extension ships a custom, JQHTML-aware document formatter (not VS Code's generic HTML formatter) that understands `<%-- --%>` comments, `<% %>` code blocks, self-closing tags, and JQHTML's indentation rules. Run it via **Format Document** or your usual format-on-save setting.

### Laravel Blade Support

The extension also registers a `blade` language (for `.blade.php` files) and injects JQHTML component highlighting into it, so JQHTML components used inside Laravel Blade templates get highlighted too. This includes:

- Component tag names and the `tag=""` attribute highlighted via a dedicated semantic tokens provider
- Blade-aware indentation/auto-indent rules
- Auto-spacing inside Blade tags as you type - `{{` expands to `{{ | }}`, `{!!` to `{!! | !!}`, and `{{--` to `{{-- | --}}` (cursor at `|`)

Two settings control this behavior:

| Setting | Default | Description |
|---------|---------|--------------|
| `jqhtml.enableBladeSupport` | `true` | Enable JQHTML component highlighting in Laravel Blade (`.blade.php`) files |
| `jqhtml.enableBladeAutoSpacing` | `true` | Automatically add spaces inside Blade tags when typing |

## Configuration

The extension sets these defaults for JQHTML files:

```json
{
  "[jqhtml]": {
    "editor.wordWrap": "on",
    "editor.quickSuggestions": {
      "other": true,
      "comments": false,
      "strings": true
    }
  }
}
```

You can override these in your VS Code settings.

## Theme Support

The extension uses standard TextMate scopes and works with all VS Code themes. For best results, use a theme with good HTML/JavaScript support.

## License

MIT — Copyright (c) 2026 [HansonXyz](https://github.com/hansonxyz)

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
