const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

let outputChannel;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);

const MIME_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif'
};

// Substitute {placeholders} in a prompt template
function fillTemplate(template, variables) {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return variables.hasOwnProperty(key) ? variables[key] : match;
    });
}

function getExtraContext(workspaceRoot, contextFolderName) {
    if (!workspaceRoot || !contextFolderName) return { text: "", images: [] };
    const contextPath = path.join(workspaceRoot, contextFolderName);
    if (!fs.existsSync(contextPath)) return { text: "", images: [] };

    let fileContents = "";
    const images = [];

    try {
        const files = fs.readdirSync(contextPath);
        for (const file of files) {
            const fullPath = path.join(contextPath, file);
            if (!fs.statSync(fullPath).isFile()) continue;

            const ext = path.extname(file).toLowerCase();

            if (IMAGE_EXTENSIONS.has(ext)) {
                const imgBytes = fs.readFileSync(fullPath);
                const b64 = imgBytes.toString('base64');
                const mimeType = MIME_TYPES[ext] || 'image/png';
                images.push({
                    name: file,
                    dataUrl: `data:${mimeType};base64,${b64}`
                });
                outputChannel.appendLine(`[CONTEXT] Loaded image: ${file}`);
            } else {
                const content = fs.readFileSync(fullPath, 'utf8');
                fileContents += `\nFile: ${file}\n${content}\n`;
            }
        }
    } catch (err) {
        outputChannel.appendLine(`[ERROR] Could not read context folder: ${err.message}`);
    }

    let text = "";
    if (fileContents.length > 0) {
        text = "\n\n----------\nADDITIONAL PROJECT CONTEXT:\n" + fileContents;
    }

    return { text, images };
}

// Shared: build the message content (plain string or array with images)
function buildMessageContent(userPrompt, extraContext, config) {
    if (extraContext.images.length > 0) {
        const parts = [{ type: "text", text: userPrompt }];
        for (const img of extraContext.images) {
            parts.push({
                type: "image_url",
                image_url: { url: img.dataUrl }
            });
        }
        const imagePrompt = config.get('imageContextPrompt');
        const imageNote = fillTemplate(imagePrompt, {
            imageCount: extraContext.images.length,
            imageNames: extraContext.images.map(i => i.name).join(', ')
        });
        parts.push({ type: "text", text: imageNote });
        outputChannel.appendLine(`[CONTEXT] Sending ${extraContext.images.length} image(s) with request`);
        return parts;
    }
    return userPrompt;
}

// Shared: call the LLM and return the cleaned suggestion (or null)
async function callLLM(messageContent, config, abortSignal) {
    const baseUrl = config.get('endpointUrl').replace(/\/+$/, '').replace(/\/v1(\/chat\/completions)?$/, '');
    const endpointUrl = `${baseUrl}/v1/chat/completions`;
    const modelName = config.get('modelName');

    outputChannel.appendLine(`[REQUEST] ${modelName} @ ${endpointUrl}`);

    const response = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: modelName,
            messages: [
                { role: "user", content: messageContent }
            ]
        }),
        signal: abortSignal
    });

    if (!response.ok) {
        outputChannel.appendLine(`[ERROR] HTTP ${response.status}: ${response.statusText}`);
        return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content || content === "N/A") {
        outputChannel.appendLine("[INFO] No suggestion returned (empty or N/A).");
        return null;
    }

    // Strip code fences if the model wraps them anyway
    let suggestion = content;
    const fenceMatch = suggestion.match(/```[\w]*\n([\s\S]*?)\n```/);
    if (fenceMatch) {
        suggestion = fenceMatch[1];
    }

    outputChannel.appendLine(`[OK] Suggestion (${suggestion.length} chars): ${suggestion.substring(0, 80)}...`);
    return suggestion;
}

// Shared: gather extra context from workspace
function gatherExtraContext(config) {
    const contextFolder = config.get('contextFolder');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        return getExtraContext(workspaceFolders[0].uri.fsPath, contextFolder);
    }
    return { text: "", images: [] };
}

