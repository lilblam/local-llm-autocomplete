# Local LLM Autocomplete

Ghost-text code completion for VS Code powered by a local LLM via any OpenAI-compatible endpoint (llama-server, ollama, etc).

## Features

- **Inline ghost-text suggestions** triggered manually or automatically as you type
- **Selection replacement** — select code and trigger to have the LLM fix or improve it in place (undo with Ctrl+Z)
- **Fully customizable prompts** — tailor the completion and selection prompts to work best with your model
- **Project context folder** — drop text files, SQL schemas, instructions, or even images into a `.llm-context` folder in your workspace to give the model extra context
- **Multimodal support** — image files in the context folder are sent to vision-capable models
- **Fully local** — no data leaves your machine

## Install from Release (easiest)

1. Download the `.vsix` from the [Releases page](https://github.com/lilblam/local-llm-autocomplete/releases)
2. In VS Code: `Ctrl+Shift+P` → "Install from VSIX" and pick the file
3. Set your endpoint URL and model name in settings (search "Local LLM")

## Build from Source

```
git clone https://github.com/lilblam/local-llm-autocomplete.git
cd local-llm-autocomplete
npm install -g @vscode/vsce
vsce package --allow-missing-repository
code --install-extension local-llm-autocomplete-0.0.5.vsix
```

## Setup

1. Start your local LLM server (e.g. `llama-server`) with an OpenAI-compatible chat endpoint
2. Open settings and configure the endpoint URL and model name if they differ from the defaults

## Settings

| Setting | Default | Description |
|---|---|---|
| `local-llm.endpointUrl` | `http://localhost:8013` | Base URL of your server (don't include /v1 — it's appended automatically) |
| `local-llm.modelName` | `Qwen3.5` | Model name to request |
| `local-llm.contextFolder` | `.llm-context` | Folder in your workspace with extra context files |
| `local-llm.enableAutoSuggest` | `false` | Enable automatic suggestions as you type |
| `local-llm.autoSuggestDelay` | `1000` | Delay (ms) before auto-requesting a suggestion |
| `local-llm.completionPrompt` | *(see below)* | Prompt template for cursor-based completions |
| `local-llm.selectionPrompt` | *(see below)* | Prompt template for selection replacement |
| `local-llm.imageContextPrompt` | *(see below)* | Prompt appended when images are in the context folder |

## Usage

- **Manual trigger**: Press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on Mac) to request a completion at your cursor position. The suggestion appears as ghost text — press `Tab` to accept or `Escape` to dismiss.
- **Selection replacement**: Select a piece of code, then press `Ctrl+Shift+Space`. The LLM will analyze the selected code and replace it with a corrected or improved version. Press `Ctrl+Z` to undo if needed.
- **Auto-suggest**: Enable in settings for automatic suggestions with a configurable delay.
- **Context folder**: Create a `.llm-context` folder in your workspace root and add any relevant files — schemas, documentation, instructions, or reference images.

## Customizing Prompts

All prompts sent to the model are fully customizable in settings. Each prompt supports placeholder variables that get replaced at runtime.

**Completion prompt** (`local-llm.completionPrompt`) — used when triggering at a cursor position:
- `{fileName}` — name of the current file
- `{textBefore}` — all code before the cursor
- `{textAfter}` — all code after the cursor

**Selection prompt** (`local-llm.selectionPrompt`) — used when triggering with selected code:
- `{fileName}` — name of the current file
- `{beforeSelection}` — all code before the selection
- `{selectedText}` — the selected code
- `{afterSelection}` — all code after the selection

**Image context prompt** (`local-llm.imageContextPrompt`) — appended when image files are in the context folder:
- `{imageCount}` — number of images
- `{imageNames}` — comma-separated list of image file names

To edit these, open VS Code settings (`Ctrl+,`), search for "Local LLM", and modify the prompt fields. The settings UI provides a multiline text editor for comfortable editing.

To reset any setting to its default, click the gear icon next to it in the Settings UI and select "Reset Setting".

## Output

Open the Output panel and select "Local LLM Autocomplete" from the dropdown to see request logs and diagnostics.