function activate(extensionContext) {
    outputChannel = vscode.window.createOutputChannel("Local LLM Autocomplete");
    outputChannel.appendLine("Local LLM Autocomplete activated.");

    // ---- WRAPPER COMMAND: handles selection mode directly, delegates cursor mode to inline suggest ----
    const triggerCommand = vscode.commands.registerCommand('local-llm.triggerCompletion', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        if (editor.selection.isEmpty) {
            // No selection: trigger normal inline completion
            vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
            return;
        }

        // Selection mode: handle everything here
        const document = editor.document;
        const selection = editor.selection;
        const config = vscode.workspace.getConfiguration('local-llm');

        const statusMsg = vscode.window.setStatusBarMessage("$(loading~spin) Asking LLM (selection)...");

        const selectedText = document.getText(selection);
        const beforeSelection = document.getText(new vscode.Range(new vscode.Position(0, 0), selection.start));
        const afterSelection = document.getText(new vscode.Range(selection.end, new vscode.Position(document.lineCount, 0)));
        const fileName = document.fileName.split(/[/\\]/).pop();

        const extraContext = gatherExtraContext(config);

        const promptTemplate = config.get('selectionPrompt');
        let userPrompt = fillTemplate(promptTemplate, {
            fileName,
            beforeSelection,
            selectedText,
            afterSelection
        });

        if (extraContext.text) {
            userPrompt += extraContext.text;
        }

        outputChannel.appendLine(`[SELECTION] ${selectedText.length} chars selected in ${fileName}`);

        const messageContent = buildMessageContent(userPrompt, extraContext, config);

        try {
            const suggestion = await callLLM(messageContent, config);

            statusMsg.dispose();

            if (!suggestion) {
                vscode.window.setStatusBarMessage("$(info) No suggestion", 2000);
                return;
            }

            // Replace the selection directly
            outputChannel.appendLine(`[SELECTION] Applying replacement (${suggestion.length} chars)...`);

            // Get fresh editor reference — the original may have gone stale during the LLM call
            const currentEditor = vscode.window.activeTextEditor;
            if (!currentEditor) {
                outputChannel.appendLine(`[ERROR] No active editor after LLM response`);
                return;
            }

            const success = await currentEditor.edit(editBuilder => {
                editBuilder.replace(selection, suggestion);
            });

            if (success) {
                outputChannel.appendLine(`[OK] Selection replaced successfully`);
                vscode.window.setStatusBarMessage("$(check) Selection replaced by LLM", 2000);
            } else {
                outputChannel.appendLine(`[ERROR] editor.edit() returned false — edit was rejected`);
                vscode.window.setStatusBarMessage("$(error) Replacement failed", 3000);
            }

        } catch (error) {
            statusMsg.dispose();
            outputChannel.appendLine(`[ERROR] ${error.name}: ${error.message}`);
            vscode.window.setStatusBarMessage("$(error) LLM error", 3000);
        }
    });
    extensionContext.subscriptions.push(triggerCommand);

    // ---- INLINE COMPLETION PROVIDER: cursor mode only ----
    const provider = vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
        async provideInlineCompletionItems(document, position, context, token) {
            
            const config = vscode.workspace.getConfiguration('local-llm');
            const isAuto = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
            const enableAuto = config.get('enableAutoSuggest');
            const delayMs = config.get('autoSuggestDelay');

            if (isAuto && !enableAuto) {
                return []; 
            }

            if (isAuto && delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
                if (token.isCancellationRequested) {
                    return []; 
                }
            }

            const statusMsg = vscode.window.setStatusBarMessage("$(loading~spin) Asking LLM...");

            const extraContext = gatherExtraContext(config);

            const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
            const textAfter = document.getText(new vscode.Range(position, new vscode.Position(document.lineCount, 0)));
            const fileName = document.fileName.split(/[/\\]/).pop();

            const promptTemplate = config.get('completionPrompt');
            let userPrompt = fillTemplate(promptTemplate, {
                fileName,
                textBefore,
                textAfter
            });

            if (extraContext.text) {
                userPrompt += extraContext.text;
            }

            const messageContent = buildMessageContent(userPrompt, extraContext, config);

            const abortController = new AbortController();
            token.onCancellationRequested(() => abortController.abort());

            try {
                outputChannel.appendLine(`[REQUEST] File: ${fileName} | Cursor line: ${position.line + 1}`);

                const suggestion = await callLLM(messageContent, config, abortController.signal);

                statusMsg.dispose();

                if (!suggestion) {
                    vscode.window.setStatusBarMessage("$(info) No suggestion", 2000);
                    return [];
                }

                vscode.window.setStatusBarMessage("$(check) LLM suggestion ready", 2000);

                const item = new vscode.InlineCompletionItem(suggestion);
                item.range = new vscode.Range(position, position);
                return [item];

            } catch (error) {
                statusMsg.dispose();
                if (error.name !== 'AbortError') {
                    outputChannel.appendLine(`[ERROR] ${error.name}: ${error.message}`);
                    vscode.window.setStatusBarMessage("$(error) LLM error", 3000);
                }
                return [];
            }
        }
    });

    extensionContext.subscriptions.push(provider);
}

function deactivate() {}

module.exports = { activate, deactivate }